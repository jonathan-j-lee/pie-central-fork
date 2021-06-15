import asyncio
import os
import socket
import tempfile
import types
from pathlib import Path
from typing import Optional
from unittest.mock import call

import pytest
import serial

import runtime
from runtime import log
from runtime.buffer import Buffer, BufferManager
from runtime.messaging import MessageType, MessageError, Message
from runtime.service.device import (
    HAS_UDEV,
    DeviceError,
    PollingObserver,
    SmartDeviceClient,
    SmartDeviceManager,
)

if HAS_UDEV:
    from runtime.service.device import EventObserver


@pytest.fixture(autouse=True)
async def logging():
    # Each test opens and closes a new async event loop. Since loggers cache the first loop that
    # they use (with ``asyncio.get_running_loop``), we may need to reconstruct these loggers to
    # prevent them from interacting with a closed event loop.
    log.configure(fmt='pretty', level='debug')


@pytest.fixture
async def event_observer(mocker):
    rsock, wsock = socket.socketpair()
    context = mocker.patch('pyudev.Context').return_value
    monitor = mocker.patch('pyudev.Monitor').return_value
    monitor.started = False
    observer = EventObserver(context=context)
    observer.monitor = monitor
    index, new_devices = 0, []
    def poll(_timeout):
        nonlocal index
        if index >= len(new_devices):
            index = 0
            new_devices.clear()
            rsock.recv(4096)
            return None
        else:
            device = new_devices[index]
            index += 1
            return device
    monitor.fileno.return_value = rsock.fileno()
    monitor.start.side_effect = lambda: setattr(monitor, 'started', True)
    monitor.poll.side_effect = poll
    def add_devices(devices):
        new_devices.extend(devices)
        asyncio.get_running_loop().call_soon(wsock.send, b'\x00')
    observer.add_devices = add_devices
    yield observer


@pytest.fixture
def polling_observer():
    with tempfile.TemporaryDirectory() as tmp_dir:
        yield PollingObserver(patterns={os.path.join(tmp_dir, 'ttyACM*')}, interval=0)


@pytest.fixture
async def stream(mocker):
    reader = mocker.patch('asyncio.StreamWriter').return_value
    writer = mocker.patch('asyncio.StreamWriter').return_value
    yield reader, writer


@pytest.fixture
def catalog() -> dict[str, type[Buffer]]:
    catalog = {
        'limit-switch': {
            'device_id': 0,
            'params': [
                {'name': 'switch0', 'type': 'bool', 'writeable': True},
                {'name': 'switch1', 'type': 'bool', 'writeable': True},
                {'name': 'switch2', 'type': 'bool', 'writeable': True},
            ],
        },
    }
    yield BufferManager.make_catalog(catalog)


@pytest.fixture
async def device_manager(mocker, catalog, stream):
    with BufferManager(catalog) as buffers:
        manager = SmartDeviceManager(buffers)
        uids = {0x0000_01_00000000_00000000 + i for i in range(3)}
        for uid in uids:
            manager.devices[uid] = device = SmartDeviceClient(*stream)
            for method in ('ping', 'disable', 'subscribe', 'unsubscribe', 'read', 'heartbeat'):
                result = asyncio.get_running_loop().create_future()
                mocker.patch.object(device, method, autospec=True).return_value = result
                result.set_result(None)
        yield manager
    BufferManager.unlink_all()


@pytest.fixture
async def device(stream, device_manager):
    yield SmartDeviceClient(
        *stream,
        device_manager.buffers.get_or_create(0x0000_01_ffffffff_ffffffff),
    )


def make_reads(*packets):
    reads = []
    loop = asyncio.get_running_loop()
    for packet in packets:
        read = loop.create_future()
        read.set_result(packet + b'\x00')
        reads.append(read)
    reads.append(loop.create_future())
    return reads


@pytest.mark.skipif(not HAS_UDEV, reason='udev not available (requires Linux)')
@pytest.mark.asyncio
async def test_event_observer(mocker, event_observer):
    comports = mocker.patch('serial.tools.list_ports.comports')
    sys_root = '/sys/devices/pci0000:00/0000:00:14.0/usb1'
    event_observer.context.list_devices.return_value = [
        types.SimpleNamespace(
            action=None,
            sys_path=f'{sys_root}/1-2',
            properties={'PRODUCT': '0x2341/0x8037/'},
        ),
        types.SimpleNamespace(
            action=None,
            sys_path=f'{sys_root}/1-2/1-2:1.0',
            properties={'PRODUCT': '0x2341/0x8037/'},
        ),
        types.SimpleNamespace(
            action=None,
            sys_path=f'{sys_root}/1-2/1-2:1.0',
            properties={'PRODUCT': '0x2341/0x8037'},
        ),
        types.SimpleNamespace(
            action=None,
            sys_path=f'{sys_root}/1-2/1-2:1.0',
            properties={},
        ),
    ]
    comports.return_value = [
        types.SimpleNamespace(location=None, device=None),
        types.SimpleNamespace(location='1-2:1.0', device='/dev/ttyACM0'),
    ]
    assert not event_observer.monitor.started
    assert await event_observer.get_ports() == {Path('/dev/ttyACM0')}
    assert event_observer.monitor.started
    event_observer.add_devices([
        types.SimpleNamespace(
            action='remove',
            sys_path=f'{sys_root}/1-2/1-2:1.0',
            properties={'PRODUCT': '0x2341/0x8037/'},
        ),
        types.SimpleNamespace(
            action='add',
            sys_path=f'{sys_root}/1-2/1-2:1.0',
            properties={'PRODUCT': '0x2341/0x8037/'},
        ),
    ])
    assert await event_observer.get_ports() == {Path('/dev/ttyACM0')}


