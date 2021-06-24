"""Process and resource management.

Wrapping other low-level modules, this module provides a high-level interface for
managing processes, endpoints, and other resources. This module is intended for
consumption by service handlers and tools implementing Runtime's business logic.
"""

import abc
import asyncio
import contextlib
import functools
import multiprocessing
import signal
import socket
import struct
import threading
import types
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import (
    Any,
    AsyncContextManager,
    Awaitable,
    Callable,
    Collection,
    Mapping,
    NoReturn,
    Optional,
    Protocol,
    TypeVar,
)
from urllib.parse import urlsplit, urlunsplit

import zmq
import zmq.devices

from . import log, remote
from .buffer import BufferStore
from .exception import EmergencyStopException

# isort: unique-list
__all__ = ['Application', 'AsyncProcess', 'AsyncProcessType', 'run_process', 'spin']


class AsyncProcessType(Protocol):
    """Abstract base type for subprocesses.

    This interface contains a subset of :class:`asyncio.subprocess.Process` and follows
    similar semantics.
    """

    @abc.abstractmethod
    async def wait(self, /) -> Optional[int]:
        """Wait for the child process to terminate.

        Returns:
            The exit code (:attr:`AsyncProcessType.returncode`).

        Raises:
            ValueError: If the process is not yet started.
        """
        raise NotImplementedError

    @abc.abstractmethod
    def terminate(self, /) -> None:
        """Stop the child process.

        The behavior is platform-dependent. On POSIX systems, this method sends the
        ``SIGTERM`` signal to the child process.
        """
        raise NotImplementedError

    @abc.abstractmethod
    def kill(self, /) -> None:
        """Forcefully kill the child process.

        The behavior is platform-dependent. On POSIX systems, this method sends the
        ``SIGKILL`` signal to the child process.
        """
        raise NotImplementedError

    @property
    @abc.abstractmethod
    def pid(self, /) -> Optional[int]:
        """The process identifier (PID)."""
        raise NotImplementedError

    @property
    @abc.abstractmethod
    def returncode(self, /) -> Optional[int]:
        """The return (exit) code of a terminated process.

        This attribute is ``None`` for processes that have not yet exited.
        """
        raise NotImplementedError


class AsyncProcess(multiprocessing.Process, AsyncProcessType):
    """A subprocess with a callable as an entry point.

    This class is the asynchronous version of :class:`multiprocessing.Process`, meaning
    that the parent process can join the child process asynchronously. The
    implementation works with :mod:`asyncio` natively by watching a file descriptor that
    is ready to read once the process exits. This event-triggered approach does not need
    a helper task/thread dedicated to blocking on :meth:`multiprocessing.Process.join`
    or polling :meth:`multiprocessing.Process.is_alive`.

    Parameters:
        args: Positional arguments to :class:`multiprocessing.Process`.
        kwargs: Keyword arguments to :class:`multiprocessing.Process`. By default, this
            is a daemon process.
    """

    def __init__(self, /, *args: Any, **kwargs: Any) -> None:
        kwargs.setdefault('daemon', True)
        super().__init__(*args, **kwargs)
        self.exited: Optional[asyncio.Event] = None

    async def wait(self, /) -> Optional[int]:
        if not self.exited:
            raise ValueError('must start process before waiting')
        await self.exited.wait()
        return self.returncode

    def _handle_exit(self, /) -> None:
        asyncio.get_running_loop().remove_reader(self.sentinel)
        if self.exited:  # pragma: no cover; ``start`` is always called first
            self.exited.set()

    def start(self, /) -> None:
        super().start()
        # All the attributes of a ``multiprocessing.Process`` are apparently pickled
        # with the 'spawn' start method. Because ``asyncio.Event`` cannot be pickled (it
        # is attached to the parent process's event loop), we must create the ``exited``
        # event *after* the process is started.
        self.exited = asyncio.Event()
        asyncio.get_running_loop().add_reader(self.sentinel, self._handle_exit)

    @property
    def returncode(self, /) -> Optional[int]:
        return self.exitcode


