import asyncio
import dataclasses
import functools
import math
import random
from numbers import Real
from typing import Callable, Optional

import cbor2
import pytest
import structlog
import zmq

from runtime import log, rpc


@dataclasses.dataclass
class MockHandler(rpc.Handler):
    connection_open: asyncio.Event = dataclasses.field(default_factory=asyncio.Event)
    barrier: asyncio.Event = dataclasses.field(default_factory=asyncio.Event)
    waiters: int = 0
    total: int = 0

    @rpc.route
    async def wait_for_connection(self):
        self.connection_open.set()

    @rpc.route('echo-id')
    def ping(self, ctr: int) -> int:
        return ctr + 1

    @rpc.route
    async def inc(self):
        self.waiters += 1
        self.total += 1
        try:
            await self.barrier.wait()
        finally:
            self.waiters -= 1

    @rpc.route
    def error(self):
        raise ValueError

    async def poll(self, predicate: Callable[[], bool], done: Optional[Callable[[], None]] = None,
                   timeout: Real = 1, interval: Real = 0.01):
        async def spin():
            while not predicate():
                await asyncio.sleep(interval)
            if done:
                done()
        await asyncio.wait_for(spin(), timeout)


FRONTEND, BACKEND = 'ipc:///tmp/router-frontend.ipc', 'ipc:///tmp/router-backend.ipc'
MULTICAST = 'ipc:///tmp/pub-sub.ipc'
UDP_ADDR = 'udp://127.0.0.1:6060'


@pytest.fixture(autouse=True)
def logger():
    log.configure()


@pytest.fixture
async def router():
    async with rpc.Router.bind(FRONTEND, BACKEND) as router:
        yield router


@pytest.fixture(params=[
    ('zmq', (1, 3), zmq.DEALER, zmq.DEALER),
    ('zmq', (3, 1), zmq.DEALER, zmq.DEALER),
    ('zmq', (0, 1), zmq.PUB, zmq.SUB),
    ('zmq', (0, 5), zmq.PUB, zmq.SUB),
    ('udp', (1, 3)),
    ('udp', (3, 1)),
])
async def endpoints(request, router):
    node_type, (client_concurrency, service_concurrency), *other = request.param
    if node_type == 'zmq':
        client_type, service_type = other
        common_options = {zmq.SNDTIMEO: 3000}
        client_node = rpc.SocketNode(
            client_type,
            options=common_options | {zmq.IDENTITY: b'client'},
            connections=(MULTICAST if client_type == zmq.PUB else FRONTEND),
        )
        kwargs = {'bindings': MULTICAST} if service_type == zmq.SUB else {'connections': BACKEND}
        service_node = rpc.SocketNode(
            service_type,
            options=common_options | {zmq.IDENTITY: b'service'},
            **kwargs,
        )
        client_node.address = client_node.options[zmq.IDENTITY]
        service_node.address = service_node.options[zmq.IDENTITY]
    else:
        client_node = rpc.DatagramNode.from_address(UDP_ADDR, bind=False)
        service_node = rpc.DatagramNode.from_address(UDP_ADDR, bind=True)
        await client_node.open()
        client_node.address = client_node.transport.get_extra_info('sockname')
        service_node.address = None

    client = rpc.Client(node=client_node, concurrency=client_concurrency)
    service = rpc.Service(
        MockHandler(),
        node=service_node,
        concurrency=service_concurrency,
    )
    async def wait_for_connection():
        while True:
            await asyncio.gather(client.call.wait_for_connection(), asyncio.sleep(0.01))
    async with client, service:
        if not client.node.can_recv:
            wait_task = asyncio.create_task(wait_for_connection())
            await asyncio.wait_for(service.handler.connection_open.wait(), 1)
            wait_task.cancel()
        yield client, service


@pytest.mark.asyncio
async def test_socket_checks():
    socket_factories = [
        lambda: rpc.Client(rpc.SocketNode(zmq.REQ)),
        lambda: rpc.Client(rpc.SocketNode(zmq.SUB)),
        lambda: rpc.Service(MockHandler(), rpc.SocketNode(zmq.REP)),
        lambda: rpc.Service(MockHandler(), rpc.SocketNode(zmq.PUB)),
        lambda: rpc.Router(rpc.SocketNode(zmq.ROUTER), rpc.SocketNode(zmq.DEALER)),
    ]
    for socket_factory in socket_factories:
        with pytest.raises(rpc.RuntimeRPCError):
            socket_factory()
    with pytest.raises(ValueError):
        rpc.Client(rpc.SocketNode(zmq.DEALER), concurrency=-1)
    with pytest.raises(ValueError):
        rpc.DatagramNode.from_address('tcp://localhost:8080')
    with pytest.raises(ValueError):
        await rpc.SocketNode(zmq.PUB).recv()


