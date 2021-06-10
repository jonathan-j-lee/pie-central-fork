"""Student Code Execution."""

import abc
import asyncio
import contextlib
import dataclasses
import importlib
import inspect
import queue
import re
import signal
import threading
import time
import types
import typing
import warnings
from typing import (
    Any,
    Awaitable,
    Callable,
    ClassVar,
    Iterator,
    NamedTuple,
    NoReturn,
    Optional,
    Sequence,
)

import structlog

from .. import api, process, rpc
from ..buffer import BufferManager
from ..exception import EmergencyStopException, RuntimeBaseException

__all__ = [
    'ExecutionError',
    'ExecutionRequest',
    'SyncExecutor',
    'AsyncExecutor',
    'Dispatcher',
    'target',
]


class ExecutionError(RuntimeBaseException):
    """General execution error."""


def handle_timeout(_signum: int, _stack_frame: Optional[types.FrameType]) -> NoReturn:
    """Signal handler that raises a :class:`TimeoutError`."""
    raise TimeoutError('task timed out')


def _estop() -> NoReturn:
    raise EmergencyStopException


@contextlib.contextmanager
def using_timer(timeout: float, interval: float = 0, **context: Any) -> Iterator[None]:
    """Context manager to set, then clear, an interval timer that raises an alarm."""
    signal.signal(signal.SIGALRM, handle_timeout)
    signal.setitimer(signal.ITIMER_REAL, timeout, interval)
    try:
        yield
    except Exception as exc:
        raise ExecutionError(
            'function raised an exception',
            timeout=timeout,
            interval=interval,
            **context,
        ) from exc
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)


def run_once(func: Callable[..., Any], *args: Any, timeout: float = 1) -> Any:
    """Run a synchronous function once with a timeout.

    Raises:
        signal.ItimerError: If the timer was unable to be set.
        ExecutionError: If the callable produced an exception.
    """
    with using_timer(timeout, func=func.__name__):
        return func(*args)


def run_periodically(
    func: Callable[..., Any],
    *args: Any,
    timeout: float = 1,
    predicate: Callable[[], bool] = lambda: True,  # pragma: no cover; trivial default value
) -> None:
    """Run a synchronous function periodically.

    Use this function instead of calling :func:`run_once` many times. The timing will be much more
    regular and experience less clock drift since this function takes advantage of built-in
    interval timer functionality.

    Raises:
        signal.ItimerError: If the timer was unable to be set.
        ExecutionError: If the callable produced an exception.
    """
    with using_timer(timeout, timeout, func=func.__name__):
        while predicate():
            try:
                func(*args)
                # Sleep for the rest of the interval to ensure a ``TimeoutError`` is raised, which
                # is the expected behavior.
                time.sleep(timeout)
            except TimeoutError:
                pass
            else:  # pragma: no cover; we should never reach this point
                warnings.warn('timer never ticked')


class ExecutionRequest(NamedTuple):
    """A request for an :class:`Executor` to execute a callable.

    Attributes:
        func: The callable. May or may be a coroutine function.
        args: Positonal arguments to pass to :attr:`func`.
        timeout: If the request is not periodic, the timeout is the maximum number of seconds the
            callable should run for. If the request is periodic, the timeout is the interval
            between invocations.
        periodic: Whether the callable should be invoked once or repeatedly at a fixed rate.
    """

    # Generic named tuples are not yet supported (https://github.com/python/mypy/issues/685), so
    # we cannot yet specify ``func``'s return type as a type parameter.
    func: Callable[..., Optional[Awaitable[None]]] = lambda: None
    args: Sequence[Any] = ()
    timeout: float = 1
    periodic: bool = False


# Sentinel values representing cancellation/stop requests.
# You must compare requests against these constants by *identity*, not value.
CANCEL_REQUEST = ExecutionRequest()
STOP_REQUEST = ExecutionRequest()


