import ctypes
import multiprocessing
import time
import warnings
import pytest
from runtime.buffer import Parameter, DeviceBuffer, DeviceUID, RuntimeBufferError
from runtime.messaging import Message


@pytest.fixture
def device_buffer_type():
    yield DeviceBuffer.make_type('ExampleDevice', [
        Parameter('flag', ctypes.c_bool, readable=False, writeable=True),
        Parameter('duty_cycle', ctypes.c_double),
        Parameter('id', ctypes.c_uint32, writeable=True),
        Parameter('large', ctypes.c_char * 253, writeable=True),
        Parameter('pos', ctypes.c_double, writeable=True, lower=-1, upper=1),
    ])


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
            device_buffer.set_value('id', 0xc0debeef)
            device_buffer.update_data(Message.decode(b'\x04\x15\x06\x02\x06m\xe7\xfb\xbd\xdd'))
            ready.set()
            done.wait(3)
    peer = multiprocessing.Process(target=target, args=(ready, done), daemon=True)
    peer.start()
    ready.wait(3)
    yield
    done.set()
    peer.join()


@pytest.fixture
def device_uid():
    yield DeviceUID(0xffff, 0xee, 0xc0debeef_deadbeef)


def test_repr(device_buffer):
    uid1 = device_buffer.control.uid
    uid2 = eval(repr(uid1))
    assert uid1.device_id == uid2.device_id
    assert uid1.year == uid2.year
    assert uid1.random == uid2.random


def test_uid_to_int(device_uid):
    assert int(device_uid) == 0xffff_ee_c0debeef_deadbeef


def test_update(mocker, device_buffer):
    mocker.patch('time.time')
    device_buffer.read._timestamp = 0
    device_buffer.read.duty_cycle = 0.123

    time.time.return_value = 1
    device_buffer.update_data(Message.decode(b'\x04\x15\x06\x04\x06\xef\xbe\xad\xde5'))
    assert device_buffer.last_update == pytest.approx(1)
    assert device_buffer.get_value('duty_cycle') == pytest.approx(0.123)
    assert device_buffer.get_value('id') == 0xdeadbeef
    assert device_buffer.get_update() == {'id': 0xdeadbeef}

    time.time.return_value = 2
    device_buffer.update_data(Message.decode(b'\x04\x15\x06\x04\x06\xef\xbe\xad\xde5'))
    device_buffer.update_data(Message.decode(b'\x04\x15\x06\x02\x06m\xe7\xfb\xbd\xdd'))
    assert device_buffer.last_update == pytest.approx(2)
    assert device_buffer.get_value('duty_cycle') == pytest.approx(-0.123)
    assert device_buffer.get_value('id') == 0xdeadbeef
    assert device_buffer.get_update() == {'duty_cycle': pytest.approx(-0.123), 'id': 0xdeadbeef}

    time.time.return_value = 3
    device_buffer.update_data(Message.decode(b'\x03\x15\x02\x01\x02\x17'))
    assert device_buffer.last_update == pytest.approx(2)
    assert device_buffer.get_update() == {}


def test_read(device_buffer):
    device_buffer.set_read(['flag', 'duty_cycle'])
    device_buffer.set_read(['id'])
    assert device_buffer.get_read().encode() == b'\x04\x13\x02\x06\x02\x17'
    device_buffer.set_read(['id'])
    assert device_buffer.get_read().encode() == b'\x04\x13\x02\x04\x02\x15'
    assert device_buffer.get_read() is None


def test_write(mocker, device_buffer):
    mocker.patch('time.time')
    device_buffer.write._timestamp = 0
    time.time.return_value = 1
    device_buffer.set_value('flag', True)
    device_buffer.set_value('id', 0xdeadbeef)
    (message,) = device_buffer.get_write()
    assert device_buffer.last_write == 1
    assert message.encode() == b'\x04\x14\x07\x05\x07\x01\xef\xbe\xad\xde5'
    time.time.return_value = 2
    device_buffer.set_value('flag', True)
    (message,) = device_buffer.get_write()
    assert device_buffer.last_write == 2
    assert message.encode() == b'\x04\x14\x03\x01\x03\x01\x17'
    assert len(list(device_buffer.get_write())) == 0


