import asyncio
import dataclasses
import decimal
import functools
import math
from numbers import Real
import random
from typing import Callable, Optional
import pytest
import zmq
from runtime import rpc


@dataclasses.dataclass
class MockService(rpc.Service):
    connection_open: asyncio.Event = dataclasses.field(default_factory=asyncio.Event)
    barrier: asyncio.Event = dataclasses.field(default_factory=asyncio.Event)
    waiters: int = 0
    total: int = 0

    @property
    def identity(self) -> bytes:
        return self.options.get(zmq.IDENTITY, b'')

    @rpc.Service.route()
    async def wait_for_connection(self):
        self.connection_open.set()

    @rpc.Service.route('echo-id')
    def ping(self, ctr: int) -> str:
        return f'{self.options[zmq.IDENTITY].decode()} {ctr + 1}'

    @rpc.Service.route()
    async def inc(self):
        self.waiters += 1
        self.total += 1
        try:
            await self.barrier.wait()
        finally:
            self.waiters -= 1

    @rpc.Service.route()
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


@pytest.fixture
async def router():
    async with rpc.Router.bind(FRONTEND, BACKEND) as router:
        yield router


@pytest.fixture(params=[
    ((zmq.DEALER, 1), (zmq.DEALER, 2)),
    ((zmq.DEALER, 2), (zmq.DEALER, 1)),
    ((zmq.DEALER, 4), (zmq.DEALER, 4)),
    ((zmq.DEALER, 3), (zmq.DEALER, 5)),
    ((zmq.DEALER, 5), (zmq.DEALER, 3)),
    ((zmq.PUB, 3), (zmq.SUB, 5)),
    ((zmq.PUB, 5), (zmq.SUB, 3)),
])
async def endpoints(request, router):
    (client_type, client_concurrency), (service_type, service_concurrency) = request.param
    common_options = {zmq.SNDTIMEO: 3000}
    client = rpc.Client(
        client_type,
        concurrency=client_concurrency,
        options={**common_options, zmq.IDENTITY: b'client'},
        connections=(MULTICAST if client_type == zmq.PUB else FRONTEND),
    )
    options = {'bindings': MULTICAST} if service_type == zmq.SUB else {'connections': BACKEND}
    service = MockService(
        service_type,
        concurrency=service_concurrency,
        options={**common_options, zmq.IDENTITY: b'service'},
        **options,
    )
    async def wait_for_connection():
        while True:
            await asyncio.gather(client.call.wait_for_connection(), asyncio.sleep(0.01))
    async with client, service:
        if service_type == zmq.SUB:
            wait_task = asyncio.create_task(wait_for_connection())
            await asyncio.wait_for(service.connection_open.wait(), 1)
            wait_task.cancel()
        yield client, service


@pytest.mark.asyncio
async def test_socket_checks():
    socket_factories = [
        lambda: rpc.Client(zmq.REQ),
        lambda: rpc.Client(zmq.SUB),
        lambda: MockService(zmq.REP),
        lambda: MockService(zmq.PUB),
        lambda: rpc.Router(rpc.BaseSocket(zmq.ROUTER), rpc.BaseSocket(zmq.DEALER)),
    ]
    for socket_factory in socket_factories:
        with pytest.raises(rpc.RuntimeRPCError):
            socket_factory()
    with pytest.raises(ValueError):
        rpc.Client(zmq.DEALER, concurrency=-1)


@pytest.mark.asyncio
async def test_request_response(endpoints):
    client, service = endpoints
    if client.socket_type == zmq.PUB:
        pytest.skip()
    requests = max(client.concurrency, service.concurrency) + 1
    fn = functools.partial(client.call['echo-id'], service_or_topic=service.identity)
    results = await asyncio.gather(*(fn(i) for i in range(requests)))
    assert set(results) == {f'{service.identity.decode()} {i + 1}' for i in range(requests)}


@pytest.mark.asyncio
async def test_notification(endpoints):
    client, service = endpoints
    requests = max(client.concurrency, service.concurrency) + 1
    fn = functools.partial(client.call.inc, service_or_topic=service.identity, notification=True)
    await asyncio.gather(*(fn() for _ in range(requests)))
    current, batches = requests, 0
    while current > 0:
        to_process = min(current, service.concurrency)
        await service.poll(lambda: service.waiters == to_process, service.barrier.set)
        await service.poll(lambda: service.waiters == 0, service.barrier.clear)
        current -= to_process
        batches += 1
    assert service.total == requests
    assert batches == int(math.ceil(requests/service.concurrency))