class Executor(abc.ABC):
    """Schedule and execute callables with timeouts."""

    @abc.abstractmethod
    def schedule(self, /, request: ExecutionRequest) -> None:
        """Schedule a callable for execution.

        Arguments:
            request: The execution request.

        Raises:
            ExecutionError: If the callable was unable to be scheduled.

        Note:
            This method should be thread-safe but is allowed to block. The order in which callables
            are registered may or may not be meaningful. They may be executed in the order in which
            they were registered, or they may execute concurrently.
        """

    def cancel(self, /) -> None:
        """Cancel all current execution."""
        self.schedule(CANCEL_REQUEST)

    def stop(self, /) -> None:
        """Cancel all execution, then unblock :meth:`execute_forever`."""
        self.schedule(STOP_REQUEST)

    @abc.abstractmethod
    def execute_forever(self, /) -> None:
        """Execute callables indefinitely (blocking method) until :meth:`stop` is called."""


@dataclasses.dataclass
class SyncExecutor(Executor):
    """An executor that executes synchronous functions, using alarm signals for timeouts.

    A synchronous executor may only run in the main thread because the main thread executes signal
    handlers. Synchronous handlers rely on the ``SIGALRM`` handler to raise an exception that will
    interrupt code that reaches a timeout.

    Attributes:
        requests: A synchronous queue of execution requests.
    """

    requests: queue.Queue[ExecutionRequest] = dataclasses.field(
        default_factory=lambda: queue.Queue(128),
    )

    def schedule(self, /, request: ExecutionRequest) -> None:
        self.requests.put(request)

    def execute(self, /, request: ExecutionRequest) -> None:
        """Execute a regular request."""
        if not request.periodic:
            run_once(request.func, *request.args, timeout=request.timeout)
        else:
            run_periodically(
                request.func,
                *request.args,
                timeout=request.timeout,
                predicate=self.requests.empty,
            )

    def execute_forever(self, /) -> None:
        if threading.current_thread() is not threading.main_thread():
            raise ExecutionError(
                'sync executor must be used in the main thread',
                main_thread=threading.main_thread().ident,
                current_thread=threading.current_thread().ident,
            )
        logger = Dispatcher.logger.sync_bl.bind(mode='sync')
        logger.info('Executor started', thread_id=threading.current_thread().ident)
        while True:
            request = self.requests.get()
            if request is STOP_REQUEST:
                logger.info('Executor stopped')
                break
            if request is CANCEL_REQUEST:
                logger.info('Executor cancelled, idling')
            else:
                logger.info(
                    'Executing function',
                    func=request.func.__name__,
                    timeout=request.timeout,
                    periodic=request.periodic,
                )
                try:
                    self.execute(request)
                except (signal.ItimerError, ExecutionError) as exc:
                    logger.error('Unable to execute function', exc_info=exc)