@pytest.mark.asyncio
async def test_polling_observer(polling_observer):
    pattern, *_ = polling_observer.patterns
    assert await polling_observer.get_ports() == set()
    path0 = Path(pattern.replace('*', '0'))
    path0.touch()
    assert await polling_observer.get_ports() == {path0}
    assert await polling_observer.get_ports() == set()
    path1 = Path(pattern.replace('*', '1'))
    path1.touch()
    assert await polling_observer.get_ports() == {path1}
    assert await polling_observer.get_ports() == set()
    path0.unlink()
    assert await polling_observer.get_ports() == set()
    path0.touch()
    assert await polling_observer.get_ports() == {path0}


@pytest.mark.asyncio
async def test_read_error(mocker, stream, device):
    reader, _ = stream
    reader.readuntil.side_effect = make_reads(b'\xff\xff\xff')
    logger = mocker.spy(device.logger, 'error')
    async with device.communicate():
        await asyncio.sleep(0.02)
        assert logger.call_count == 1


@pytest.mark.asyncio
async def test_write_error(mocker, device):
    message = mocker.patch('runtime.messaging.Message').return_value
    message.encode_into_buf.side_effect = MessageError('encoding error')
    await device.write_queue.put(message)
    logger = mocker.spy(device.logger, 'error')
    async with device.communicate():
        await asyncio.sleep(0.02)
        assert logger.call_count == 1


@pytest.mark.asyncio
async def test_ping(stream, device):
    _, writer = stream
    async with device.communicate():
        await device.ping()
        await asyncio.sleep(0.02)
        writer.write.assert_has_calls([call(b'\x02\x10\x02\x10'), call(b'\x00')])


@pytest.mark.asyncio
async def test_disable(stream, device):
    _, writer = stream
    async with device.communicate():
        await device.disable()
        await asyncio.sleep(0.02)
        writer.write.assert_has_calls([call(b'\x02\x16\x02\x16'), call(b'\x00')])


@pytest.mark.asyncio
@pytest.mark.parametrize('params,interval,packet', [
    (None, 0, b'\x04\x11\x04\x07\x01\x01\x02\x12'),
    (['switch1'], 1, b'\x04\x11\x04\x02\x04\xe8\x03\xfc'),
])
async def test_subscribe(params, interval, packet, stream, device):
    _, writer = stream
    async with device.communicate():
        await device.subscribe(params, interval)
        await asyncio.sleep(0.02)
        writer.write.assert_has_calls([call(packet), call(b'\x00')])


@pytest.mark.asyncio
async def test_unsubscribe(stream, device):
    _, writer = stream
    async with device.communicate():
        await device.unsubscribe()
        await asyncio.sleep(0.02)
        writer.write.assert_has_calls([call(b'\x03\x11\x04\x01\x01\x01\x02\x15'), call(b'\x00')])


@pytest.mark.asyncio
async def test_read(stream, device):
    _, writer = stream
    async with device.communicate():
        await device.read(['switch0', 'switch2'])
        await device.poll_buffer()
        await asyncio.sleep(0.02)
        writer.write.assert_has_calls([call(b'\x04\x13\x02\x05\x02\x14'), call(b'\x00')])


@pytest.mark.asyncio
async def test_write(stream, device):
    _, writer = stream
    async with device.communicate():
        await asyncio.to_thread(device.buffer.write, 'switch1', True)
        await device.poll_buffer()
        await asyncio.sleep(0.02)
        writer.write.assert_has_calls([call(b'\x04\x14\x03\x02\x03\x01\x14'), call(b'\x00')])


@pytest.mark.asyncio
async def test_discovery(mocker, stream, device, device_manager):
    reader, writer = stream
    device.buffer = None
    reader.readuntil.side_effect = make_reads(
        b'\x03\x17\x01\x02\x16',
        b'\x03\x12\x0f\x01\x01\x01\x01\x01\x0b\x01'
        b'\xff\xff\xff\xff\xff\xff\xff\xff\x1c',
    )
    async with device.communicate():
        uid = await asyncio.wait_for(device.discover(device_manager.buffers), 0.1)
    writer.write.assert_has_calls([call(b'\x02\x10\x02\x10'), call(b'\x00')])
    assert int(uid) == 0x0000_01_ffffffff_ffffffff
    assert device.buffer.subscription == set()
    assert device.buffer.interval == pytest.approx(0)
    assert device.buffer.device_id == 0
    param_names = set(param.name for param in device.buffer.params.values())
    assert param_names == {'switch0', 'switch1', 'switch2'}


