# distutils: language=c++

import ctypes
import functools

cimport cython
from libcpp cimport bool
from libc.stdint cimport uint64_t
from .monitoring import RuntimeBaseException

__all__ = [
    'MessageError',
    'MessageType',
    'Message',
    'ErrorCode',
    'ParameterMap',
]


class MessageError(RuntimeBaseException):
    pass


def message_factory(wrapped, MessageType msg_type):
    @functools.wraps(wrapped)
    def wrapper(*args, **kwargs):
        msg = Message()
        if not wrapped(msg, *args, **kwargs):
            raise MessageError('failed to make Smart Device message',
                               type=MessageType(msg_type).name)
        return msg
    return wrapper


@cython.freelist(16)
@cython.final
cdef class ParameterMap:
    cdef _Parameter params[MAX_PARAMETERS]

    def __cinit__(self):
        for index in range(MAX_PARAMETERS):
            self.clear_param(index)

    cdef void check_index(self, size_t index):
        if index >= MAX_PARAMETERS:
            raise MessageError('parameter index out of bounds', index=index)

    def set_param(self, size_t index, const unsigned char[::1] buf):
        self.check_index(index)
        self.params[index].base = <void *>&buf[0]
        self.params[index].size = buf.shape[0]

    def clear_param(self, size_t index):
        self.check_index(index)
        self.params[index].base = NULL
        self.params[index].size = 0