@dataclasses.dataclass
class AsyncExecutor(Executor, api.Actions):
    """An executor that executes coroutine functions.

    Attributes:
        loop: The event loop running the coroutine functions as tasks.
        requests: An async queue of execution requests.
        max_actions: The maximum number of concurrently running tasks.
        requests_size: The size of the requests queue.
        running_actions: Maps coroutine functions to their running task instances. For resource
            contention reasons, only one task instance may exist at a time per coroutine function.
            Once a task completes, its entry is removed from this mapping.
        debug: ``asyncio`` debug flag.
        executor: ``asyncio`` executor for dispatching synchronous tasks.
    """

    loop: Optional[asyncio.AbstractEventLoop] = None
    requests: Optional[asyncio.Queue[ExecutionRequest]] = None
    max_actions: int = 128
    requests_size: int = 128
    running_actions: dict[api.Action, asyncio.Task[None]] = dataclasses.field(default_factory=dict)
    configure_loop: Callable[[], None] = lambda: None

    def schedule(self, /, request: ExecutionRequest) -> None:
        if not self.loop or not self.requests:
            raise ExecutionError('async executor is not ready')
        current_loop: Optional[asyncio.AbstractEventLoop]
        try:
            current_loop = asyncio.get_running_loop()
        except RuntimeError:
            current_loop = None
        if current_loop is self.loop:
            self.loop.call_soon(self.requests.put_nowait, request)
        else:
            self.loop.call_soon_threadsafe(self.requests.put_nowait, request)

    def cancel_actions(self, /) -> None:
        """Cancel all running actions."""
        for task in list(self.running_actions.values()):
            task.cancel('action cancelled')

    def register_action(self, /, request: ExecutionRequest) -> None:
        """Schedule a regular request as an ``asyncio.Task`` instance."""
        coro = request.func(*request.args)
        if not coro:
            return
        if not request.periodic:
            coro = asyncio.wait_for(coro, request.timeout)
        else:
            coro = process.spin(request.func, *request.args, interval=request.timeout)
        task = asyncio.create_task(coro, name='action')
        action = typing.cast(api.Action, request.func)
        self.running_actions[action] = task
        task.add_done_callback(lambda _: self.running_actions.pop(action, None))

    async def dispatch(self, /, *, cooldown: float = 1) -> None:
        """Receive and handle requests from the queue."""
        self.configure_loop()
        self.loop = asyncio.get_running_loop()
        self.requests = asyncio.Queue(self.requests_size)
        logger = Dispatcher.logger.sync_bl.bind(mode='async')
        await asyncio.to_thread(
            logger.info,
            'Executor started',
            thread_id=threading.current_thread().ident,
        )
        while True:
            request = await self.requests.get()
            if request is STOP_REQUEST:
                self.cancel_actions()
                await asyncio.to_thread(logger.info, 'Executor stopped')
                break
            if request is CANCEL_REQUEST:
                self.cancel_actions()
                await asyncio.to_thread(logger.info, 'Executor cancelled, idling')
            elif request.func in self.running_actions:
                await asyncio.to_thread(logger.warn, 'Action already running')
            elif len(self.running_actions) >= self.max_actions:
                await asyncio.to_thread(
                    logger.warn,
                    'Max number of actions running',
                    max_actions=self.max_actions,
                )
                await asyncio.sleep(cooldown)
                with contextlib.suppress(asyncio.QueueFull):
                    self.requests.put_nowait(request)
            else:
                self.register_action(request)
                await asyncio.to_thread(logger.info, 'Registered action')

    def execute_forever(self, /) -> None:
        asyncio.run(self.dispatch())

    def run(
        self,
        action: api.Action,
        /,
        *args: Any,
        timeout: float = 30,
        periodic: bool = False,
    ) -> None:
        """Student-friendly wrapper around :meth:`AsyncExecutor.schedule`."""
        self.schedule(ExecutionRequest(action, args, timeout, periodic))

    def is_running(self, action: api.Action, /) -> bool:
        """Check whether an action (coroutine function) is running."""
        return action in self.running_actions


