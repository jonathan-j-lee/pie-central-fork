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
import warnings
from concurrent.futures import Executor as BaseExecutor
from concurrent.futures import ThreadPoolExecutor
from numbers import Real
from typing import (
    Any,
    Awaitable,
    Callable,
    ClassVar,
    NamedTuple,
    Optional,
    Sequence,
    Union,
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


def handle_timeout(_signum: int, _stack_frame):
    """Signal handler that raises a :class:`TimeoutError`."""
    raise TimeoutError('task timed out')


@contextlib.contextmanager
def using_timer(timeout: Real, interval: Real = 0, **context):
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


def run_once(func: Callable[..., Any], *args: Any, timeout: Real = 1) -> Any:
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
    timeout: Real = 1,
    predicate: Callable[[], bool] = lambda: True,  # pragma: no cover; trivial default value
):
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

    func: Callable[..., Union[None, Awaitable[None]]] = lambda: None
    args: Sequence[Any] = ()
    timeout: Real = 1
    periodic: bool = False


# Sentinel values representing cancellation/stop requests.
# You must compare requests against these constants by *identity*, not value.
CANCEL_REQUEST = ExecutionRequest()
STOP_REQUEST = ExecutionRequest()


class Executor(abc.ABC):
    """Schedule and execute callables with timeouts."""

    @abc.abstractmethod
    def schedule(self, request: ExecutionRequest):
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

    def cancel(self):
        """Cancel all current execution."""
        self.schedule(CANCEL_REQUEST)

    def stop(self):
        """Cancel all execution, then unblock :meth:`execute_forever`."""
        self.schedule(STOP_REQUEST)

    @abc.abstractmethod
    def execute_forever(self):
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

    def schedule(self, request: ExecutionRequest):
        self.requests.put(request)

    def execute(self, request: ExecutionRequest):
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

    def execute_forever(self):
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
class AsyncExecutor(Executor):
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
    running_actions: dict[api.Action, asyncio.Task] = dataclasses.field(default_factory=dict)
    debug: bool = False
    executor: Optional[BaseExecutor] = None

    def schedule(self, request: ExecutionRequest):
        if not self.loop or not self.requests:
            raise ExecutionError('async executor is not ready')
        try:
            current_loop = asyncio.get_running_loop()
        except RuntimeError:
            current_loop = None
        if current_loop is self.loop:
            self.loop.call_soon(self.requests.put_nowait, request)
        else:
            self.loop.call_soon_threadsafe(self.requests.put_nowait, request)

    def cancel_actions(self):
        """Cancel all running actions."""
        for task in list(self.running_actions.values()):
            task.cancel()

    def register_action(self, request: ExecutionRequest):
        """Schedule a regular request as an ``asyncio.Task`` instance."""
        if not request.periodic:
            coro = asyncio.wait_for(request.func(*request.args), request.timeout)
        else:
            coro = process.spin(request.func, *request.args, interval=request.timeout)
        task = asyncio.create_task(coro, name='action')
        self.running_actions[request.func] = task
        task.add_done_callback(lambda _: self.running_actions.pop(request.func, None))

    def configure_loop(self):
        """Configure the event loop and set references to ``asyncio`` resources."""
        process.configure_loop(debug=self.debug, executor=self.executor)
        self.loop = asyncio.get_running_loop()
        self.requests = asyncio.Queue(self.requests_size)

    async def dispatch(self, *, cooldown: Real = 1):
        """Receive and handle requests from the queue."""
        self.configure_loop()
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
                await asyncio.to_thread(logger.info, 'Executor cancelled')
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

    def execute_forever(self):
        asyncio.run(self.dispatch())

    def run(self, action: api.Action, *args: Any, timeout: Real = 30, periodic: bool = False):
        """Student-friendly wrapper around :meth:`AsyncExecutor.schedule`."""
        self.schedule(ExecutionRequest(action, args, timeout, periodic))

    def is_running(self, action: api.Action) -> bool:
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

    student_code_name: dataclasses.InitVar[str] = 'studentcode'
    timeouts: dict[re.Pattern, Real] = dataclasses.field(default_factory=dict)
    student_code: types.ModuleType = dataclasses.field(init=False)
    sync_exec: SyncExecutor = dataclasses.field(default_factory=SyncExecutor)
    async_exec: AsyncExecutor = dataclasses.field(default_factory=AsyncExecutor)
    buffers: BufferManager = dataclasses.field(default_factory=BufferManager)
    logger: ClassVar[structlog.stdlib.AsyncBoundLogger] = structlog.get_logger(
        wrapper_class=structlog.stdlib.AsyncBoundLogger,
    )

    def __post_init__(self, student_code_name: str):
        self.student_code = types.ModuleType(student_code_name)

    @property
    def should_import(self) -> bool:
        """Whether student code should be imported for the first time."""
        return not hasattr(self.student_code, '__file__')

    def _print(self, *values, sep: str = ' ', file=None, flush: bool = False):
        message = sep.join(map(str, values))
        self.logger.sync_bl.info(message, student_print=True)

    def reload(self):
        """Load student code from disk and monkey-patch in the Runtime API."""
        if self.should_import:
            self.student_code = importlib.import_module(self.student_code.__name__)
        else:
            self.student_code = importlib.reload(self.student_code)
        self.student_code.Alliance = api.Alliance
        self.student_code.Actions = api.Actions(self.async_exec)
        self.student_code.Robot = api.Robot(self.buffers)
        self.student_code.Gamepad = api.Gamepad(self.buffers)
        self.student_code.Field = api.Field(self.buffers)
        self.student_code.print = self._print
        self.logger.sync_bl.info('Student code reloaded', student_code=self.student_code.__name__)

    def prepare_student_code_run(self, requests: list[dict[str, Any]]):
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
    async def execute(self, requests: list[dict[str, Any]]):
        """Request student code execution."""
        request = ExecutionRequest(self.prepare_student_code_run, [requests], timeout=1)
        await asyncio.to_thread(self.sync_exec.schedule, request)

    @rpc.route
    async def idle(self):
        """Suspend all execution (synchronous and asynchronous)."""
        suppress = contextlib.suppress(ExecutionError)
        with suppress:
            await asyncio.to_thread(self.sync_exec.cancel)
        with suppress:
            await asyncio.to_thread(self.async_exec.cancel)

    @rpc.route
    async def auto(self):
        """Enter autonomous mode."""
        requests = [{'func': 'autonomous_setup'}, {'func': 'autonomous_main', 'periodic': True}]
        await self.execute(requests)

    @rpc.route
    async def teleop(self):
        """Enter teleop mode."""
        requests = [{'func': 'teleop_setup'}, {'func': 'teleop_main', 'periodic': True}]
        await self.execute(requests)

    @rpc.route
    async def estop(self):
        """Raise an emergency stop exception."""
        raise EmergencyStopException


async def main(
    dispatcher: Dispatcher,
    executor: BaseExecutor,
    ready: threading.Event,
    name: str,
    **options,
):
    """Service thread's async entry point."""
    async with process.EndpointManager(name, options, executor) as manager:
        await manager.make_service(dispatcher)
        await Dispatcher.logger.info('Execution dispatcher started')
        # Logger has been attached to this thread's event loop.
        await asyncio.to_thread(ready.set)
        await asyncio.gather(
            asyncio.sleep(3600),  # TODO: replace with health check
        )


def target(name: str, **options):
    """The process entry point."""
    with contextlib.ExitStack() as stack:
        executor = stack.enter_context(
            ThreadPoolExecutor(
                max_workers=options['thread_pool_workers'],
                thread_name_prefix='aioworker',
            )
        )
        dispatcher = Dispatcher(
            options['exec_module'],
            dict(options['exec_timeout']),
            async_exec=AsyncExecutor(debug=options['debug'], executor=executor),
            buffers=stack.enter_context(BufferManager()),
        )
        dispatcher.buffers.load_catalog(options['dev_catalog'])

        ready = threading.Event()
        service_thread = threading.Thread(
            target=lambda: asyncio.run(main(dispatcher, executor, ready, name, **options)),
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
