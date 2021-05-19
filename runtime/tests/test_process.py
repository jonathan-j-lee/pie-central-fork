import asyncio
import dataclasses
import functools
import multiprocessing
import random
import signal
import threading
import time

import pytest
import structlog
import zmq
import zmq.asyncio

from runtime import log, process, rpc
from runtime.exception import EmergencyStopException

from test_rpc import logger


@pytest.fixture
async def endpoints():
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
    }
    async with process.EndpointManager('test', options) as endpoints:
        proxy = await endpoints.make_log_proxy()
        await endpoints.make_router()
        yield endpoints
    zmq.asyncio.Context.instance().term()
    await asyncio.to_thread(proxy.join, 1)


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


def indefinite_target(handle_terminate):
    signal.signal(signal.SIGTERM, handle_terminate)
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


def test_loop_cleanup():
    count = 0

    async def inc():
        try:
            await asyncio.sleep(60)
        except asyncio.CancelledError:
            nonlocal count
            count += 1

    async def main():
        for _ in range(5):
            asyncio.create_task(inc(), name='inc')
        assert len(asyncio.all_tasks()) == 6
        asyncio.get_running_loop().call_soon(process.cancel_loop)

    asyncio.run(main())
    assert count == 5


@pytest.mark.asyncio
async def test_process_cleanup():
    async def main(counter: multiprocessing.Value, barrier: threading.Barrier):
        process.configure_loop()
        try:
            await asyncio.to_thread(barrier.wait)
            while True:
                await asyncio.sleep(0.01)
        except asyncio.CancelledError:
            with counter.get_lock():
                counter.value += 1

    def target(counter: multiprocessing.Value):
        barrier = threading.Barrier(5)
        for _ in range(4):
            thread = threading.Thread(
                target=lambda counter, barrier: asyncio.run(main(counter, barrier)),
                args=(counter, barrier),
                daemon=True,
            )
            thread.start()
        barrier.wait()
        process.clean_up()

    counter = multiprocessing.Value('i', 0)
    await process.run_process(process.AsyncProcess(target=target, args=(counter,)))
    assert counter.value == 4


@pytest.mark.slow
@pytest.mark.asyncio
async def test_async_environment(endpoints):
    loop = asyncio.get_running_loop()
    assert loop.get_debug()
    start = loop.time()
    await asyncio.gather(*(asyncio.to_thread(time.sleep, 0.5) for _ in range(7)))
    assert loop.time() - start == pytest.approx(1.5, rel=0.1)


@pytest.mark.asyncio
async def test_routing(endpoints):
    client = await endpoints.make_client()
    service = await endpoints.make_service(MathHandler())
    assert await client.call.add(1, 2, address=b'test-service') == 3


@pytest.mark.slow
@pytest.mark.asyncio
async def test_log_proxy(endpoints):
    handler = LogHandler()
    subscriber = await endpoints.make_log_subscriber(handler)
    subscriber.logger = log.get_null_logger()
    await asyncio.sleep(0.3)
    logger = structlog.get_logger()
    await logger.debug('debug msg')
    await logger.info('info msg', x=1)
    await logger.warning('warning msg')
    await logger.error('error msg')
    await asyncio.sleep(0.3)
    assert subscriber.node.recv_count == 3
    messages = []
    while not handler.queue.empty():
        messages.append(await handler.queue.get())
    info, warning = sorted(messages, key=lambda msg: msg['level'])
    assert info['event'] == 'info msg'
    assert info.get('x') == 1
    assert warning['event'] == 'warning msg'


@pytest.mark.asyncio
async def test_update(endpoints):
    client = await endpoints.make_update_client()
    node = rpc.DatagramNode.from_address(endpoints.options['update_addr'], bind=True)
    service = await endpoints.make_service(MathHandler(), node)
    assert await client.call.add(1, 2) == 3


@pytest.mark.asyncio
async def test_control(endpoints):
    node = rpc.DatagramNode.from_address(endpoints.options['control_addr'], bind=False)
    client = await endpoints.make_client(node)
    service = await endpoints.make_control_service(MathHandler())
    assert await client.call.add(1, 2) == 3