@pytest.mark.asyncio
async def test_request_response(endpoints):
    client, service = endpoints
    if not client.node.can_recv:
        pytest.skip()
    requests = max(client.concurrency, service.concurrency) + 1
    fn = functools.partial(client.call['echo-id'], address=service.node.address)
    results = await asyncio.gather(*(fn(i) for i in range(requests)))
    assert set(results) == {i + 1 for i in range(requests)}


@pytest.mark.asyncio
async def test_notification(endpoints):
    client, service = endpoints
    requests = max(client.concurrency, service.concurrency) + 1
    fn = functools.partial(client.call.inc, address=service.node.address, notification=True)
    await asyncio.gather(*(fn() for _ in range(requests)))
    current, batches = requests, 0
    while current > 0:
        to_process = min(current, service.concurrency)
        await service.handler.poll(
            lambda: service.handler.waiters == to_process,
            service.handler.barrier.set,
        )
        await service.handler.poll(
            lambda: service.handler.waiters == 0,
            service.handler.barrier.clear,
        )
        current -= to_process
        batches += 1
    assert service.handler.total == requests
    assert batches == int(math.ceil(requests/service.concurrency))


@pytest.mark.asyncio
async def test_node_reentrant(endpoints):
    client, service = endpoints
    async with client.node:
        async with service.node:
            async with client.node:
                async with service.node:
                    await client.call.inc(address=service.node.address, notification=True)
                    await service.handler.poll(lambda: service.handler.waiters == 1)
                    assert service.handler.total == 1


@pytest.mark.asyncio
async def test_bad_requests(mocker, endpoints):
    client, service = endpoints
    if not client.node.can_recv:
        pytest.skip()
    with pytest.raises(rpc.RuntimeRPCError):
        await client.call.no_method(address=service.node.address)
    with pytest.raises(rpc.RuntimeRPCError):
        await client.call['echo-id'](address=service.node.address)          # Not enough arguments
    with pytest.raises(rpc.RuntimeRPCError):
        await client.call['echo-id'](1, 2, address=service.node.address)    # Too many arguments
    with pytest.raises(rpc.RuntimeRPCError):
        await client.call.error(address=service.node.address)               # Error in call
    with pytest.raises(cbor2.CBOREncodeError):
        await client.call['echo-id'](object(), address=service.node.address)    # Not serializable
    with pytest.raises(rpc.RuntimeRPCError):
        await client.call['echo-id']([], address=service.node.address)      # Cannot add to number
    if isinstance(client.node, rpc.SocketNode):
        with pytest.raises(rpc.RuntimeRPCError):
            await client.call['echo-id']()                                  # No address
    mocker.patch('random.randrange')
    random.randrange.return_value = 0
    client.requests[0] = asyncio.Future()
    with pytest.raises(rpc.RuntimeRPCError):
        await client.call['echo-id'](1, address=service.node.address)


@pytest.mark.slow
@pytest.mark.asyncio
async def test_bad_payloads(endpoints):
    client, service = endpoints
    if not client.node.can_recv:
        pytest.skip()
    service_payloads = [
        [b''],
        [b'']*2,
        [await rpc.encode([])],
        [(await rpc.encode([]))[:-1]],
        [await rpc.encode('abcd')],
        [await rpc.encode([5, 0, None, None])],
        [await rpc.encode([rpc.MessageType.RESPONSE.value, 0, None, None])],
    ]
    client_payloads = [
        *service_payloads,
        [await rpc.encode([rpc.MessageType.REQUEST.value, 0, 'generate_message_id', ()])],
    ]
    for _ in range(3):
        for payload in service_payloads:
            await client.node.send(payload, address=service.node.address)
    await asyncio.sleep(0.3)
    await client.call['echo-id'](1, address=service.node.address) == 2
    for _ in range(3):
        for payload in client_payloads:
            await service.node.send(payload, address=client.node.address)
    await asyncio.sleep(0.3)
    await client.call['echo-id'](1, address=service.node.address) == 2


