import ctypes
import multiprocessing
import time
import warnings
from pathlib import Path

import pytest

from runtime.buffer import (
    Buffer,
    BufferStore,
    DeviceBuffer,
    DeviceBufferError,
    DeviceUID,
    Parameter,
)
from runtime.messaging import Message


@pytest.fixture
def device_buffer_type():
    params = [
        Parameter(
            'flag',
            ctypes.c_bool,
            0,
            readable=False,
            writeable=True,
            subscribed=False,
        ),
        Parameter('duty_cycle', ctypes.c_double, 1),
        Parameter('id', ctypes.c_uint32, 2, writeable=True),
        Parameter('large', ctypes.c_char * 253, 3, writeable=True),
        Parameter('pos', ctypes.c_double, 4, writeable=True, lower=-1, upper=1),
    ]
    yield DeviceBuffer.make_type('example-device', params)


@pytest.fixture
def device_buffer(device_buffer_type):
    try:
        with device_buffer_type.open('test-device') as device_buffer:
            yield device_buffer
    finally:
        device_buffer_type.unlink('test-device')


@pytest.fixture
def peer(device_buffer_type):
    ready, done = multiprocessing.Event(), multiprocessing.Event()

    def target(start, done):
        with device_buffer_type.open('test-device') as device_buffer:
            device_buffer.write('id', 0xC0DEBEEF)
            message = Message.decode(b'\x04\x15\x06\x02\x06m\xe7\xfb\xbd\xdd')
            device_buffer.update(message)
            ready.set()
            done.wait(3)

    peer = multiprocessing.Process(target=target, args=(ready, done), daemon=True)
    peer.start()
    ready.wait(3)
    try:
        yield
        done.set()
        peer.join()
    finally:
        device_buffer_type.unlink('test-device')


@pytest.fixture
def device_uid():
    yield DeviceUID(0xFFFF, 0xEE, 0xC0DEBEEF_DEADBEEF)


@pytest.fixture(params=[False, True])
def buffers(request):
    catalog = {
        'example-device': {
            'device_id': 0x80,
            'sub_interval': 0.08,
            'heartbeat_interval': 2,
            'params': [
                {
                    'name': 'duty_cycle',
                    'type': 'float',
                    'writeable': True,
                    'lower': -1,
                    'upper': 1,
                },
                {
                    'name': 'enabled',
                    'type': 'bool',
                    'readable': False,
                    'writeable': True,
                    'subscribed': False,
                },
            ],
        },
        'camera': {
            'params': [
                {
                    'name': 'rgb',
                    'type': 'uint8[128][128][3]',
                },
            ]
        },
    }
    catalog = BufferStore.make_catalog(catalog)
    with BufferStore(catalog, shared=request.param) as buffers:
        yield buffers
    BufferStore.unlink_all()


def test_update_dev_data(mocker, device_buffer):
    mocker.patch('time.time')

    time.time.return_value = 1
    device_buffer.update(Message.decode(b'\x04\x15\x06\x04\x06\xef\xbe\xad\xde5'))
    assert device_buffer.last_update == pytest.approx(1)
    assert device_buffer.get('id') == 0xDEADBEEF
    assert device_buffer.get_update() == {'id': 0xDEADBEEF}

    time.time.return_value = 2
    device_buffer.update(Message.decode(b'\x04\x15\x06\x04\x06\xef\xbe\xad\xde5'))
    device_buffer.update(Message.decode(b'\x04\x15\x06\x02\x06m\xe7\xfb\xbd\xdd'))
    assert device_buffer.last_update == pytest.approx(2)
    assert device_buffer.get('duty_cycle') == pytest.approx(-0.123)
    assert device_buffer.get('id') == 0xDEADBEEF
    assert device_buffer.get_update() == {
        'duty_cycle': pytest.approx(-0.123),
        'id': 0xDEADBEEF,
    }

    time.time.return_value = 3
    device_buffer.update(Message.decode(b'\x03\x15\x02\x01\x02\x17'))
    assert device_buffer.last_update == pytest.approx(3)
    assert device_buffer.get_update() == {}


def test_update_dev_read(device_buffer):
    device_buffer.update(Message.make_dev_read(0b10))
    device_buffer.update(Message.make_dev_read(0xFFFD))
    assert device_buffer.get_read() == {'duty_cycle', 'id', 'large', 'pos'}


def test_update_dev_write(mocker, device_buffer):
    mocker.patch('time.time')
    time.time.return_value = 1
    device_buffer.update(Message.decode(b'\x04\x14\x06\x04\x06\xef\xbe\xad\xde4'))
    assert device_buffer.last_write == pytest.approx(1)
    assert device_buffer.get_write() == {'id': 0xDEADBEEF}


def test_update_sub_req(device_buffer):
    device_buffer.update(Message.make_sub_req(0b100, 5))
    assert device_buffer.subscription == {'id'}
    device_buffer.set('id', 0xDEADBEEF)
    (message,) = device_buffer.emit_subscription()
    assert message.encode() == b'\x04\x15\x06\x04\x06\xef\xbe\xad\xde5'
    assert device_buffer.interval == pytest.approx(0.04)
    device_buffer.update(Message.make_sub_req(0xFFFF, 0))
    assert device_buffer.interval == pytest.approx(0)


