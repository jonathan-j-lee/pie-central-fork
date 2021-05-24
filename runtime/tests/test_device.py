import asyncio
import os
import socket
import tempfile
import types
from pathlib import Path
from unittest.mock import call

import pytest
import serial

import runtime
from runtime import log
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
    log.configure(fmt='pretty', level='debug')


@pytest.fixture
async def event_observer(mocker):
    rsock, wsock = socket.socketpair()
    context = mocker.patch('pyudev.Context').return_value
    monitor = mocker.patch('pyudev.Monitor').return_value
    monitor.started = False
    observer = EventObserver(context=context, monitor=monitor)
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
async def device_manager(mocker, stream):
    manager = SmartDeviceManager()
    await asyncio.to_thread(
        manager.buffers.load_catalog,
        Path(runtime.__file__).parent / 'catalog.yaml',
    )
    manager.buffers.catalog['limit-switch'].interval = 0.2
    with manager.buffers:
        uids = {0x0000_01_00000000_00000000 + i for i in range(3)}
        for uid in uids:
            manager.devices[uid] = device = SmartDeviceClient(*stream)
            for method in ('ping', 'disable', 'subscribe', 'unsubscribe', 'heartbeat'):
                mocker.patch.object(device, method, autospec=True).return_value = result = asyncio.Future()
                result.set_result(None)
        yield manager
    manager.buffers.unlink_all()


@pytest.fixture
async def device(stream, device_manager):
    yield SmartDeviceClient(
        *stream,
        device_manager.buffers.get_or_create(0x0000_01_ffffffff_ffffffff),
    )


def make_reads(*packets):
    reads = []
    for packet in packets:
        read = asyncio.Future()
        read.set_result(packet + b'\x00')
        reads.append(read)
    reads.append(asyncio.Future())
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
    async with device.communicate() as rw_tasks:
        await asyncio.sleep(0.02)
        assert logger.call_count == 1


@pytest.mark.asyncio
async def test_write_error(mocker, device):
    message = mocker.patch('runtime.messaging.Message').return_value
    message.encode_into_buf.side_effect = MessageError('encoding error')
    await device.write_queue.put(message)
    logger = mocker.spy(device.logger, 'error')
    async with device.communicate() as rw_tasks:
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
    (None, 0, b'\x04\x11\x04\x07\x02\xc8\x02\xda'),
    (['switch1'], 1, b'\x04\x11\x04\x02\x04\xe8\x03\xfc'),
])
async def test_subscribe(params, interval, packet, stream, device, device_manager):
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
    assert device.buffer.delay == pytest.approx(0)
    assert device.buffer.subscription == []
    assert device.buffer.device_id == 0
    assert [param.name for param in device.buffer.params] == ['switch0', 'switch1', 'switch2']


@pytest.mark.asyncio
async def test_heartbeat(stream, device, device_manager):
    reader, writer = stream
    async with device.communicate():
        with pytest.raises(asyncio.TimeoutError):
            await device.heartbeat(timeout=0.1)
        await device.heartbeat(block=False)
        ((req_buf,), _kwargs), _ = writer.write.call_args_list
        message = Message.decode(req_buf)
        assert message.type is MessageType.HB_REQ
        heartbeat_id = message.read_hb_req()
        assert 0 <= heartbeat_id < 256
        writer.write.reset_mock()
        reader.readuntil.return_value = result = asyncio.Future()
        result.set_result(Message.make_hb_res(heartbeat_id))
        await device.heartbeat(heartbeat_id=heartbeat_id, timeout=0.1)
        writer.write.assert_has_calls([call(req_buf), call(b'\x00')])


@pytest.mark.asyncio
async def test_serial_disconnect(stream, device):
    reader, _ = stream
    reader.readuntil.return_value = result = asyncio.Future()
    result.set_exception(serial.SerialException('connection broken'))
    async with device.communicate() as rw_tasks:
        await asyncio.gather(*rw_tasks)