@pytest.mark.slow
@pytest.mark.asyncio
async def test_client_timeout(endpoints):
    client, service = endpoints
    if not client.node.can_recv:
        pytest.skip()
    with pytest.raises(asyncio.TimeoutError):
        await client.call.inc(address=service.node.address, timeout=0.3)
    service.handler.barrier.set()
    await service.handler.poll(lambda: service.handler.waiters == 0, service.handler.barrier.clear)
    assert service.handler.total == 1
    assert await client.call['echo-id'](1, address=service.node.address) == 2


@pytest.mark.slow
@pytest.mark.asyncio
async def test_service_timeout(endpoints):
    client, service = endpoints
    service.timeout = 0.3
    call = client.call.inc(address=service.node.address)
    if client.node.can_recv:
        with pytest.raises(rpc.RuntimeRPCError):
            await call
    else:
        await call
    await service.handler.poll(lambda: service.handler.waiters == 0 and service.handler.total == 1)
    service.handler.barrier.set()
    await client.call.inc(address=service.node.address)
    await service.handler.poll(lambda: service.handler.waiters == 0 and service.handler.total == 2)


@pytest.mark.asyncio
async def test_subscriptions(endpoints):
    client, service = endpoints
    if not isinstance(service.node, rpc.SocketNode):
        pytest.skip()
    if service.node.socket_type != zmq.SUB:
        while service.node.subscriptions:
            service.node.subscriptions.pop()
        assert len(service.node.subscriptions) == 0
        service.node.subscribe('hello')
        assert len(service.node.subscriptions) == 0
        service.node.subscriptions.add('hello')
        service.node.unsubscribe('hello')
        assert len(service.node.subscriptions) == 1
    else:
        await client.call.inc()
        await service.handler.poll(lambda: service.handler.total == 1, service.handler.barrier.set)
        service.node.unsubscribe('')
        service.node.subscribe('inc')
        await asyncio.sleep(0.1)  # Wait for subscription changes to propogate
        await client.call.inc()
        await client.call.inc(address=b'a')
        await service.handler.poll(lambda: service.handler.total == 2, service.handler.barrier.set)
        service.node.subscribe('b')
        await asyncio.sleep(0.1)
        await client.call.inc()
        await client.call.inc(address=b'a')
        await client.call.inc(address=b'b')
        await client.call.inc(address=b'c')
        await service.handler.poll(lambda: service.handler.total == 4, service.handler.barrier.set)


@pytest.mark.slow
@pytest.mark.asyncio
async def test_concurrency(endpoints):
    client, service = endpoints
    if not client.node.can_recv:
        pytest.skip()
    fn = functools.partial(client.call.inc, address=service.node.address)
    initial_requests = asyncio.gather(*(fn() for _ in range(service.concurrency)))
    await service.handler.poll(lambda: service.handler.waiters == service.concurrency)
    with pytest.raises(asyncio.TimeoutError):
        await client.call['echo-id'](1, address=service.node.address, timeout=0.3)
    service.handler.barrier.set()
    await initial_requests
    assert service.handler.waiters == 0
    assert service.handler.total == service.concurrency


@pytest.mark.slow
@pytest.mark.asyncio
async def test_client_death(endpoints):
    client, service = endpoints
    if not client.node.can_recv:
        pytest.skip()
    request = asyncio.create_task(client.call.inc(address=service.node.address))
    await service.handler.poll(lambda: service.handler.waiters == 1)
    request.cancel()
    await client.__aexit__(None, None, None)
    service.handler.barrier.set()
    await service.handler.poll(lambda: service.handler.waiters == 0)
    await client.__aenter__()
    await asyncio.sleep(0.3)
    await client.call['echo-id'](1, address=service.node.address) == 2


@pytest.mark.slow
@pytest.mark.asyncio
async def test_router_death(router, endpoints):
    client, service = endpoints
    if not client.node.can_recv or not isinstance(service.node, rpc.SocketNode):
        pytest.skip()
    await client.call['echo-id'](1, address=service.node.address) == 2
    await router.__aexit__(None, None, None)
    with pytest.raises(asyncio.TimeoutError):
        await client.call['echo-id'](1, address=service.node.address, timeout=0.3)
    await router.__aenter__()
    await asyncio.sleep(0.3)
    await client.call['echo-id'](1, address=service.node.address) == 2