def test_update_sub_res(device_uid, device_buffer):
    sub_res = Message.make_sub_res(
        0b11,
        100,
        device_uid.device_id,
        device_uid.year,
        device_uid.random,
    )
    device_buffer.update(sub_res)
    assert device_buffer.uid == 0xFFFF_EE_C0DEBEEF_DEADBEEF
    assert device_buffer.subscription == {'flag', 'duty_cycle'}
    assert device_buffer.interval == pytest.approx(0.1)
    device_buffer.set('duty_cycle', 0.123)
    assert list(device_buffer.emit_dev_data()) == []
    device_buffer.update(Message.make_sub_res(0, 0, 0, 0, 0))
    assert device_buffer.subscription == set()
    assert device_buffer.interval == pytest.approx(0)


def test_update_not_handled(device_buffer):
    device_buffer.update(Message.make_ping())


def test_make_sub_req_res(device_buffer):
    device_buffer.update(Message.make_sub_res(0, 0, 0, 0, 0))
    sub_req = device_buffer.make_sub_req().encode()
    assert sub_req == Message.make_sub_req(0b11110, 40).encode()
    message = device_buffer.make_sub_req({'duty_cycle'}, 0.08)
    assert message.encode() == Message.make_sub_req(0b10, 80).encode()
    sub_res = device_buffer.make_sub_res().encode()
    assert sub_res == Message.make_sub_res(0, 0, 0, 0, 0).encode()


def test_read(device_buffer):
    device_buffer.read(['flag', 'duty_cycle'])
    device_buffer.read(['id'])
    (message,) = device_buffer.emit_dev_rw()
    assert message.encode() == b'\x04\x13\x02\x06\x02\x17'
    assert list(device_buffer.emit_dev_rw()) == []
    device_buffer.read(['id'])
    (message,) = device_buffer.emit_dev_rw()
    assert message.encode() == b'\x04\x13\x02\x04\x02\x15'
    device_buffer.read()
    (message,) = device_buffer.emit_dev_rw()
    assert message.encode() == b'\x04\x13\x02\x1e\x02\x0f'


def test_write(mocker, device_buffer):
    mocker.patch('time.time')
    time.time.return_value = 1
    device_buffer.write('flag', True)
    device_buffer.write('id', 0xDEADBEEF)
    (message,) = device_buffer.emit_dev_rw()
    assert device_buffer.last_write == 1
    assert message.encode() == b'\x04\x14\x07\x05\x07\x01\xef\xbe\xad\xde5'
    time.time.return_value = 2
    device_buffer.write('flag', True)
    (message,) = device_buffer.emit_dev_rw()
    assert device_buffer.last_write == 2
    assert message.encode() == b'\x04\x14\x03\x01\x03\x01\x17'
    assert set(device_buffer.emit_dev_rw()) == set()


def test_write_large(device_buffer):
    device_buffer.write('id', 0xDEADBEEF)
    device_buffer.write('large', b'\xff' * 253)
    device_buffer.write('pos', 0.5)
    messages = {bytes(message.encode()) for message in device_buffer.emit_dev_rw()}
    expected = {
        b'\x04\x14\x06\x04\x06\xef\xbe\xad\xde4',
        b'\x04\x14\xff\x08' + b'\xff' * 254 + b'\x1c',
        b'\x04\x14\x06\x10\x01\x01\x01\x03?=',
    }
    assert messages == expected
    assert set(device_buffer.emit_dev_rw()) == set()


def test_read_deny(device_buffer):
    with pytest.raises(DeviceBufferError) as excinfo:
        device_buffer.get('flag')
    assert excinfo.value.context['param'] == 'flag'


def test_write_deny(mocker, device_buffer):
    mocker.patch('time.time')
    time.time.return_value = 1
    device_buffer.write('flag', False)
    time.time.return_value = 2
    with pytest.raises(DeviceBufferError) as excinfo:
        device_buffer.write('duty_cycle', -0.123)
    assert device_buffer.last_write == pytest.approx(1)
    assert excinfo.value.context['param'] == 'duty_cycle'


def test_emit_dev_data(device_buffer):
    device_buffer.set('id', 0xDEADBEEF)
    device_buffer.set('large', b'\xff' * 253)
    messages = {bytes(message.encode()) for message in device_buffer.emit_dev_data()}
    expected = {
        b'\x04\x15\x06\x04\x06\xef\xbe\xad\xde5',
        b'\x04\x15\xff\x08' + b'\xff' * 254 + b'\x1d',
    }
    assert messages == expected
    assert set(device_buffer.emit_dev_data()) == set()


