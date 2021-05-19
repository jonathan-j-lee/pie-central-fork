"""
Process Management.
"""

import asyncio
import atexit
import contextlib
import dataclasses
import multiprocessing
import threading
from concurrent.futures import ThreadPoolExecutor
from numbers import Real
from typing import Any, Container, Optional, Union
from urllib.parse import urlsplit, urlunsplit

import structlog
import zmq
import zmq.devices

from . import log, rpc
from .exception import EmergencyStopException

__all__ = ['run_process', 'spin', 'EndpointManager']


def cancel_loop(loop: Optional[asyncio.AbstractEventLoop] = None, timeout: Real = 3):
    """
    Cancel all tasks in an event loop and wait for them to terminate.

    Arguments:
        loop: The event loop whose tasks are to be cancelled. Defaults to the running loop.
        timeout: Duration (in seconds) to wait for all tasks to exit.

    Raises:
        RuntimeError: If no loop was provided and there is no currently running loop.

    Note:
        All tasks should quickly clean up their resources. Use with tasks protected by
        :func:`asyncio.shield` is strongly discouraged.

        This function is thread-safe.
    """
    loop = loop or asyncio.get_running_loop()
    tasks = asyncio.all_tasks(loop=loop)
    for task in tasks:
        task.cancel()
    loop.create_task(asyncio.wait_for(asyncio.gather(*tasks), timeout), name='cleanup')


@atexit.register
def clean_up(timeout: Real = 3):
    current_thread, async_threads = threading.current_thread(), []
    for thread in threading.enumerate():
        loop = getattr(thread, 'async_loop', None)
        if loop and loop.is_running() and thread is not current_thread:
            async_threads.append(thread)
    for thread in async_threads:
        cancel_loop(thread.async_loop, 0.9 * timeout)
    for thread in async_threads:
        thread.join(timeout)


def configure_loop(debug: bool = False, workers: int = 1):
    threading.current_thread().async_loop = loop = asyncio.get_running_loop()
    loop.set_debug(debug)
    executor = ThreadPoolExecutor(max_workers=workers, thread_name_prefix='aioworker')
    loop.set_default_executor(executor)
    # Currently, we have no default exception handler.


class AsyncProcess(multiprocessing.Process):
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


AsyncProcessType = Union[AsyncProcess, asyncio.subprocess.Process]


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


def get_connection(bindings: Container[str]) -> str:
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


@dataclasses.dataclass
class EndpointManager:
    name: str
    options: dict[str, Any]
    stack: contextlib.AsyncExitStack = dataclasses.field(default_factory=contextlib.AsyncExitStack)

    async def __aenter__(self):
        configure_loop(debug=self.options['debug'], workers=self.options['thread_pool_workers'])
        await self.make_log_publisher()
        await self.stack.__aenter__()
        return self

    async def __aexit__(self, exc_type, exc, traceback):
        return await self.stack.__aexit__(exc_type, exc, traceback)

    async def make_log_proxy(self) -> zmq.devices.Device:
        proxy = zmq.devices.ThreadDevice(zmq.FORWARDER, zmq.SUB, zmq.PUB)
        for address in self.options['log_backend']:
            proxy.bind_in(address)
        for address in self.options['log_frontend']:
            proxy.bind_out(address)
        proxy.setsockopt_in(zmq.SUBSCRIBE, b'')
        proxy.start()
        return proxy

    async def make_log_publisher(self, node: Optional[rpc.Node] = None) -> log.LogPublisher:
        if not node:  # pragma: no cover
            node = rpc.SocketNode(zmq.PUB, connections=get_connection(self.options['log_backend']))
        publisher = await self.stack.enter_async_context(log.LogPublisher(node))
        log.configure(publisher, fmt=self.options['log_format'], level=self.options['log_level'])
        return publisher

    async def make_log_subscriber(self, handler: rpc.Handler) -> rpc.Service:
        node = rpc.SocketNode(zmq.SUB, connections=get_connection(self.options['log_frontend']))
        return await self.make_service(handler, node)

    async def make_client(self, node: Optional[rpc.Node] = None) -> rpc.Client:
        if not node:
            options = {zmq.IDENTITY: f'{self.name}-client'.encode()}
            options |= dict(self.options['client_option'])
            node = rpc.SocketNode(
                zmq.DEALER,
                connections=get_connection(self.options['router_frontend']),
                options=options,
            )
        return await self.stack.enter_async_context(rpc.Client(node))

    async def make_service(
        self,
        handler: rpc.Handler,
        node: Optional[rpc.Node] = None,
    ) -> rpc.Service:
        if not node:
            options = {zmq.IDENTITY: f'{self.name}-service'.encode()}
            options |= dict(self.options['service_option'])
            node = rpc.SocketNode(
                zmq.DEALER,
                connections=get_connection(self.options['router_backend']),
                options=options,
            )
        service = rpc.Service(handler, node, concurrency=self.options['service_workers'])
        return await self.stack.enter_async_context(service)

    async def make_update_client(self, **options) -> rpc.Client:
        node = rpc.DatagramNode.from_address(self.options['update_addr'], bind=False, **options)
        return await self.make_client(node)

    async def make_control_service(self, handler: rpc.Handler, **options) -> rpc.Service:
        node = rpc.DatagramNode.from_address(self.options['control_addr'], bind=True, **options)
        return await self.make_service(handler, node)

    async def make_router(self) -> rpc.Router:
        router = rpc.Router.bind(self.options['router_frontend'], self.options['router_backend'])
        return await self.stack.enter_async_context(router)