@pytest.mark.slow
@pytest.mark.asyncio
async def test_service_death(endpoints):
    client, service = endpoints
    if not client.node.can_recv:
        pytest.skip()
    await client.call['echo-id'](1, address=service.node.address) == 2
    await service.__aexit__(None, None, None)
    with pytest.raises(asyncio.TimeoutError):
        await client.call['echo-id'](1, address=service.node.address, timeout=0.3)
    await service.__aenter__()
    await asyncio.sleep(0.3)
    await client.call['echo-id'](1, address=service.node.address) == 2


@pytest.mark.slow
@pytest.mark.asyncio
async def test_loopback(endpoints):
    client, service = endpoints
    if not client.node.can_recv or not isinstance(service.node, rpc.SocketNode):
        pytest.skip()
    service.node.socket.connect(FRONTEND)
    await asyncio.sleep(0.3)
    message = [rpc.MessageType.REQUEST.value, 0, 'inc', ()]
    await service.node.send([await rpc.encode(message)], address=service.node.address)
    await asyncio.sleep(0.3)
    assert service.handler.total == 0


@pytest.mark.asyncio
async def test_multiple_clients(endpoints):
    client1, service = endpoints
    if not client1.node.can_recv:
        pytest.skip()
    if isinstance(client1.node, rpc.SocketNode):
        client2_options = client1.node.options | {zmq.IDENTITY: b'client-2'}
        client3_options = client1.node.options | {zmq.IDENTITY: b'client-3'}
        client2_node = rpc.SocketNode(
            client1.node.socket_type,
            options=client2_options,
            connections=FRONTEND,
        )
        client3_node = rpc.SocketNode(
            client1.node.socket_type,
            options=client3_options,
            connections=FRONTEND,
        )
    else:
        client2_node = rpc.DatagramNode.from_address(UDP_ADDR, bind=False)
        client3_node = rpc.DatagramNode.from_address(UDP_ADDR, bind=False)
    client2 = rpc.Client(client2_node)
    client3 = rpc.Client(client3_node)
    async with client2, client3:
        fn = lambda client, k: client.call['echo-id'](k, address=service.node.address)
        tasks, expected_results = set(), set()
        for i, client in enumerate([client1, client2, client3]):
            for j in range(4):
                k = 4*i + j
                tasks.add(asyncio.create_task(fn(client, k)))
                expected_results.add(k + 1)
        assert set(await asyncio.gather(*tasks)) == expected_results


@pytest.mark.asyncio
async def test_multiple_services(endpoints):
    client, service1 = endpoints
    if not client.node.can_recv or not isinstance(client.node, rpc.SocketNode):
        pytest.skip()
    service2_options = service1.node.options | {zmq.IDENTITY: b'service-2'}
    service3_options = service1.node.options | {zmq.IDENTITY: b'service-3'}
    service2 = rpc.Service(
        service1.handler,
        rpc.SocketNode(service1.node.socket_type, options=service2_options, connections=BACKEND),
        concurrency=service1.concurrency,
    )
    service3 = rpc.Service(
        service1.handler,
        rpc.SocketNode(service1.node.socket_type, options=service3_options, connections=BACKEND),
        concurrency=service1.concurrency,
    )
    service2.node.address, service3.node.address = b'service-2', b'service-3'
    async with service2, service3:
        fn = lambda service, k: client.call['echo-id'](k, address=service.node.address)
        tasks, expected_results = set(), set()
        for i, service in enumerate([service1, service2, service3]):
            for j in range(4):
                k = 4*i + j
                tasks.add(asyncio.create_task(fn(service, k)))
                expected_results.add(k + 1)
        assert set(await asyncio.gather(*tasks)) == expected_results


@pytest.mark.asyncio
async def test_closed(endpoints):
    _, service = endpoints
    for endpoint in endpoints:
        await endpoint.__aexit__(None, None, None)
        assert endpoint.node.closed
        with pytest.raises(rpc.RuntimeRPCError):
            await endpoint.node.send([b''], address=service.node.address)


@pytest.mark.slow
@pytest.mark.asyncio
async def test_recv_timeout(mocker, endpoints):
    client, service = endpoints
    if not isinstance(service.node, rpc.SocketNode):
        pytest.skip()
    service.node.set_option(zmq.RCVTIMEO, 100)
    service.node.close()
    await service.node.open()
    spy = mocker.spy(service.node, 'open')
    await asyncio.sleep(0.35)
    assert spy.call_count == 3
