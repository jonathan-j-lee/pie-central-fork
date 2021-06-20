"""
Process Management.
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
    NoReturn,
    Optional,
    Protocol,
    TypeVar,
)
from urllib.parse import urlsplit, urlunsplit

import zmq
import zmq.devices

from . import log, remote
from .buffer import BufferManager
from .exception import EmergencyStopException

__all__ = ['AsyncProcess', 'run_process', 'spin', 'Application']


class AsyncProcessType(Protocol):
    @abc.abstractmethod
    async def wait(self, /) -> Optional[int]:
        raise NotImplementedError

    @abc.abstractmethod
    def terminate(self, /) -> None:
        raise NotImplementedError

    @abc.abstractmethod
    def kill(self, /) -> None:
        raise NotImplementedError

    @property
    @abc.abstractmethod
    def pid(self, /) -> Optional[int]:
        raise NotImplementedError

    @property
    @abc.abstractmethod
    def returncode(self, /) -> Optional[int]:
        raise NotImplementedError


class AsyncProcess(multiprocessing.Process, AsyncProcessType):
    def __init__(self, *args: Any, **kwargs: Any) -> None:
        kwargs.setdefault('daemon', True)
        super().__init__(*args, **kwargs)
        self.exited: Optional[asyncio.Event] = None

    async def wait(self, /) -> Optional[int]:
        if not self.exited:
            raise ValueError('must start process before waiting')
        await self.exited.wait()
        return self.returncode

    def _handle_exit(self, /) -> None:
        """Callback invoked when the process has exited."""
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
    Start and stop a subprocess.

    Arguments:
        terminate_timeout: Maximum duration (in seconds) to wait for termination before
            killing the process.

    Returns:
        The process exit code.

    Raises:
        EmergencyStopException: If the subprocess raised an emergency stop.
    """
    if isinstance(process, AsyncProcess) and not process.is_alive():
        process.start()
    logger = log.get_logger(
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


def resolve_address(address: str, peer: str = '127.0.0.1') -> str:
    """Resolve '*' (all available interfaces) to a concrete address.

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

    Arguments:
        bindings: Addresses the peer socket is bound to.

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
    func: Callable[..., Any], /, *args: Any, interval: float = 1, **kwargs: Any
) -> NoReturn:
    while True:
        await asyncio.gather(asyncio.sleep(interval), func(*args, **kwargs))


RT = TypeVar('RT')


def enter_async_context(
    wrapped: Callable[..., Awaitable[AsyncContextManager[RT]]],
) -> Callable[..., Awaitable[RT]]:
    @functools.wraps(wrapped)
    async def wrapper(self: 'Application', /, *args: Any, **kwargs: Any) -> RT:
        cm = await wrapped(self, *args, **kwargs)
        return await self.stack.enter_async_context(cm)

    return wrapper


@dataclass
class Application:
    """Open and close resources created from command-line options.

    Generally, you create one :class:`Application` per ``asyncio.run`` main function,
    like so:

        >>> async def main(**options):
        ...     async with Application('my-app', options) as app:
        ...         ...

    An :class:`Application` produces :class:`remote.Endpoint` and :class:`remote.Router`
    instances in common configurations. It also configures the asyncio loop and logging
    framework, which are needed to make the messaging components work.
    """

    name: str
    options: dict[str, Any]
    stack: contextlib.AsyncExitStack = field(default_factory=contextlib.AsyncExitStack)
    nodes: dict[str, remote.Node] = field(default_factory=dict)
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
    ) -> Optional[bool]:
        hide_exc = await self.stack.__aexit__(exc_type, exc, traceback)
        if exc_type and issubclass(exc_type, asyncio.CancelledError):
            await self.logger.info('Application is exiting')
            return True
        return hide_exc

    async def _terminate_zmq_context(self) -> None:
        zmq.asyncio.Context.instance().term()
        await self.logger.debug('ZMQ context terminated')

    def configure_loop(self) -> None:
        loop = asyncio.get_running_loop()
        loop.set_debug(self.options['debug'])
        loop.set_default_executor(self.executor)
        loop.set_exception_handler(self._handle_exc)
        current_task = asyncio.current_task()
        current_thread = threading.current_thread()
        current_thread.name = f'{self.name}-service'
        if current_thread is threading.main_thread() and current_task:
            for signum in {signal.SIGINT, signal.SIGTERM}:
                # ``asyncio.run`` will cancel all outstanding tasks and ensure they run
                # to completion. Cancelling all tasks here, not just the main task,
                # removes the outstanding tasks from ``asyncio.all_tasks`` and prevents
                # ``asyncio.run`` from waiting on them.
                loop.add_signal_handler(
                    signum,
                    current_task.cancel,
                    f'received signal {signum}: {signal.strsignal(signum)}',
                )

    @functools.cached_property
    def executor(self) -> ThreadPoolExecutor:
        # pylint: disable=consider-using-with
        # Closed by ``asyncio.AbstractEventLoop.shutdown_default_executor``
        return ThreadPoolExecutor(
            max_workers=self.options['thread_pool_workers'],
            thread_name_prefix='aioworker',
        )

    async def _health_cb(self) -> None:
        await self.logger.info(
            'Health check',
            thread_count=threading.active_count(),
            task_count=len(asyncio.all_tasks()),
        )

    def report_health(self) -> asyncio.Task[NoReturn]:
        return asyncio.create_task(
            spin(self._health_cb, interval=self.options['health_check_interval']),
            name='report-health',
        )

    def _handle_exc(self, loop: asyncio.AbstractEventLoop, ctx: dict[str, Any]) -> None:
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

    async def make_log_forwarder(self) -> zmq.devices.Device:
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
        # pylint: disable=unexpected-keyword-arg; dataclass not recognized
        node = remote.SocketNode(
            socket_type=zmq.PUB,
            connections=frozenset({get_connection(self.options['log_backend'])}),
        )
        publisher = await self.stack.enter_async_context(log.LogPublisher(node))
        log.configure(
            publisher,
            fmt=self.options['log_format'],
            level=self.options['log_level'],
        )
        self.logger = self.logger.bind(app=self.name)
        await asyncio.sleep(0.05)
        await self.logger.info(
            'Log publisher configured',
            fmt=self.options['log_format'],
            min_level=self.options['log_level'],
        )
        return publisher

    async def make_log_subscriber(self, /, handler: remote.Handler) -> remote.Service:
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
    async def make_client(self, node: Optional[remote.Node] = None) -> remote.Client:
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
        node = remote.DatagramNode.from_address(self.options['update_addr'], bind=False)
        return await self.make_client(node)

    async def make_update_service(self, /, handler: remote.Handler) -> remote.Service:
        node = remote.DatagramNode.from_address(self.options['update_addr'], bind=True)
        membership = struct.pack('4sl', socket.inet_aton(node.host), socket.INADDR_ANY)
        node.options = {
            (socket.SOL_SOCKET, socket.SO_BROADCAST, 1),
            (socket.IPPROTO_IP, socket.IP_MULTICAST_TTL, 1),
            (socket.IPPROTO_IP, socket.IP_ADD_MEMBERSHIP, membership),
        }
        return await self.make_service(handler, node)

    async def make_control_client(self, /) -> remote.Client:
        node = remote.DatagramNode.from_address(
            self.options['control_addr'],
            bind=False,
        )
        return await self.make_client(node)

    async def make_control_service(self, /, handler: remote.Handler) -> remote.Service:
        node = remote.DatagramNode.from_address(self.options['control_addr'], bind=True)
        return await self.make_service(handler, node)

    @enter_async_context
    async def make_router(self, /) -> remote.Router:
        return remote.Router.bind(
            self.options['router_frontend'],
            self.options['router_backend'],
        )

    def make_buffer_manager(self, /, *args: Any, **kwargs: Any) -> BufferManager:
        catalog = BufferManager.make_catalog(self.options['dev_catalog'])
        buffers = BufferManager(catalog, *args, **kwargs)
        return self.stack.enter_context(buffers)