async def run_process(
    process: AsyncProcessType,
    *,
    terminate_timeout: float = 2,
) -> Optional[int]:
    """
    Start and wait for a subprocess to exit.

    If the task running this function is cancelled in the parent process while the child
    process has not yet exited, this function will attempt to terminate the child. If
    the child is not well-behaved and does not terminate by a timeout, this function
    kills the child, guaranteeing no orphan process left behind.

    Once the child is dead, this function also inspects the child's return code to
    determine if it raised an emergency stop. If so, this function re-raises the
    exception.

    Parameters:
        process: The subprocess, which will be started if it is an instance of
            :class:`AsyncProcess` and not yet alive.
        terminate_timeout: Maximum duration (in seconds) to wait for termination.

    Returns:
        The process exit code.

    Raises:
        EmergencyStopException: If the subprocess raised an emergency stop.
    """
    if isinstance(process, AsyncProcess) and not process.is_alive():
        process.start()
    logger = log.get_logger().bind(
        process=getattr(process, 'name', '(anonymous)'),
        pid=process.pid,
    )
    await logger.info('Process started')
    try:
        await process.wait()
        await logger.info('Process exited normally', exit_code=process.returncode)
    except asyncio.CancelledError:
        try:
            process.terminate()
            await asyncio.wait_for(process.wait(), terminate_timeout)
            await logger.info('Terminated process', exit_code=process.returncode)
        except asyncio.TimeoutError:
            process.kill()
            await process.wait()
            await logger.error('Killed process')
    if process.returncode == EmergencyStopException.EXIT_CODE:
        await logger.critical('Received emergency stop', exit_code=process.returncode)
        raise EmergencyStopException
    return process.returncode


def resolve_address(address: str, *, peer: str = '127.0.0.1') -> str:
    """Resolve '*' (all available interfaces in ZMQ) to a concrete address.

    Parameters:
        address: ZMQ address (URL-like).
        peer: The hostname to substitute.

    Returns:
        The address with a concrete hostname (if the protocol requires it).

    Examples:
        >>> resolve_address('tcp://*:6000')
        'tcp://127.0.0.1:6000'
        >>> resolve_address('tcp:// *:6000')
        'tcp:// *:6000'
    """
    components = urlsplit(address)
    if components.scheme == 'ipc':
        return address
    if components.hostname == '*':
        components = components._replace(netloc=components.netloc.replace('*', peer, 1))
    return urlunsplit(components)


def get_connection(bindings: Collection[str]) -> str:
    """Find an address to connect to from one or more bound addresses.

    Parameters:
        bindings: ZMQ addresses the peer socket is bound to (URL-like).

    Returns:
        A suitable address to connect to. Address with the ``ipc`` protocol are
        prioritized over those that require the IP network stack. ``ipc`` is often
        backed by UNIX domain sockets, which avoid the layering that TCP/IP requires.

    Raises:
        ValueError: If no bindings are provided.

    Examples:
        >>> get_connection(['tcp://*:6000'])
        'tcp://127.0.0.1:6000'
        >>> get_connection(['tcp://*:6000', 'ipc:///tmp/rt.sock'])
        'ipc:///tmp/rt.sock'
        >>> get_connection([])
        Traceback (most recent call last):
          ...
        ValueError: must provide at least one address
    """
    if not bindings:
        raise ValueError('must provide at least one address')
    key = lambda address: float('-inf') if address.startswith('ipc') else float('inf')
    address, *_ = sorted(map(resolve_address, bindings), key=key)
    return address


async def spin(
    func: Callable[..., Awaitable[Any]],
    /,
    *args: Any,
    interval: float = 1,
    **kwargs: Any,
) -> NoReturn:
    """Periodically execute an async callback.

    Parameters:
        func: Async callback.
        args: Positonal arguments to the callback.
        interval: Duration (in seconds) between calls. The callback is allows to run for
            longer than the interval. The callback should implement any timeout logic
            if cancellation is desired.
        kwargs: Keyword arguments to the callback.
    """
    while True:
        await asyncio.gather(asyncio.sleep(interval), func(*args, **kwargs))


RT = TypeVar('RT')


def enter_async_context(
    wrapped: Callable[..., Awaitable[AsyncContextManager[RT]]],
) -> Callable[..., Awaitable[RT]]:
    """Decorator that adds an async context manager to an async exit stack."""

    @functools.wraps(wrapped)
    async def wrapper(self: 'Application', /, *args: Any, **kwargs: Any) -> RT:
        resource = await wrapped(self, *args, **kwargs)
        return await self.stack.enter_async_context(resource)

    return wrapper


