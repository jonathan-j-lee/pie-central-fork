import asyncio
import random
from pathlib import Path

import pytest

import runtime
from runtime.buffer import DeviceUID, Buffer, BufferManager
from runtime.messaging import Message
from runtime.tools.devemulator import start_virtual_device
from runtime.service.device import SmartDeviceManager


@pytest.fixture
def vsd_addr():
    get_random_port = lambda: random.randrange(3000, 10000)
    yield f'tcp://localhost:{get_random_port()}'


@pytest.fixture
def catalog_path() -> Path:
    return Path(runtime.__file__).parent / 'catalog.yaml'


@pytest.fixture
def catalog() -> dict[str, type[Buffer]]:
    catalog = {
        'motor-controller': {
            'device_id': 0xc,
            'params': [
                {'name': 'duty_cycle', 'type': 'float', 'writeable': True},
                {'name': 'pid_pos_setpoint', 'type': 'float', 'writeable': True},
                {'name': 'enabled', 'type': 'bool', 'writeable': True},
                {'name': 'switches', 'type': 'bool[3]', 'writeable': True},
                {'name': 'in_deadzone', 'type': 'bool'},
            ],
        },
    }
    yield BufferManager.make_catalog(catalog)


@pytest.fixture
async def device_manager(catalog, vsd_addr, catalog_path):
    with BufferManager(catalog, shared=False) as buffers:
        manager = SmartDeviceManager(buffers)
        open_task = asyncio.create_task(manager.open_virtual_devices(vsd_addr))
        yield manager
        for task in asyncio.all_tasks():
            if task is not asyncio.current_task():
                task.cancel()
        await asyncio.sleep(0.05)


@pytest.fixture
async def upstream(device_manager, downstream):
    await asyncio.sleep(0.03)
    yield device_manager.devices[0xc_00_00000000_00000000].buffer


@pytest.fixture
async def downstream(catalog, vsd_addr, catalog_path):
    with BufferManager(catalog, shared=False) as buffers:
        options = {'dev_vsd_addr': vsd_addr, 'dev_poll_interval': 0.04}
        async with start_virtual_device(buffers, 0xc_00_00000000_00000000, options) as tasks:
            yield buffers[0xc_00_00000000_00000000]


@pytest.mark.asyncio
async def test_list_uids(device_manager, upstream, downstream):
    assert set(await device_manager.list_uids()) == {str(0xc_00_00000000_00000000)}


@pytest.mark.asyncio
async def test_ping(device_manager, upstream, downstream):
    downstream.control.uid = DeviceUID.from_int(0xc_01_00000000_00000000)
    await device_manager.ping()
    await asyncio.sleep(0.03)
    assert int(upstream.uid) == 0xc_01_00000000_00000000


@pytest.mark.asyncio
async def test_subscription(device_manager, upstream, downstream):
    await device_manager.subscribe(str(0xc_00_00000000_00000000), interval=0.04)
    await asyncio.sleep(0.03)
    upstream.write('duty_cycle', 0.123)
    await asyncio.sleep(0.1)
    assert upstream.get('duty_cycle') == downstream.get('duty_cycle') == pytest.approx(0.123)
    downstream.set('duty_cycle', 0.456)
    await asyncio.sleep(0.1)
    assert upstream.get('duty_cycle') == downstream.get('duty_cycle') == pytest.approx(0.456)


@pytest.mark.asyncio
async def test_read(device_manager, upstream, downstream):
    await device_manager.unsubscribe([str(0xc_00_00000000_00000000)])
    await asyncio.sleep(0.03)
    downstream.update_block.duty_cycle = 0.123
    await asyncio.sleep(0.1)
    assert upstream.get('duty_cycle') != pytest.approx(0.123)
    await device_manager.read(str(0xc_00_00000000_00000000), ['duty_cycle'])
    await asyncio.sleep(0.1)
    assert upstream.get('duty_cycle') == pytest.approx(0.123)
    downstream.update_block.duty_cycle = 0.456
    await device_manager.read(str(0xc_00_00000000_00000000))
    await asyncio.sleep(0.1)
    assert upstream.get('duty_cycle') == pytest.approx(0.456)


@pytest.mark.asyncio
async def test_write(device_manager, upstream, downstream):
    await device_manager.unsubscribe(str(0xc_00_00000000_00000000))
    await asyncio.sleep(0.03)
    upstream.write('duty_cycle', 0.123)
    upstream.write('pid_pos_setpoint', 0.1)
    await asyncio.sleep(0.1)
    assert upstream.get('duty_cycle') == downstream.get('duty_cycle') == pytest.approx(0.123)
    assert downstream.write_block.pid_pos_setpoint == pytest.approx(0.1)


@pytest.mark.asyncio
async def test_disable(device_manager, upstream, downstream):
    upstream.write('duty_cycle', 0.123)
    upstream.write('enabled', True)
    await asyncio.sleep(0.1)
    assert downstream.get('duty_cycle') == pytest.approx(0.123)
    assert downstream.get('enabled')
    await device_manager.disable()
    await asyncio.sleep(0.1)
    assert downstream.get('duty_cycle') == pytest.approx(0)
    assert not downstream.get('enabled')


@pytest.mark.asyncio
async def test_heartbeat(device_manager, upstream, downstream):
    assert await device_manager.heartbeat(str(0xc_00_00000000_00000000)) < 0.05