@pytest.mark.asyncio
async def test_heartbeat_timeout(device):
    async with device.communicate():
        with pytest.raises(asyncio.TimeoutError):
            await device.heartbeat(timeout=0.1)


@pytest.mark.asyncio
async def test_heartbeat(stream, device):
    reader, writer = stream
    async with device.communicate():
        await device.heartbeat(block=False)
        await asyncio.sleep(0.02)
        ((req_buf,), _kwargs), _ = writer.write.call_args_list
        message = Message.decode(req_buf)
        assert message.type is MessageType.HB_REQ
        heartbeat_id = message.read_hb_req()
        assert 0 <= heartbeat_id < 256
        writer.write.reset_mock()
        reader.readuntil.return_value = result = asyncio.get_running_loop().create_future()
        result.set_result(Message.make_hb_res(heartbeat_id))
        await device.heartbeat(heartbeat_id=heartbeat_id, timeout=0.1)
        writer.write.assert_has_calls([call(req_buf), call(b'\x00')])


@pytest.mark.asyncio
async def test_heartbeat_dup_id(device):
    async with device.communicate():
        with pytest.raises(ValueError):
            await asyncio.gather(
                device.heartbeat(0xff, timeout=0.1),
                device.heartbeat(0xff, timeout=0.1),
            )


@pytest.mark.asyncio
async def test_serial_disconnect(stream, device):
    reader, _ = stream
    reader.readuntil.return_value = result = asyncio.get_running_loop().create_future()
    result.set_exception(serial.SerialException('connection broken'))
    async with device.communicate() as tasks:
        await asyncio.gather(*tasks)


@pytest.mark.asyncio
async def test_handle_hb_req(stream, device):
    reader, writer = stream
    reader.readuntil.side_effect = make_reads(b'\x05\x17\x01\x80\x96')
    async with device.communicate() as tasks:
        tasks.add(asyncio.create_task(device.handle_messages(), name='dev-handle'))
        await asyncio.sleep(0.02)
        writer.write.assert_has_calls([call(b'\x05\x18\x01\x80\x99'), call(b'\x00')])


@pytest.mark.asyncio
async def test_handle_hb_res(mocker, stream, device):
    reader, _ = stream
    reader.readuntil.side_effect = make_reads(b'\x05\x18\x01\x80\x99', b'\x05\x18\x01\x80\x99')
    logger = mocker.spy(device.logger, 'error')
    async with device.communicate() as tasks:
        tasks.add(asyncio.create_task(device.handle_messages(), name='dev-handle'))
        await device.heartbeat(heartbeat_id=0x80)
        await asyncio.sleep(0.02)
        assert logger.call_count == 1


@pytest.mark.asyncio
async def test_handle_sub_res(mocker, stream, device):
    reader, _ = stream
    reader.readuntil.side_effect = make_reads(
        b'\x04\x12\x0f\x01\x02\x14\x01\x01\x06'
        b'\x0f\xef\xbe\xad\xde\x01\x01\x01\x02%'
    )
    async with device.communicate() as tasks:
        tasks.add(asyncio.create_task(device.handle_messages(), name='dev-handle'))
        await asyncio.sleep(0.02)
        assert int(device.buffer.uid) == 0x0000_0f_00000000_deadbeef
        assert device.buffer.subscription == {'switch0'}
        assert device.buffer.interval == pytest.approx(0.02)


@pytest.mark.asyncio
async def test_handle_dev_data(stream, device):
    reader, _ = stream
    reader.readuntil.side_effect = make_reads(b'\x04\x15\x05\x07\x01\x04\x01\x01\x17')
    async with device.communicate() as tasks:
        tasks.add(asyncio.create_task(device.handle_messages(), name='dev-handle'))
        await asyncio.sleep(0.02)
        assert not device.buffer.get('switch0')
        assert device.buffer.get('switch1')
        assert device.buffer.get('switch2')


@pytest.mark.parametrize('packet', [
    b'\x05\xff\x01\xff\x01',                # Error packet
    b'\x02\x10\x02\x10',                    # Ping
    b'\x03\x11\x04\x01\x01\x01\x02\x15',    # Unsubscribe
    b'\x02\x16\x02\x16',                    # Device disable
])
@pytest.mark.asyncio
async def test_handle_error(packet, mocker, stream, device):
    reader, _ = stream
    reader.readuntil.side_effect = make_reads(packet)
    logger = mocker.spy(device.logger, 'error')
    async with device.communicate() as tasks:
        tasks.add(asyncio.create_task(device.handle_messages(), name='dev-handle'))
        await asyncio.sleep(0.02)
        assert logger.call_count == 1