def test_write_large(device_buffer):
    device_buffer.set_value('id', 0xdeadbeef)
    device_buffer.set_value('large', b'\xff'*253)
    device_buffer.set_value('pos', 0.5)
    message1, message2, message3 = device_buffer.get_write()
    assert message1.encode() == b'\x04\x14\x06\x04\x06\xef\xbe\xad\xde4'
    assert message2.encode() == b'\x04\x14\xff\x08' + b'\xff'*254 + b'\x1c'
    assert message3.encode() == b'\x04\x14\x06\x10\x01\x01\x01\x03?='


def test_read_deny(device_buffer):
    with pytest.raises(RuntimeBufferError) as excinfo:
        device_buffer.get_value('flag')
    assert excinfo.value.context['param'] == 'flag'


def test_write_deny(mocker, device_buffer):
    mocker.patch('time.time')
    device_buffer.write._timestamp = 0
    time.time.return_value = 1
    with pytest.raises(RuntimeBufferError) as excinfo:
        device_buffer.set_value('duty_cycle', -0.123)
    assert device_buffer.last_update == 0
    assert excinfo.value.context['param'] == 'duty_cycle'


def test_subscription(device_uid, device_buffer):
    device_buffer.set_subscription(device_uid, ['duty_cycle', 'flag'])
    assert device_buffer.uid.device_id == 0xffff
    assert device_buffer.uid.year == 0xee
    assert device_buffer.uid.random == 0xc0debeefdeadbeef
    assert device_buffer.subscription == ['flag', 'duty_cycle']
    device_buffer.set_subscription(DeviceUID(0, 0, 0), [])
    assert device_buffer.subscription == []


def test_valid_bit(device_buffer):
    device_buffer.set_valid(False)
    actions = [
        lambda: device_buffer.get_value('id'),
        lambda: device_buffer.set_value('id', 1),
        lambda: device_buffer.set_read([]),
        lambda: device_buffer.get_read(),
        lambda: list(device_buffer.get_write()),
        lambda: device_buffer.get_update(),
        lambda: device_buffer.update_data(Message.decode(b'\x03\x15\x02\x01\x02\x17')),
        lambda: device_buffer.set_subscription(DeviceUID(0, 0, 0), []),
        lambda: device_buffer.last_update,
        lambda: device_buffer.last_write,
        lambda: device_buffer.uid,
        lambda: device_buffer.subscription,
    ]
    for action in actions:
        with pytest.raises(RuntimeBufferError):
            action()
    device_buffer.set_valid(True)
    for action in actions:
        action()


def test_shm_attach_fail(device_buffer_type):
    with pytest.raises(RuntimeBufferError):
        with device_buffer_type.open('test-device', create=False):
            pass


def test_shm_create_attach(device_buffer_type, peer):
    for create in (True, False):
        with device_buffer_type.open('test-device', create=create) as device_buffer:
            assert device_buffer.write.id == 0xc0debeef
            assert device_buffer.get_value('duty_cycle') == pytest.approx(-0.123)


def test_lowerbound_exceeded(device_buffer):
    with warnings.catch_warnings(record=True) as capture:
        device_buffer.set_value('pos', -1)
    assert device_buffer.write.pos == pytest.approx(-1)
    assert len(capture) == 0
    with warnings.catch_warnings(record=True) as capture:
        device_buffer.set_value('pos', -1.01)
    assert device_buffer.write.pos == pytest.approx(-1)
    assert len(capture) == 1


def test_upperbound_exceeded(device_buffer):
    with warnings.catch_warnings(record=True) as capture:
        device_buffer.set_value('pos', 1)
    assert device_buffer.write.pos == pytest.approx(1)
    assert len(capture) == 0
    with warnings.catch_warnings(record=True) as capture:
        device_buffer.set_value('pos', 1.01)
    assert device_buffer.write.pos == pytest.approx(1)
    assert len(capture) == 1
