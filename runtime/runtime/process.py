"""
Process Management.
"""

import abc
import asyncio
import contextlib
import dataclasses
import functools
import multiprocessing
import threading
from concurrent.futures import ThreadPoolExecutor
from numbers import Real
from typing import Any, Collection, Optional, Protocol
from urllib.parse import urlsplit, urlunsplit

import structlog
import zmq
import zmq.devices

from . import log, rpc
from .buffer import BufferManager
from .exception import EmergencyStopException

__all__ = ['AsyncProcess', 'run_process', 'spin', 'Application']


class AsyncProcessType(Protocol):
    pid: Optional[int]
    returncode: Optional[int]

    @abc.abstractmethod
    async def wait(self):
        raise NotImplementedError

    @abc.abstractmethod
    def terminate(self):
        raise NotImplementedError

    @abc.abstractmethod
    def kill(self):
        raise NotImplementedError


class AsyncProcess(multiprocessing.Process, AsyncProcessType):
    def __init__(self, *args, **kwargs):
        kwargs.setdefault('daemon', True)
        super().__init__(*args, **kwargs)
        self.exited = asyncio.Event()

    async def wait(self):
        await self.exited.wait()

    def handle_exit(self):
        """Callback invoked when the process has exited."""
        asyncio.get_running_loop().remove_reader(self.sentinel)
        self.exited.set()

    def start(self):
        super().start()
        asyncio.get_running_loop().add_reader(self.sentinel, self.handle_exit)

    @property
    def returncode(self) -> Optional[int]:
        return self.exitcode


async def run_process(process: AsyncProcessType, *, terminate_timeout: Real = 2) -> Optional[int]:
    """
    Start and stop a subprocess.

    Arguments:
        terminate_timeout: Maximum duration (in seconds) to wait for termination before killing the
            process.

    Returns:
        The process exit code.

    Raises:
        EmergencyStopException: If the subprocess raised an emergency stop.
    """
    if isinstance(process, AsyncProcess) and not process.is_alive():
        process.start()
    proc_name = getattr(process, 'name', '(anonymous)')
    logger = structlog.get_logger(
        wrapper_class=structlog.stdlib.AsyncBoundLogger,
        proc_name=proc_name,
        pid=process.pid,
    )
    try:
        await process.wait()
        await logger.info('Process exited normally', exit_code=process.returncode)
    except asyncio.CancelledError:
        try:
            process.terminate()
            await asyncio.wait_for(process.wait(), terminate_timeout)
            await logger.info('Terminated process cleanly', exit_code=process.returncode)
        except asyncio.TimeoutError:
            process.kill()
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


async def spin(func, /, *args, interval: Real = 1, **kwargs):
    while True:
        await asyncio.gather(asyncio.sleep(interval), func(*args, **kwargs))


def enter_async_context(wrapped):
    @functools.wraps(wrapped)
    async def wrapper(self, /, *args, **kwargs):
        return await self.stack.enter_async_context(await wrapped(self, *args, **kwargs))

    return wrapper