def test_valid_bit(device_buffer):
    device_buffer.valid = False
    actions = [
        lambda: device_buffer.get('id'),
        lambda: device_buffer.set('id', 0xDEADBEEF),
        lambda: device_buffer.write('id', 1),
        lambda: device_buffer.read([]),
        lambda: list(device_buffer.emit_dev_rw()),
        lambda: list(device_buffer.emit_dev_data()),
        lambda: device_buffer.make_sub_req(),
        lambda: device_buffer.make_sub_res(),
        lambda: device_buffer.get_update(),
        lambda: device_buffer.update(Message.decode(b'\x03\x15\x02\x01\x02\x17')),
        lambda: device_buffer.last_update,
        lambda: device_buffer.last_write,
        lambda: device_buffer.uid,
        lambda: device_buffer.subscription,
        lambda: device_buffer.interval,
    ]
    for action in actions:
        with pytest.raises(DeviceBufferError):
            action()
    device_buffer.valid = True
    for action in actions:
        action()


def test_shm_attach_fail(device_buffer_type):
    with pytest.raises(DeviceBufferError):
        with device_buffer_type.open('test-device', create=False):
            pass


@pytest.mark.parametrize('create', [False, True])
def test_shm_create_attach(create, device_buffer_type, peer):
    with device_buffer_type.open('test-device', create=create) as device_buffer:
        messages = [message.encode() for message in device_buffer.emit_dev_rw()]
        assert messages == [b'\x04\x14\x06\x04\x06\xef\xbe\xde\xc0Y']
        assert device_buffer.get('duty_cycle') == pytest.approx(-0.123)


def test_lowerbound_exceeded(device_buffer):
    with warnings.catch_warnings(record=True) as capture:
        device_buffer.write('pos', -1)
    expected = b'\x04\x14\x06\x10\x01\x01\x04\x80\xbf='
    assert [message.encode() for message in device_buffer.emit_dev_rw()] == [expected]
    assert len(capture) == 0
    with warnings.catch_warnings(record=True) as capture:
        device_buffer.write('pos', -1.01)
    assert [message.encode() for message in device_buffer.emit_dev_rw()] == [expected]
    assert len(capture) == 1


def test_upperbound_exceeded(device_buffer):
    with warnings.catch_warnings(record=True) as capture:
        device_buffer.write('pos', 1)
    expected = b'\x04\x14\x06\x10\x01\x01\x04\x80?\xbd'
    assert [message.encode() for message in device_buffer.emit_dev_rw()] == [expected]
    assert len(capture) == 0
    with warnings.catch_warnings(record=True) as capture:
        device_buffer.write('pos', 1.01)
    assert [message.encode() for message in device_buffer.emit_dev_rw()] == [expected]
    assert len(capture) == 1


def test_too_many_params():
    params = [Parameter(f'switch{i}', ctypes.c_bool, i) for i in range(17)]
    Buffer.make_type('too-many-params', params)
    with pytest.raises(ValueError):
        DeviceBuffer.make_type('too-many-params', params)


def test_type_registration(buffers):
    ExampleDevice = buffers.catalog['example-device']
    assert issubclass(ExampleDevice, DeviceBuffer)
    assert ExampleDevice.device_id == 0x80
    assert ExampleDevice.sub_interval == pytest.approx(0.08)
    assert ExampleDevice.write_interval == pytest.approx(0.04)
    assert ExampleDevice.heartbeat_interval == pytest.approx(2)
    assert list(ExampleDevice.params.values()) == [
        Parameter('duty_cycle', ctypes.c_float, 0, writeable=True, lower=-1, upper=1),
        Parameter(
            'enabled',
            ctypes.c_bool,
            1,
            readable=False,
            writeable=True,
            subscribed=False,
        ),
    ]
    Camera = buffers.catalog['camera']
    assert issubclass(Camera, Buffer) and not issubclass(Camera, DeviceBuffer)
    assert list(Camera.params.values()) == [
        Parameter('rgb', ctypes.c_uint8 * 128 * 128 * 3, 0)
    ]


def test_duplicate_registration():
    catalog = {
        'dev1': {'device_id': 0x80},
        'dev2': {'device_id': 0x80},
    }
    with pytest.raises(DeviceBufferError):
        BufferStore(BufferStore.make_catalog(catalog))


def test_key_equivalence(buffers):
    buf1 = buffers.get_or_open(0x80_00_00000000_00000000)
    buf2 = buffers['example-device', 0x80_00_00000000_00000000]
    assert buf1 is buf2


def test_buffer_access_error(buffers):
    if buffers.shared:
        with pytest.raises(DeviceBufferError):
            _ = buffers[0x80_00_00000000_00000000]
    with pytest.raises(KeyError):
        buffers.get_or_open(0x81_00_00000000_00000000)
    assert len(buffers) == 0


def test_shm_open_close(buffers):
    if not buffers.shared:
        pytest.skip()
    buf = buffers.get_or_open(0x80_00_00000000_00000000)
    assert len(buffers) == 1
    assert list(buffers.items()) == [
        (('example-device', 0x80_00_00000000_00000000), buf)
    ]
    path = Path('/dev/shm/rt-example-device-604462909807314587353088')
    assert path.exists()
    assert buf.valid
    buffers.stack.close()
    assert len(buffers) == 0
    assert path.exists()
    buf2 = buffers.get_or_open(0x80_00_00000000_00000000)
    buf3 = buffers[0x80_00_00000000_00000000]
    assert buf2 is buf3
    assert buf2.valid
    assert buf is not buf2