@dataclass
class Application:
    """An application opens and closes resources created from command-line options.

    Generally, you create one :class:`Application` per ``asyncio.run`` main function,
    like so::

        >>> async def main(**options):
        ...     async with Application('my-app', options) as app:
        ...         ...

    An :class:`Application` produces :class:`remote.Endpoint` and :class:`remote.Router`
    instances in common configurations. It also configures the :mod:`asyncio` loop and
    logging framework, which are needed to make the messaging components work.

    Parameters:
        name: The name of the application (preferably kebab case and unique across all
            applications).
        options: A map of option names to their values.
        stack: The stack that the app's resources are pushed on.
        endpoints: A map of endpoint names to endpoints.
        logger: A logger instance (may not be bound).
    """

    name: str
    options: Mapping[str, Any]
    stack: contextlib.AsyncExitStack = field(default_factory=contextlib.AsyncExitStack)
    endpoints: dict[str, remote.SocketNode] = field(default_factory=dict)
    logger: log.AsyncLogger = field(default_factory=log.get_logger)

    async def __aenter__(self, /) -> 'Application':
        self.configure_loop()
        await self.stack.__aenter__()
        self.stack.push_async_callback(self._terminate_zmq_context)
        log.configure(fmt=self.options['log_format'], level=self.options['log_level'])
        return self

    async def __aexit__(
        self,
        exc_type: Optional[type[BaseException]],
        exc: Optional[BaseException],
        traceback: Optional[types.TracebackType],
        /,
    ) -> Optional[bool]:
        hide_exc = await self.stack.__aexit__(exc_type, exc, traceback)
        if exc_type and issubclass(exc_type, asyncio.CancelledError):
            await self.logger.info('Application is exiting')
            return True
        return hide_exc

    async def _terminate_zmq_context(self, /) -> None:
        zmq.asyncio.Context.instance().term()
        await self.logger.debug('ZMQ context terminated')

    @functools.cached_property
    def executor(self, /) -> ThreadPoolExecutor:
        """A thread pool executor for running synchronous tasks."""
        # pylint: disable=consider-using-with
        # Closed by ``asyncio.AbstractEventLoop.shutdown_default_executor``
        return ThreadPoolExecutor(
            max_workers=self.options['thread_pool_workers'],
            thread_name_prefix='aioworker',
        )

    def _handle_exc(
        self,
        loop: asyncio.AbstractEventLoop,
        ctx: dict[str, Any],
        /,
    ) -> None:
        context = {}
        if exception := ctx.get('exception'):
            context['exc_info'] = exception
        if future := ctx.get('future'):
            context['done'] = future.done()
            if isinstance(future, asyncio.Task):
                context['task_name'] = future.get_name()
        loop.create_task(
            asyncio.to_thread(self.logger.sync_bl.error, ctx['message'], **context),
        )

    def configure_loop(self, /) -> None:
        """Configure the current :mod:`asyncio` loop and environment.

        * Sets the debug flag, default executor, and exception handler, which logs
          exceptions produced by event loop callbacks.
        * Set the current task and thread names.
        * If this method is called in the main thread, set signal handlers for
          ``SIGINT`` and ``SIGTERM`` that cancel the current task.

        Note:
            This method assumes the current task is the main task run by
            :func:`asyncio.run`.
        """
        loop = asyncio.get_running_loop()
        loop.set_debug(self.options['debug'])
        loop.set_default_executor(self.executor)
        loop.set_exception_handler(self._handle_exc)
        current_thread = threading.current_thread()
        current_thread.name = f'{self.name}-service'
        current_task = asyncio.current_task()
        if not current_task:
            return
        current_task.set_name('main')
        if current_thread is threading.main_thread():
            for signum in (signal.SIGINT, signal.SIGTERM):
                # ``asyncio.run`` will cancel all outstanding tasks and ensure they run
                # to completion. Cancelling all tasks here, not just the main task,
                # removes the outstanding tasks from ``asyncio.all_tasks`` and prevents
                # ``asyncio.run`` from waiting on them.
                loop.add_signal_handler(
                    signum,
                    current_task.cancel,
                    f'received signal {signum}: {signal.strsignal(signum)}',
                )

    async def _health_cb(self, /) -> None:
        await self.logger.info(
            'Health check',
            thread_count=threading.active_count(),
            task_count=len(asyncio.all_tasks()),
        )

    def report_health(self, /) -> asyncio.Task[NoReturn]:
        """Schedule a task to periodically log the health of this process."""
        return asyncio.create_task(
            spin(self._health_cb, interval=self.options['health_check_interval']),
            name='report-health',
        )

    async def make_log_forwarder(self, /) -> zmq.devices.Device:
        """Make a threaded device that forwards ZMQ PUB-SUB messages emitted by loggers.

        The device is subscribed to all messages. Both sockets bind to fixed addresses.
        """
        forwarder = zmq.devices.ThreadDevice(zmq.FORWARDER, zmq.SUB, zmq.PUB)
        for address in self.options['log_backend']:
            forwarder.bind_in(address)
        for address in self.options['log_frontend']:
            forwarder.bind_out(address)
        forwarder.setsockopt_in(zmq.SUBSCRIBE, b'')
        forwarder.start()
        await asyncio.sleep(0.05)
        return forwarder

    async def make_log_publisher(self, /) -> log.LogPublisher:
        """Make a client that connects to the log forwarder's backend socket.

        The publisher will be installed in the processor chain.
        """
        # pylint: disable=unexpected-keyword-arg; dataclass not recognized
        node = remote.SocketNode(
            socket_type=zmq.PUB,
            connections=frozenset({get_connection(self.options['log_backend'])}),
        )
        publisher = await self.stack.enter_async_context(log.LogPublisher(node))
        await asyncio.sleep(0.05)
        log.configure(
            publisher,
            fmt=self.options['log_format'],
            level=self.options['log_level'],
        )
        self.logger = self.logger.bind(app=self.name)
        await self.logger.info(
            'Log publisher configured',
            fmt=self.options['log_format'],
            min_level=self.options['log_level'],
        )
        return publisher

    async def make_log_subscriber(self, /, handler: remote.Handler) -> remote.Service:
        """Make a service that connects to the log forwarder's frontend socket.

        Parameters:
            handler: A remote call handler. The subscriber will call the handler's
                methods when it receives a logged message. Each method should be named
                after the log level it handles (*e.g.*, ``debug``) and take a single
                positional argument: the event dictionary (see
                :func:`runtime.log.configure` for details on the format).
        """
        # pylint: disable=unexpected-keyword-arg; dataclass not recognized
        min_level = log.get_level_num(self.options['log_level'])
        subs = {level for level in log.LEVELS if log.get_level_num(level) >= min_level}
        node = remote.SocketNode(
            socket_type=zmq.SUB,
            connections=frozenset({get_connection(self.options['log_frontend'])}),
            subscriptions=subs,
        )
        return await self.make_service(handler, node, logger=log.get_null_logger())

    @enter_async_context
    async def make_client(self, /, node: Optional[remote.Node] = None) -> remote.Client:
        """Make and start a remote call client.

        Parameters:
            node: The node the client should wrap. If not provided, this method
                constructs and uses a node backed by a ``DEALER`` socket and connected
                to the router frontend. By default, the socket's identity is the app
                named suffixed by ``-client``.
        """
        name = f'{self.name}-client'
        if not node:
            # pylint: disable=unexpected-keyword-arg; dataclass not recognized
            options = dict(self.options['client_option'])
            options.setdefault(zmq.IDENTITY, name.encode())
            connection = get_connection(self.options['router_frontend'])
            node = remote.SocketNode(
                socket_type=zmq.DEALER,
                connections=frozenset({connection}),
                options=options,
            )
        return remote.Client(node, logger=self.logger.bind(name=name))

    @enter_async_context
    async def make_service(
        self,
        /,
        handler: remote.Handler,
        node: Optional[remote.Node] = None,
        logger: Optional[log.AsyncLogger] = None,
    ) -> remote.Service:
        """Make and start a remote call service.

        Parameters:
            handler: A remote call handler.
            node: The node the service should wrap. If not provided, this method
                constructs and uses a node backed by a ``DEALER`` socket and connected
                to the router backend. By default, the socket's identity is the app name
                suffixed by ``-service``.
            logger: The logger passed to the service.
        """
        name = f'{self.name}-service'
        if not node:
            # pylint: disable=unexpected-keyword-arg; dataclass not recognized
            options = dict(self.options['service_option'])
            options.setdefault(zmq.IDENTITY, name.encode())
            node = remote.SocketNode(
                socket_type=zmq.DEALER,
                connections=frozenset({get_connection(self.options['router_backend'])}),
                options=options,
            )
        logger = logger or self.logger
        return remote.Service(
            node=node,
            handler=handler,
            concurrency=self.options['service_workers'],
            logger=logger.bind(name=name),
        )

    async def make_update_client(self, /) -> remote.Client:
        """Make a client for publishing Smart Device updates over UDP/IP multicast.

        Since the message flow is unidirectional, notification messages are recommended.
        """
        node = remote.DatagramNode.from_address(self.options['update_addr'], bind=False)
        return await self.make_client(node)

    async def make_update_service(self, /, handler: remote.Handler) -> remote.Service:
        """Make a service for receiving Smart Device updates over UDP/IP multicast.

        Parameters:
            handler: A remote call handler with a bound method ``update``, which accepts
                a single positional argument (an update object) and returns nothing.

        Note:
            The format of an update object is::

                {
                    "<gamepad-index>": {
                        "lx": <float: [-1, 1]>,
                        "ly": <float: [-1, 1]>,
                        "rx": <float: [-1, 1]>,
                        "ry": <float: [-1, 1]>,
                        "btn": int,
                    },
                    ...
                }

            The ``[lr][xy]`` keys represent joystick positions, where ``l`` and ``r``
            stand for left and right, respectively, and ``x`` and ``y`` are Cartesian
            coordinates. The origin (0, 0) corresponds to the joystick in the resting
            position. Each joystick is constrained within the unit circle.

            ``btn`` is a bitmask where a "1" bit indicates the corresponding button is
            pressed. Consult the device catalog for which buttons correspond to which
            bits. (The first parameters correspond to the lower-order bits.)
        """
        node = remote.DatagramNode.from_address(self.options['update_addr'], bind=True)
        membership = struct.pack('4sl', socket.inet_aton(node.host), socket.INADDR_ANY)
        node.options = {
            (socket.SOL_SOCKET, socket.SO_BROADCAST, 1),
            (socket.IPPROTO_IP, socket.IP_MULTICAST_TTL, 1),
            (socket.IPPROTO_IP, socket.IP_ADD_MEMBERSHIP, membership),
        }
        return await self.make_service(handler, node)

    async def make_control_client(self, /) -> remote.Client:
        """Make a client for sending gamepad (control) inputs.

        Since the message flow is unidirectional, notification messages are recommended.
        """
        node = remote.DatagramNode.from_address(
            self.options['control_addr'],
            bind=False,
        )
        return await self.make_client(node)

    async def make_control_service(self, /, handler: remote.Handler) -> remote.Service:
        """Make a service for receiving gamepad (control) inputs.

        Parameters:
            handler: A remote call handler with a bound method ``update_gamepads``,
                which accepts a single positional argument (an update object) and
                returns nothing.

        Note:
            The format of an update object is::

                {"<uid>": {"<param-name>": <value>}}
        """
        node = remote.DatagramNode.from_address(self.options['control_addr'], bind=True)
        return await self.make_service(handler, node)

    @enter_async_context
    async def make_router(self, /) -> remote.Router:
        """Make a router for passing remote call requests and responses."""
        return remote.Router.bind(
            self.options['router_frontend'],
            self.options['router_backend'],
        )

    def make_buffer_manager(self, /, *, shared: bool = True) -> BufferStore:
        """Make a buffer manager.

        Parameters:
            shared: :data:`True` if the buffers should be backed by shared memory,
                :data:`False` for non-shared (private) memory.
        """
        catalog = BufferStore.make_catalog(self.options['dev_catalog'])
        buffers = BufferStore(catalog, shared=shared)
        return self.stack.enter_context(buffers)