@pytest.mark.asyncio
async def test_bad_requests(mocker, endpoints):
    client, service = endpoints
    if client.socket_type == zmq.PUB:
        pytest.skip()
    with pytest.raises(rpc.RuntimeRPCError):
        await client.call.no_method(service_or_topic=service.identity)
    with pytest.raises(rpc.RuntimeRPCError):
        # Not enough arguments
        await client.call['echo-id'](service_or_topic=service.identity)
    with pytest.raises(rpc.RuntimeRPCError):
        # Too many arguments
        await client.call['echo-id'](1, 2, service_or_topic=service.identity)
    with pytest.raises(ValueError):
        # No service ID
        await client.call['echo-id']()
    with pytest.raises(rpc.RuntimeRPCError):
        # Error in call
        await client.call.error(service_or_topic=service.identity)
    with pytest.raises(rpc.RuntimeRPCError):
        await client.call['echo-id'](decimal.Decimal(), service_or_topic=service.identity)
    mocker.patch('random.randrange')
    random.randrange.return_value = 0
    client.requests[0] = asyncio.Future()
    with pytest.raises(rpc.RuntimeRPCError):
        await client.call['echo-id'](1, service_or_topic=service.identity)


@pytest.mark.slow
@pytest.mark.asyncio
async def test_bad_payloads(endpoints):
    client, service = endpoints
    if client.socket_type == zmq.PUB:
        pytest.skip()
    service_payloads = [
        b'',
        await client.serialize([]),
        (await client.serialize([]))[:-1],
        await client.serialize('abcd'),
        await client.serialize([5, 0, None, None]),
        await client.serialize([rpc.MessageType.RESPONSE.value, 0, None, None]),
    ]
    client_payloads = [
        *service_payloads,
        await client.serialize([rpc.MessageType.REQUEST.value, 0, 'generate_message_id', ()]),
    ]
    for _ in range(3):
        for payload in service_payloads:
            await client.send(service.identity, payload)
    await asyncio.sleep(0.3)
    await client.call['echo-id'](1, service_or_topic=service.identity)
    for _ in range(3):
        for payload in client_payloads:
            await service.send(client.options[zmq.IDENTITY], payload)
    await asyncio.sleep(0.3)
    await client.call['echo-id'](1, service_or_topic=service.identity)


@pytest.mark.slow
@pytest.mark.asyncio
async def test_client_timeout(endpoints):
    client, service = endpoints
    if client.socket_type == zmq.PUB:
        pytest.skip()
    with pytest.raises(asyncio.TimeoutError):
        await client.call.inc(service_or_topic=service.identity, timeout=0.3)
    service.barrier.set()
    await service.poll(lambda: service.waiters == 0, service.barrier.clear)
    assert service.total == 1
    assert await client.call['echo-id'](1, service_or_topic=service.identity) == 'service 2'


@pytest.mark.slow
@pytest.mark.asyncio
async def test_service_timeout(endpoints):
    client, service = endpoints
    service.timeout = 0.3
    call = client.call.inc(service_or_topic=service.identity)
    if client.socket_type != zmq.PUB:
        with pytest.raises(rpc.RuntimeRPCError):
            await call
    else:
        await call
    await service.poll(lambda: service.waiters == 0 and service.total == 1)
    service.barrier.set()
    await client.call.inc(service_or_topic=service.identity)
    await service.poll(lambda: service.waiters == 0 and service.total == 2)


@pytest.mark.asyncio
async def test_subscriptions(endpoints):
    client, service = endpoints
    if service.socket_type != zmq.SUB:
        while service.subscriptions:
            service.subscriptions.pop()
        assert len(service.subscriptions) == 0
        service.subscribe('hello')
        assert len(service.subscriptions) == 0
        service.subscriptions.add('hello')
        service.unsubscribe('hello')
        assert len(service.subscriptions) == 1
    else:
        await client.call.inc()
        await service.poll(lambda: service.total == 1, service.barrier.set)
        service.unsubscribe('')
        service.subscribe('inc')
        await asyncio.sleep(0.1)  # Wait for subscription changes to propogate
        await client.call.inc()
        await client.call.inc(service_or_topic=b'a')
        await service.poll(lambda: service.total == 2, service.barrier.set)
        service.subscribe('b')
        await asyncio.sleep(0.1)
        await client.call.inc()
        await client.call.inc(service_or_topic=b'a')
        await client.call.inc(service_or_topic=b'b')
        await client.call.inc(service_or_topic=b'c')
        await service.poll(lambda: service.total == 4, service.barrier.set)


@pytest.mark.slow
@pytest.mark.asyncio
async def test_concurrency(endpoints):
    client, service = endpoints
    if client.socket_type == zmq.PUB:
        pytest.skip()
    fn = functools.partial(client.call.inc, service_or_topic=service.identity)
    first_requests = asyncio.gather(*(fn() for _ in range(service.concurrency)))
    await service.poll(lambda: service.waiters == service.concurrency)
    with pytest.raises(asyncio.TimeoutError):
        await client.call['echo-id'](1, service_or_topic=service.identity, timeout=0.3)
    service.barrier.set()
    await first_requests
    assert service.waiters == 0
    assert service.total == service.concurrency