@dataclasses.dataclass
class Application:
    """Open and close resources created from command-line options.

    Generally, you create one :class:`Application` per ``asyncio.run`` main function, like so:

        >>> async def main(**options):
        ...     async with Application('my-app', options) as app:
        ...         ...

    An :class:`Application` produces :class:`rpc.Endpoint` and :class:`rpc.Router` instances in
    common configurations. It also configures the asyncio loop and logging framework, which are
    needed to make the messaging components work.
    """

    name: str
    options: dict[str, Any]
    stack: contextlib.AsyncExitStack = dataclasses.field(default_factory=contextlib.AsyncExitStack)
    nodes: dict[str, rpc.Node] = dataclasses.field(default_factory=dict)
    logger: structlog.stdlib.AsyncBoundLogger = dataclasses.field(
        default_factory=lambda: structlog.get_logger(
            wrapper_class=structlog.stdlib.AsyncBoundLogger,
        ),
    )

    def __post_init__(self):
        self.logger = self.logger.bind(app=self.name)

    async def __aenter__(self):
        self.configure_loop()
        await self.stack.__aenter__()
        self.stack.push_async_callback(self._terminate_zmq_context)
        await self.make_log_publisher()
        return self

    async def __aexit__(self, exc_type, exc, traceback):
        return await self.stack.__aexit__(exc_type, exc, traceback)

    async def _terminate_zmq_context(self):
        zmq.asyncio.Context.instance().term()
        await self.logger.info('ZMQ context terminated')

    def configure_loop(self):
        loop = asyncio.get_running_loop()
        loop.set_debug(self.options['debug'])
        loop.set_default_executor(self.executor)
        loop.set_exception_handler(self.handle_exception)

    @functools.cached_property
    def executor(self) -> ThreadPoolExecutor:
        # pylint: disable=consider-using-with
        # Closed by ``asyncio.AbstractEventLoop.shutdown_default_executor``
        return ThreadPoolExecutor(
            max_workers=self.options['thread_pool_workers'],
            thread_name_prefix='aioworker',
        )

    async def _report_health_callback(self):
        await self.logger.info(
            'Health check',
            thread_count=threading.active_count(),
            task_count=len(asyncio.all_tasks()),
        )

    def report_health(self) -> asyncio.Task:
        return asyncio.create_task(
            spin(self._report_health_callback, interval=self.options['health_check_interval']),
            name='report-health',
        )

    def handle_exception(self, loop: asyncio.AbstractEventLoop, context: dict[str, Any]):
        log_context = {}
        if exception := context.get('exception'):
            log_context['exc_info'] = exception
        if future := context.get('future'):
            log_context['done'] = future.done()
            if isinstance(future, asyncio.Task):
                log_context['task_name'] = future.get_name()
        loop.create_task(self.logger.error(context['message'], **log_context))

    async def make_log_forwarder(self) -> zmq.devices.Device:
        forwarder = zmq.devices.ThreadDevice(zmq.FORWARDER, zmq.SUB, zmq.PUB)
        for address in self.options['log_backend']:
            forwarder.bind_in(address)
        for address in self.options['log_frontend']:
            forwarder.bind_out(address)
        forwarder.setsockopt_in(zmq.SUBSCRIBE, b'')
        forwarder.start()
        return forwarder

    @enter_async_context
    async def make_log_publisher(self, /) -> log.LogPublisher:
        # pylint: disable=unexpected-keyword-arg; pylint does not recognize dataclass.
        node = rpc.SocketNode(zmq.PUB, connections=get_connection(self.options['log_backend']))
        publisher = log.LogPublisher(node)
        log.configure(publisher, fmt=self.options['log_format'], level=self.options['log_level'])
        self.logger = self.logger.bind()
        await self.logger.info(
            'Logging configured',
            fmt=self.options['log_format'],
            level=self.options['log_level'],
        )
        return publisher

    async def make_log_subscriber(self, /, handler: rpc.Handler) -> rpc.Service:
        # pylint: disable=unexpected-keyword-arg; pylint does not recognize dataclass.
        node = rpc.SocketNode(zmq.SUB, connections=get_connection(self.options['log_frontend']))
        return await self.make_service(handler, node)

    @enter_async_context
    async def make_client(self, node: Optional[rpc.Node] = None) -> rpc.Client:
        if not node:
            # pylint: disable=unexpected-keyword-arg; pylint does not recognize dataclass.
            options = dict(self.options['client_option'])
            options.setdefault(zmq.IDENTITY, f'{self.name}-client'.encode())
            node = rpc.SocketNode(
                zmq.DEALER,
                connections=get_connection(self.options['router_frontend']),
                options=options,
            )
        return rpc.Client(node)

    @enter_async_context
    async def make_service(
        self,
        handler: rpc.Handler,
        node: Optional[rpc.Node] = None,
    ) -> rpc.Service:
        if not node:
            # pylint: disable=unexpected-keyword-arg; pylint does not recognize dataclass.
            options = dict(self.options['service_option'])
            options.setdefault(zmq.IDENTITY, f'{self.name}-service'.encode())
            node = rpc.SocketNode(
                zmq.DEALER,
                connections=get_connection(self.options['router_backend']),
                options=options,
            )
        return rpc.Service(handler, node, concurrency=self.options['service_workers'])

    async def make_update_client(self, /) -> rpc.Client:
        node = rpc.DatagramNode.from_address(self.options['update_addr'], bind=False)
        return await self.make_client(node)

    async def make_control_service(self, /, handler: rpc.Handler) -> rpc.Service:
        node = rpc.DatagramNode.from_address(self.options['control_addr'], bind=True)
        return await self.make_service(handler, node)

    @enter_async_context
    async def make_router(self, /) -> rpc.Router:
        return rpc.Router.bind(self.options['router_frontend'], self.options['router_backend'])

    def make_buffer_manager(self, /, *args, **kwargs) -> BufferManager:
        buffers = BufferManager(self.options['dev_catalog'], *args, **kwargs)
        return self.stack.enter_context(buffers)