@cython.freelist(16)
@cython.final
cdef class Message:
    """
    Note::
        Evidently, combining decorators in Cython is broken---the order in which
        they are applied is not respected.

        .. https://github.com/cython/cython/issues/1434
    """
    MAX_PARAMS = MAX_PARAMETERS
    MAX_SIZE = MESSAGE_MAX_SIZE
    ENCODE_MAX_SIZE = ENCODING_MAX_SIZE
    cdef _Message buf

    @property
    def type(self) -> MessageType:
        return MessageType(self.buf.get_type())

    def __str__(self) -> str:
        return f'{self.__class__.__name__}({self.type.name}, {len(self)})'

    def __len__(self) -> int:
        return self.buf.get_payload_length()

    cpdef bool verify_checksum(self):
        return self.buf.verify_checksum()

    @staticmethod
    def decode(const byte[::1] buf not None) -> Message:
        msg = Message()
        cdef ErrorCode status = msg.buf.decode(&buf[0], buf.shape[0])
        if status is not ErrorCode.OK:
            raise MessageError('failed to decode Smart Device message', status=ErrorCode(status).name)
        return msg

    cpdef size_t encode_into_buf(self, byte[::1] buf):
        cdef size_t out_len
        cdef ErrorCode status = self.buf.encode(&buf[0], buf.shape[0], &out_len)
        if status is not ErrorCode.OK:
            raise MessageError('failed to encode Smart Device message', status=ErrorCode(status).name)
        return out_len

    def encode(self) -> bytearray:
        output = bytearray(ENCODING_MAX_SIZE)
        return output[:self.encode_into_buf(output)]

    def make_ping(Message msg not None) -> bool:
        return msg.buf.make_ping()
    make_ping = staticmethod(message_factory(make_ping, MessageType.PING))

    def make_sub_req(Message msg not None, param_map_t params, interval_t interval) -> bool:
        return msg.buf.make_sub_req(params, interval)
    make_sub_req = staticmethod(message_factory(make_sub_req, MessageType.SUB_REQ))

    def make_sub_res(Message msg not None, param_map_t params, interval_t interval,
                     device_id_t device_id, uint8_t year, uint64_t random) -> bool:
        cdef _DeviceUID _uid
        _uid.device_id, _uid.year, _uid.random = device_id, year, random
        return msg.buf.make_sub_res(params, interval, &_uid)
    make_sub_res = staticmethod(message_factory(make_sub_res, MessageType.SUB_RES))

    def make_dev_read(Message msg not None, param_map_t params) -> bool:
        return msg.buf.make_dev_read(params)
    make_dev_read = staticmethod(message_factory(make_dev_read, MessageType.DEV_READ))

    def make_dev_write(Message msg not None, param_map_t params,
                       ParameterMap param_map not None) -> bool:
        return msg.buf.make_dev_write(params, param_map.params)
    make_dev_write = staticmethod(message_factory(make_dev_write, MessageType.DEV_WRITE))

    def make_dev_data(Message msg not None, param_map_t params,
                      ParameterMap param_map not None) -> bool:
        return msg.buf.make_dev_data(params, param_map.params)
    make_dev_data = staticmethod(message_factory(make_dev_data, MessageType.DEV_WRITE))

    def make_dev_disable(Message msg not None) -> bool:
        return msg.buf.make_dev_disable()
    make_dev_disable = staticmethod(message_factory(make_dev_disable, MessageType.DEV_DISABLE))

    def make_hb_req(Message msg not None, heartbeat_id_t hb_id) -> bool:
        return msg.buf.make_hb_req(hb_id)
    make_hb_req = staticmethod(message_factory(make_hb_req, MessageType.HB_REQ))

    def make_hb_res(Message msg not None, heartbeat_id_t hb_id) -> bool:
        return msg.buf.make_hb_res(hb_id)
    make_hb_res = staticmethod(message_factory(make_hb_res, MessageType.HB_RES))

    def make_error(Message msg not None, ErrorCode error) -> bool:
        return msg.buf.make_error(error)
    make_error = staticmethod(message_factory(make_error, MessageType.ERROR))

    cdef void check_read(self, bool status, MessageType msg_type):
        if not status:
            raise MessageError('failed to read Smart Device message',
                               type=MessageType(msg_type).name)

    def read_sub_req(self) -> tuple[int, int]:
        cdef param_map_t params = NO_PARAMETERS
        cdef interval_t interval = NO_SUBSCRIPTION
        self.check_read(self.buf.read_sub_req(&params, &interval), MessageType.SUB_REQ)
        return params, interval

    def read_sub_res(self) -> tuple[int, int, tuple[int, int, int]]:
        cdef param_map_t params = NO_PARAMETERS
        cdef interval_t interval = NO_SUBSCRIPTION
        cdef _DeviceUID _uid
        _uid.device_id = 0
        _uid.year = 0
        _uid.random = 0
        self.check_read(self.buf.read_sub_res(&params, &interval, &_uid), MessageType.SUB_RES)
        return params, interval, (_uid.device_id, _uid.year, _uid.random)

    def read_dev_read(self) -> int:
        cdef param_map_t params = NO_PARAMETERS
        self.check_read(self.buf.read_dev_read(&params), MessageType.DEV_READ)
        return params

    def read_dev_write(self, ParameterMap param_map not None) -> int:
        cdef param_map_t params = NO_PARAMETERS
        self.check_read(self.buf.read_dev_write(&params, param_map.params), MessageType.DEV_WRITE)
        return params

    def read_dev_data(self, ParameterMap param_map not None) -> int:
        cdef param_map_t params = NO_PARAMETERS
        self.check_read(self.buf.read_dev_data(&params, param_map.params), MessageType.DEV_DATA)
        return params

    def read_hb_req(self) -> int:
        cdef heartbeat_id_t hb_id = 0
        self.check_read(self.buf.read_hb_req(&hb_id), MessageType.HB_REQ)
        return hb_id

    def read_hb_res(self) -> int:
        cdef heartbeat_id_t hb_id = 0
        self.check_read(self.buf.read_hb_res(&hb_id), MessageType.HB_RES)
        return hb_id

    def read_error(self) -> ErrorCode:
        cdef ErrorCode error = ErrorCode.OK
        self.check_read(self.buf.read_error(&error), MessageType.ERROR)
        return error