@pytest.mark.asyncio
async def test_handle_buf_required(device):
    device.buffer = None
    async with device.communicate():
        with pytest.raises(DeviceError):
            await device.handle_messages()


@pytest.mark.asyncio
async def test_handle_hb_req(stream, device):
    reader, writer = stream
    reader.readuntil.side_effect = make_reads(b'\x05\x17\x01\x80\x96')
    async with device.communicate():
        handle_task = asyncio.create_task(device.handle_messages())
        await asyncio.sleep(0.02)
        writer.write.assert_has_calls([call(b'\x05\x18\x01\x80\x99'), call(b'\x00')])
        handle_task.cancel()


@pytest.mark.asyncio
async def test_handle_hb_res(mocker, stream, device):
    reader, _ = stream
    reader.readuntil.side_effect = make_reads(b'\x05\x18\x01\x80\x99', b'\x05\x18\x01\x80\x99')
    logger = mocker.spy(device.logger, 'error')
    async with device.communicate():
        handle_task = asyncio.create_task(device.handle_messages())
        await device.heartbeat(heartbeat_id=0x80)
        await asyncio.sleep(0.02)
        assert logger.call_count == 1
        handle_task.cancel()


@pytest.mark.asyncio
async def test_handle_sub_res(mocker, stream, device):
    reader, _ = stream
    reader.readuntil.side_effect = make_reads(
        b'\x04\x12\x0f\x01\x02\x14\x01\x01\x06'
        b'\x0f\xef\xbe\xad\xde\x01\x01\x01\x02%'
    )
    async with device.communicate():
        handle_task = asyncio.create_task(device.handle_messages())
        await asyncio.sleep(0.02)
        assert int(device.buffer.uid) == 0x0000_0f_00000000_deadbeef
        assert device.buffer.delay == pytest.approx(0.02)
        assert device.buffer.subscription == ['switch0']
        handle_task.cancel()


@pytest.mark.asyncio
async def test_handle_dev_data(stream, device):
    reader, _ = stream
    reader.readuntil.side_effect = make_reads(b'\x04\x15\x05\x07\x01\x04\x01\x01\x17')
    async with device.communicate():
        handle_task = asyncio.create_task(device.handle_messages())
        await asyncio.sleep(0.02)
        assert not device.buffer.get_value('switch0')
        assert device.buffer.get_value('switch1')
        assert device.buffer.get_value('switch2')
        handle_task.cancel()


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
    async with device.communicate():
        handle_task = asyncio.create_task(device.handle_messages())
        await asyncio.sleep(0.02)
        assert logger.call_count == 1
        handle_task.cancel()


@pytest.mark.asyncio
async def test_device_manager(device_manager):
    assert set(await device_manager.list_uids()) == {
        0x0000_01_00000000_00000000,
        0x0000_01_00000000_00000001,
        0x0000_01_00000000_00000002,
    }
    for method_name in ('ping', 'disable', 'unsubscribe'):
        method = getattr(device_manager, method_name)
        await method()
        await method(0x0000_01_00000000_00000001)
        await method([0x0000_01_00000000_00000001, 0x0000_01_00000000_00000002])
        calls = {
            0x0000_01_00000000_00000000: 1,
            0x0000_01_00000000_00000001: 3,
            0x0000_01_00000000_00000002: 2,
        }
        for uid, count in calls.items():
            assert getattr(device_manager.devices[uid], method_name).call_count == count
    limit_switch = device_manager.devices[0x0000_01_00000000_00000000]
    await device_manager.subscribe(0x0000_01_00000000_00000000, ['switch0'], 0.5)
    limit_switch.subscribe.assert_called_with(['switch0'], pytest.approx(0.5))
    await device_manager.heartbeat(0x0000_01_00000000_00000000, 0xa0, 2, True)
    limit_switch.heartbeat.assert_called_with(0xa0, pytest.approx(2), True)
