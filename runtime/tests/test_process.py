import asyncio
import dataclasses
import functools
import multiprocessing
import random
import signal
import threading
import time
from unittest.mock import ANY

import pytest
import structlog
import zmq
import zmq.asyncio

from runtime import log, process, rpc
from runtime.exception import RuntimeBaseException, EmergencyStopException


@pytest.fixture
async def app():
    get_random_port = lambda: random.randrange(3000, 10000)
    options = {
        'debug': True,
        'thread_pool_workers': 3,
        'log_frontend': [f'tcp://*:{get_random_port()}'],
        'log_backend': [f'tcp://*:{get_random_port()}'],
        'log_format': 'json',
        'log_level': 'info',
        'client_option': [(zmq.SNDTIMEO, 1000)],
        'service_option': [],
        'service_workers': 4,
        'router_frontend': [f'tcp://*:{get_random_port()}'],
        'router_backend': [f'tcp://*:{get_random_port()}'],
        'update_addr': f'udp://localhost:{get_random_port()}',
        'control_addr': f'udp://localhost:{get_random_port()}',
        'health_check_interval': 60,
    }
    async with process.Application('test', options) as app:
        await app.make_log_forwarder()
        await app.make_log_publisher()
        await app.make_router()
        yield app
    # The log forwarder eventually exits. Because the ports are randomized, tests should not clash.


class MathHandler(rpc.Handler):
    @rpc.route
    async def add(self, a: int, b: int) -> int:
        return a + b


@dataclasses.dataclass
class LogHandler(rpc.Handler):
    queue: asyncio.Queue[tuple[str, dict]] = dataclasses.field(default_factory=asyncio.Queue)

    @rpc.route
    async def debug(self, event):
        await self.queue.put(event)

    @rpc.route
    async def info(self, event):
        await self.queue.put(event)

    @rpc.route
    async def warning(self, event):
        await self.queue.put(event)


def test_runtime_exc_render():
    exc = RuntimeBaseException('disconnect', error_code=0xff, device='limit-switch')
    exc_dup = eval(repr(exc))
    assert exc.context == exc_dup.context


@pytest.mark.asyncio
async def test_process_run():
    def target(ready, done):
        ready.set()
        done.wait()
    ready, done = multiprocessing.Event(), multiprocessing.Event()
    proc = process.AsyncProcess(target=target, args=(ready, done))
    proc = asyncio.create_task(process.run_process(proc))
    await asyncio.to_thread(ready.wait)
    assert len(multiprocessing.active_children()) == 1
    done.set()
    assert await proc == 0
    assert len(multiprocessing.active_children()) == 0


def indefinite_target(handle_termination):
    signal.signal(signal.SIGTERM, handle_termination)
    while True:
        time.sleep(1)


@pytest.mark.slow
@pytest.mark.asyncio
async def test_process_terminate():
    proc = process.AsyncProcess(target=indefinite_target, args=(lambda *_: exit(0xf),))
    proc = asyncio.create_task(process.run_process(proc))
    with pytest.raises(asyncio.TimeoutError):
        await asyncio.wait_for(proc, 0.3)
    await asyncio.sleep(0.1)
    assert await proc == 0xf
    assert len(multiprocessing.active_children()) == 0


@pytest.mark.slow
@pytest.mark.asyncio
async def test_process_kill():
    proc = process.AsyncProcess(target=indefinite_target, args=(lambda *_: None,))
    proc = asyncio.create_task(process.run_process(proc, terminate_timeout=0.3))
    with pytest.raises(asyncio.TimeoutError):
        await asyncio.wait_for(proc, 0.3)
    await asyncio.sleep(0.1)
    assert await proc != 0


@pytest.mark.asyncio
async def test_process_estop():
    def target():
        raise EmergencyStopException
    proc = process.AsyncProcess(target=target)
    proc.start()
    with pytest.raises(EmergencyStopException):
        await process.run_process(proc)


@pytest.mark.asyncio
async def test_loop_debug(app):
    assert asyncio.get_running_loop().get_debug()


@pytest.mark.slow
@pytest.mark.asyncio
async def test_loop_default_executor(app):
    loop = asyncio.get_running_loop()
    start = loop.time()
    await asyncio.gather(*(asyncio.to_thread(time.sleep, 0.5) for _ in range(7)))
    assert loop.time() - start == pytest.approx(1.5, rel=0.1)


@pytest.mark.asyncio
async def test_loop_exc_handler(mocker, app):
    logger = mocker.patch('structlog.stdlib.BoundLogger.error')
    loop = asyncio.get_running_loop()
    loop.call_exception_handler({'message': 'fail'})
    await asyncio.sleep(0.02)
    logger.assert_called_once_with('fail')
    logger.reset_mock()
    future = asyncio.get_running_loop().create_future()
    loop.call_exception_handler({'message': 'fail', 'future': future})
    await asyncio.sleep(0.02)
    logger.assert_called_once_with('fail', done=False)
    logger.reset_mock()
    async def error():
        raise ValueError
    asyncio.create_task(error(), name='raises-error')
    await asyncio.sleep(0.02)
    logger.assert_called_once_with(
        'Task exception was never retrieved',
        exc_info=ANY,
        done=True,
        task_name='raises-error',
    )


@pytest.mark.asyncio
async def test_routing(app):
    client = await app.make_client()
    service = await app.make_service(MathHandler())
    assert await client.call.add(1, 2, address=b'test-service') == 3


@pytest.mark.slow
@pytest.mark.asyncio
async def test_log_forwarder(app):
    # Ensure the router connection/logger configuration messages are ignored.
    await asyncio.sleep(0.1)
    handler = LogHandler()
    subscriber = await app.make_log_subscriber(handler)
    await asyncio.sleep(0.1)
    logger = structlog.get_logger()
    await logger.debug('debug msg')
    await logger.info('info msg', x=1)
    await logger.info('info msg', x=1, transmit=False)
    await logger.warning('warning msg')
    await logger.error('error msg')
    await asyncio.sleep(0.1)
    assert subscriber.node.recv_count == 3
    messages = []
    while not handler.queue.empty():
        messages.append(await handler.queue.get())
    info, warning = sorted(messages, key=lambda msg: msg['level'])
    assert info['event'] == 'info msg'
    assert info.get('x') == 1
    assert warning['event'] == 'warning msg'


@pytest.mark.asyncio
async def test_update(app):
    client = await app.make_update_client()
    node = rpc.DatagramNode.from_address(app.options['update_addr'], bind=True)
    service = await app.make_service(MathHandler(), node)
    assert await client.call.add(1, 2) == 3


@pytest.mark.asyncio
async def test_control(app):
    node = rpc.DatagramNode.from_address(app.options['control_addr'], bind=False)
    client = await app.make_client(node)
    service = await app.make_control_service(MathHandler())
    assert await client.call.add(1, 2) == 3