@dataclasses.dataclass
class Dispatcher(rpc.Handler):
    """An RPC handler to forward execution requests to the executors.

    Attributes:
        timeouts: Maps patterns that match function names to the timeout duration (in seconds).
        student_code: Student code module.
        sync_exec: An synchronous executor for executing the ``*_setup`` and ``*_main`` functions.
        async_exec: An asynchronous executor for executing actions.
        buffers: Buffer manager.
    """

    buffers: BufferManager
    student_code_name: dataclasses.InitVar[str] = 'studentcode'
    timeouts: dict[re.Pattern[str], float] = dataclasses.field(default_factory=dict)
    student_code: types.ModuleType = dataclasses.field(init=False)
    sync_exec: SyncExecutor = dataclasses.field(default_factory=SyncExecutor)
    async_exec: AsyncExecutor = dataclasses.field(default_factory=AsyncExecutor)
    logger: ClassVar[structlog.stdlib.AsyncBoundLogger] = structlog.get_logger(
        wrapper_class=structlog.stdlib.AsyncBoundLogger,
    )

    def __post_init__(self, /, student_code_name: str) -> None:
        self.student_code = types.ModuleType(student_code_name)

    @property
    def should_import(self, /) -> bool:
        """Whether student code should be imported for the first time."""
        return not hasattr(self.student_code, '__file__')

    def _print(
        self,
        /,
        *values: Any,
        sep: str = ' ',
    ) -> None:
        self.logger.sync_bl.info(sep.join(map(str, values)), student_print=True)

    def reload(self, /) -> None:
        """Load student code from disk and monkey-patch in the Runtime API."""
        if self.should_import:
            self.student_code = importlib.import_module(self.student_code.__name__)
        else:
            self.student_code = importlib.reload(self.student_code)
        student_code = typing.cast(api.StudentCodeModule, self.student_code)
        student_code.Alliance = api.Alliance
        student_code.Actions = self.async_exec
        student_code.Robot = api.Robot(self.buffers)
        student_code.Gamepad = api.Gamepad(self.buffers)
        student_code.Field = api.Field(self.buffers)
        student_code.print = self._print  # type: ignore[attr-defined]
        self.logger.sync_bl.info('Student code reloaded', student_code=self.student_code.__name__)

    def prepare_student_code_run(self, /, requests: list[dict[str, Any]]) -> None:
        """Prepare to run student code.

        Reload the student code module, then enqueue execution requests for the module's functions.

        Arguments:
            requests: A list of keyword arguments to :class:`ExecutionRequest`. However, the
                ``func`` argument should be a string naming a function in the student code module.
                Also, if ``timeout`` is not present, this method matches each function name against
                patterns in :attr:`timeouts` to find the timeout.
        """
        self.reload()
        for request in requests:
            func_name = request['func']
            request['func'] = func = getattr(self.student_code, func_name, None)
            if not callable(func) or inspect.iscoroutinefunction(func):
                self.logger.sync_bl.error('Must provide a regular function', func=func_name)
                continue
            if 'timeout' not in request:
                for pattern, timeout in self.timeouts.items():
                    if pattern.match(func_name):
                        request['timeout'] = timeout
                        break
            self.sync_exec.schedule(ExecutionRequest(**request))

    @rpc.route
    async def execute(self, /, requests: list[dict[str, Any]]) -> None:
        """Request student code execution."""
        request = ExecutionRequest(self.prepare_student_code_run, [requests], timeout=1)
        await asyncio.to_thread(self.sync_exec.schedule, request)

    @rpc.route
    async def idle(self, /) -> None:
        """Suspend all execution (synchronous and asynchronous)."""
        suppress = contextlib.suppress(ExecutionError)
        with suppress:
            await asyncio.to_thread(self.sync_exec.cancel)
        with suppress:
            await asyncio.to_thread(self.async_exec.cancel)

    @rpc.route
    async def auto(self, /) -> None:
        """Enter autonomous mode."""
        requests = [{'func': 'autonomous_setup'}, {'func': 'autonomous_main', 'periodic': True}]
        await self.execute(requests)

    @rpc.route
    async def teleop(self, /) -> None:
        """Enter teleop mode."""
        requests = [{'func': 'teleop_setup'}, {'func': 'teleop_main', 'periodic': True}]
        await self.execute(requests)

    @rpc.route
    def estop(self, /) -> None:
        """Raise an emergency stop exception."""
        self.sync_exec.schedule(ExecutionRequest(_estop))


async def main(
    dispatcher: Dispatcher,
    ready: threading.Event,
    name: str,
    **options: Any,
) -> None:
    """Service thread's async entry point."""
    async with process.Application(name, options) as app:
        app.stack.callback(dispatcher.sync_exec.stop)
        await app.make_service(dispatcher)
        dispatcher.async_exec.configure_loop = app.configure_loop
        await Dispatcher.logger.info('Execution dispatcher started')
        # Logger has been attached to this thread's event loop.
        await asyncio.to_thread(ready.set)
        await asyncio.gather(
            app.report_health(),
        )


def target(name: str, **options: Any) -> None:
    """The process entry point."""
    with BufferManager(options['dev_catalog']) as buffers:
        dispatcher = Dispatcher(
            buffers,
            options['exec_module'],
            dict(options['exec_timeout']),
        )
        ready = threading.Event()
        service_thread = threading.Thread(
            target=lambda: asyncio.run(main(dispatcher, ready, name, **options)),
            daemon=True,
            name='service-thread',
        )
        service_thread.start()
        ready.wait()
        async_exec_thread = threading.Thread(
            target=dispatcher.async_exec.execute_forever,
            daemon=True,
            name='async-exec-thread',
        )
        async_exec_thread.start()
        dispatcher.sync_exec.execute_forever()