@pytest.mark.slow
@pytest.mark.asyncio
async def test_client_death(endpoints):
    client, service = endpoints
    if client.socket_type == zmq.PUB:
        pytest.skip()
    request = asyncio.create_task(client.call.inc(service_or_topic=service.identity))
    await service.poll(lambda: service.waiters == 1)
    request.cancel()
    await client.__aexit__(None, None, None)
    service.barrier.set()
    await service.poll(lambda: service.waiters == 0)
    await client.__aenter__()
    await asyncio.sleep(0.3)
    await client.call['echo-id'](1, service_or_topic=service.identity) == 'service 2'


@pytest.mark.slow
@pytest.mark.asyncio
async def test_router_death(router, endpoints):
    client, service = endpoints
    if client.socket_type == zmq.PUB:
        pytest.skip()
    await client.call['echo-id'](1, service_or_topic=service.identity) == 'service 2'
    await router.__aexit__(None, None, None)
    with pytest.raises(asyncio.TimeoutError):
        await client.call['echo-id'](1, service_or_topic=service.identity, timeout=0.3)
    await router.__aenter__()
    await asyncio.sleep(0.3)
    await client.call['echo-id'](1, service_or_topic=service.identity) == 'service 2'


@pytest.mark.slow
@pytest.mark.asyncio
async def test_service_death(endpoints):
    client, service = endpoints
    if client.socket_type == zmq.PUB:
        pytest.skip()
    await client.call['echo-id'](1, service_or_topic=service.identity) == 'service 2'
    await service.__aexit__(None, None, None)
    with pytest.raises(asyncio.TimeoutError):
        await client.call['echo-id'](1, service_or_topic=service.identity, timeout=0.3)
    await service.__aenter__()
    await asyncio.sleep(0.3)
    await client.call['echo-id'](1, service_or_topic=service.identity) == 'service 2'


@pytest.mark.slow
@pytest.mark.asyncio
async def test_loopback(endpoints):
    client, service = endpoints
    if service.socket_type != zmq.DEALER:
        pytest.skip()
    service.socket.connect(FRONTEND)
    await asyncio.sleep(0.3)
    message = [rpc.MessageType.REQUEST.value, 0, 'inc', ()]
    await service.send(service.identity, await service.serialize(message))
    await asyncio.sleep(0.3)
    assert service.total == 0


@pytest.mark.asyncio
async def test_multiple_clients(endpoints):
    client1, service = endpoints
    if client1.socket_type == zmq.PUB:
        pytest.skip()
    client2_options = client1.options | {zmq.IDENTITY: b'client-2'}
    client3_options = client1.options | {zmq.IDENTITY: b'client-3'}
    client2 = rpc.Client(zmq.DEALER, options=client2_options, connections=FRONTEND)
    client3 = rpc.Client(zmq.DEALER, options=client3_options, connections=FRONTEND)
    async with client2, client3:
        fn = lambda client, k: client.call['echo-id'](k, service_or_topic=service.identity)
        tasks, expected_results = set(), set()
        for i, client in enumerate([client1, client2, client3]):
            for j in range(4):
                k = 4*i + j
                tasks.add(asyncio.create_task(fn(client, k)))
                expected_results.add(f'{service.identity.decode()} {k + 1}')
        assert set(await asyncio.gather(*tasks)) == expected_results


@pytest.mark.asyncio
async def test_multiple_services(endpoints):
    client, service1 = endpoints
    if client.socket_type == zmq.PUB:
        pytest.skip()
    service1.set_option(zmq.IDENTITY, b'service-1')
    service1.close()
    service1.reset()
    service2_options = service1.options | {zmq.IDENTITY: b'service-2'}
    service3_options = service1.options | {zmq.IDENTITY: b'service-3'}
    service2 = MockService(zmq.DEALER, concurrency=service1.concurrency, options=service2_options,
                           connections=BACKEND)
    service3 = MockService(zmq.DEALER, concurrency=service1.concurrency, options=service3_options,
                           connections=BACKEND)
    async with service2, service3:
        fn = lambda service, k: client.call['echo-id'](k, service_or_topic=service.identity)
        tasks, expected_results = set(), set()
        for i, service in enumerate([service1, service2, service3]):
            for j in range(4):
                k = 4*i + j
                tasks.add(asyncio.create_task(fn(service, k)))
                expected_results.add(f'{service.identity.decode()} {k + 1}')
        assert set(await asyncio.gather(*tasks)) == expected_results


@pytest.mark.asyncio
async def test_closed_socket(endpoints):
    for endpoint in endpoints:
        await endpoint.__aexit__(None, None, None)
        assert endpoint.closed
        assert len(endpoint.workers) == 0
        with pytest.raises(rpc.RuntimeRPCError):
            await endpoint.send(b'', b'')
        with pytest.raises(rpc.RuntimeRPCError):
            await endpoint.recv()


@pytest.mark.slow
@pytest.mark.asyncio
async def test_recv_timeout(mocker, endpoints):
    client, service = endpoints
    service.set_option(zmq.RCVTIMEO, 100)
    service.close()
    service.reset()
    spy = mocker.spy(service, 'reset')
    await asyncio.sleep(0.35)
    assert spy.call_count == 3
