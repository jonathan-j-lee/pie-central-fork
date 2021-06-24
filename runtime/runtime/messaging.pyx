# distutils: language=c++

"""Smart Device messaging.

This library provides low-level bindings for building :class:`Message` objects and
encoding them to or decoding them from a binary format. This module's API adheres
closely to that of the underlying native C++ code and manipulates parameters using
bitmaps and memory. To generate or digest messages at a higher level (for example, using
parameter names), use :class:`runtime.buffer.DeviceBuffer`.
"""

import functools

cimport cython
from libc.stdint cimport uint64_t
from libcpp cimport bool

from .exception import RuntimeBaseException

__all__ = [
    'MessageError',
    'MessageType',
    'Message',
    'ErrorCode',
    'ParameterMap',
]


class MessageError(RuntimeBaseException):
    """General message error."""


def message_factory(wrapped, msg_type):
    @functools.wraps(wrapped)
    def wrapper(*args, **kwargs):
        msg = Message()
        if not wrapped(msg, *args, **kwargs):
            raise MessageError(
                'failed to make Smart Device message',
                type=MessageType(msg_type).name,
            )
        return msg
    return wrapper


@cython.freelist(16)
@cython.final
cdef class ParameterMap:
    """A map of parameters in memory.

    This object is used by :class:`Message` to determine where and how many bytes should
    be written to or read from for each parameter.
    """
    cdef _Parameter params[MAX_PARAMETERS]

    def __cinit__(self):
        for index in range(MAX_PARAMETERS):
            self.clear_param(index)

    cdef void check_index(self, size_t index):
        if index >= MAX_PARAMETERS:
            raise MessageError('parameter index out of bounds', index=index)

    def set_param(self, size_t index, uint64_t base, size_t size):
        """Set the address and size of a parameter.

        Parameters:
            index (int): The parameter ID between 0 (inclusive) and
                :attr:`Message.MAX_PARAMS` (exclusive).
            base (int): The address of the parameter in memory.
            size (int): The size of the parameter in bytes.

        Raises:
            MessageError: If the index is out of bounds.

        Warning:
            Since this method accepts addresses that a :class:`Message` will eventually
            dereference, a bad address may cause a segfault. Use with caution.
        """
        self.check_index(index)
        self.params[index].base = <void *> base
        self.params[index].size = size

    def clear_param(self, size_t index):
        """Clear an existing parameter."""
        self.check_index(index)
        self.params[index].base = NULL
        self.params[index].size = 0


@cython.freelist(16)
@cython.final
cdef class Message:
    """A Smart Device message.

    The :func:`len` of a message is the length of its payload in bytes.
    """
    # Combining decorators in Cython is broken. The order in which they are applied is
    # not respected: https://github.com/cython/cython/issues/1434
    # Therefore, we avoid ``@decorator`` syntax for the ``make_*`` family of methods.

    MAX_PARAMS = MAX_PARAMETERS
    MAX_SIZE = MESSAGE_MAX_SIZE
    MAX_ENCODING_SIZE = ENCODING_MAX_SIZE
    DELIM = bytes([DELIMETER])
    NO_PARAMS = NO_PARAMETERS
    ALL_PARAMS = ALL_PARAMETERS
    cdef _Message buf

    @property
    def type(self):
        """MessageType: The type of this message."""
        return MessageType(self.buf.get_type())

    def __str__(self):
        return f'{self.__class__.__name__}({self.type.name}, {len(self)})'

    def __len__(self):
        return self.buf.get_payload_length()

    cpdef bool verify_checksum(self):
        """Determine whether the claimed checksum of the payload is valid.

        Returns:
            bool: :data:`True` if the checksum is valid, :data:`False` otherwise.
        """
        return self.buf.verify_checksum()

    @staticmethod
    def decode(const byte[::1] buf not None):
        """Decode a raw binary buffer, as it is transported on the wire.

        Parameters:
            buf: An object that implements Python's writeable buffer protocol.

        Returns:
            Message: A message containing the parsed data.

        Raises:
            MessageError: If the message was not able to be decoded.
        """
        msg = Message()
        cdef ErrorCode status = msg.buf.decode(&buf[0], buf.shape[0])
        if status is not ErrorCode.OK:
            raise MessageError(
                'failed to decode Smart Device message',
                status=ErrorCode(status).name,
            )
        return msg

    cpdef size_t encode_into_buf(self, byte[::1] buf):
        """Encode this message into an existing buffer.

        Parameters:
            buf: A object that implements Python's writeable buffer protocol.

        Returns:
            int: The number of bytes used, which may be less than the length of ``buf``.

        Raises:
            MessageError: If the message was not able to be encoded.
        """
        cdef size_t out_len
        cdef ErrorCode status = self.buf.encode(&buf[0], buf.shape[0], &out_len)
        if status is not ErrorCode.OK:
            raise MessageError(
                'failed to encode Smart Device message',
                status=ErrorCode(status).name,
            )
        return out_len

    def encode(self):
        """Encode this message into a newly allocated buffer.

        Returns:
            bytearray: The encoded message, ready to be put on the wire.

        Raises:
            MessageError: If the message was not able to be encoded.
        """
        output = bytearray(ENCODING_MAX_SIZE)
        return output[:self.encode_into_buf(output)]

    def make_ping(Message msg not None):
        """Make a :attr:`MessageType.PING` message.

        Returns:
            Message: A Smart Device message.
        """
        return msg.buf.make_ping()
    make_ping = staticmethod(message_factory(make_ping, MessageType.PING))

    def make_sub_req(Message msg not None, param_map_t params, interval_t interval):
        """Make a :attr:`MessageType.SUB_REQ` message.

        Parameters:
            params (int): A bitmap of parameters to subscribe to.
            interval (int): The delay between updates in milliseconds.

        Returns:
            Message: A Smart Device message.
        """
        return msg.buf.make_sub_req(params, interval)
    make_sub_req = staticmethod(message_factory(make_sub_req, MessageType.SUB_REQ))

    def make_sub_res(Message msg not None, param_map_t params, interval_t interval,
                     device_id_t device_id, uint8_t year, uint64_t random):
        """Make a :attr:`MessageType.SUB_RES` message.

        Parameters:
            params (int): A bitmap of parameters subscribed to.
            interval (int): The delay between updates in milliseconds.
            device_id (int): The device type identifier.
            year (int): A number identifier the year the device was manufactured.
            random (int): Random bits for uniqueness.

        Returns:
            Message: A Smart Device message.
        """
        cdef _DeviceUID _uid
        _uid.device_id, _uid.year, _uid.random = device_id, year, random
        return msg.buf.make_sub_res(params, interval, &_uid)
    make_sub_res = staticmethod(message_factory(make_sub_res, MessageType.SUB_RES))

    def make_dev_read(Message msg not None, param_map_t params):
        """Make a :attr:`MessageType.DEV_READ` message.

        Parameters:
            params (int): A bitmap of parameters to read.

        Returns:
            Message: A Smart Device message.
        """
        return msg.buf.make_dev_read(params)
    make_dev_read = staticmethod(message_factory(make_dev_read, MessageType.DEV_READ))

    def make_dev_write(Message msg not None, param_map_t params,
                       ParameterMap param_map not None):
        """Make a :attr:`MessageType.DEV_WRITE` message.

        Parameters:
            params (int): A bitmap of parameters to write.
            param_map (ParameterMap): A parameter map specifying where in memory the
                parameter values should be read from.

        Returns:
            Message: A Smart Device message.
        """
        return msg.buf.make_dev_write(params, param_map.params)
    make_dev_write = staticmethod(message_factory(make_dev_write, MessageType.DEV_WRITE))

    def make_dev_data(Message msg not None, param_map_t params,
                      ParameterMap param_map not None):
        """Make a :attr:`MessageType.DEV_DATA` message.

        Parameters:
            params (int): A bitmap of parameters to write.
            param_map (ParameterMap): A parameter map specifying where in memory the
                parameter values should be read from.

        Returns:
            Message: A Smart Device message.
        """
        return msg.buf.make_dev_data(params, param_map.params)
    make_dev_data = staticmethod(message_factory(make_dev_data, MessageType.DEV_WRITE))

    def make_dev_disable(Message msg not None):
        """Make a :attr:`MessageType.DEV_DISABLE` message.

        Returns:
            Message: A Smart Device message.
        """
        return msg.buf.make_dev_disable()
    make_dev_disable = staticmethod(message_factory(make_dev_disable, MessageType.DEV_DISABLE))

    def make_hb_req(Message msg not None, heartbeat_id_t hb_id):
        """Make a :attr:`MessageType.HB_REQ` message.

        Parameters:
            hb_id (int): A heartbeat identifier.

        Returns:
            Message: A Smart Device message.
        """
        return msg.buf.make_hb_req(hb_id)
    make_hb_req = staticmethod(message_factory(make_hb_req, MessageType.HB_REQ))

    def make_hb_res(Message msg not None, heartbeat_id_t hb_id):
        """Make a :attr:`MessageType.HB_RES` message.

        Parameters:
            hb_id (int): A heartbeat identifier matching that of its corresponding
                heartbeat request.

        Returns:
            Message: A Smart Device message.
        """
        return msg.buf.make_hb_res(hb_id)
    make_hb_res = staticmethod(message_factory(make_hb_res, MessageType.HB_RES))

    def make_error(Message msg not None, ErrorCode error):
        """Make a :attr:`MessageType.ERROR` message.

        Parameters:
            error (ErrorCode): An error code.

        Returns:
            Message: A Smart Device message.
        """
        return msg.buf.make_error(error)
    make_error = staticmethod(message_factory(make_error, MessageType.ERROR))

    @classmethod
    def make_unsubscribe(cls):
        """Make a message to unsubscribe from all parameters.

        Returns:
            Message: A :attr:`MessageType.SUB_REQ` message.
        """
        return cls.make_sub_req(NO_PARAMETERS, NO_SUBSCRIPTION)

    def _check_read(self, bool status, MessageType msg_type):
        if not status:
            raise MessageError(
                'failed to read Smart Device message',
                type=MessageType(msg_type).name,
            )

    def read_sub_req(self):
        """Read the fields of a :attr:`MessageType.SUB_REQ` message.

        Returns:
            tuple[int, int]: The parameters to subscribe to (as a bitmap) and the
            requested delay in milliseconds.
        """
        cdef param_map_t params = NO_PARAMETERS
        cdef interval_t interval = NO_SUBSCRIPTION
        self._check_read(self.buf.read_sub_req(&params, &interval), MessageType.SUB_REQ)
        return params, interval

    def read_sub_res(self):
        """Read the fields of a :attr:`MessageType.SUB_RES` message.

        Returns:
            tuple[int, int, tuple[int, int, int]]: The parameters subscribed to as a
            bitmap, the delay in milliseconds, and the device's UID components (device
            ID, year, random bits).
        """
        cdef param_map_t params = NO_PARAMETERS
        cdef interval_t interval = NO_SUBSCRIPTION
        cdef _DeviceUID _uid
        _uid.device_id = 0
        _uid.year = 0
        _uid.random = 0
        self._check_read(self.buf.read_sub_res(&params, &interval, &_uid), MessageType.SUB_RES)
        return params, interval, (_uid.device_id, _uid.year, _uid.random)

    def read_dev_read(self):
        """Read the parameter values of a :attr:`MessageType.DEV_READ` message.

        Returns:
            int: A bitmap of the parameters contained.
        """
        cdef param_map_t params = NO_PARAMETERS
        self._check_read(self.buf.read_dev_read(&params), MessageType.DEV_READ)
        return params

    def read_dev_write(self, ParameterMap param_map not None):
        """Read the parameter values of a :attr:`MessageType.DEV_WRITE` message.

        Parameters:
            param_map (ParameterMap): A parameter map specifying the addresses to write
                the values to.

        Returns:
            int: A bitmap of the parameters read.
        """
        cdef param_map_t params = NO_PARAMETERS
        self._check_read(self.buf.read_dev_write(&params, param_map.params), MessageType.DEV_WRITE)
        return params

    def read_dev_data(self, ParameterMap param_map not None):
        """Read the parameter values of a :attr:`MessageType.DEV_DATA` message.

        Parameters:
            param_map (ParameterMap): A parameter map specifying the addresses to write
                the values to.

        Returns:
            int: A bitmap of the parameters read.
        """
        cdef param_map_t params = NO_PARAMETERS
        self._check_read(self.buf.read_dev_data(&params, param_map.params), MessageType.DEV_DATA)
        return params

    def read_hb_req(self):
        """Read the heartbeat identifier of a :attr:`MessageType.HB_REQ` message.

        Returns:
            int: The heartbeat ID.
        """
        cdef heartbeat_id_t hb_id = 0
        self._check_read(self.buf.read_hb_req(&hb_id), MessageType.HB_REQ)
        return hb_id

    def read_hb_res(self):
        """Read the heartbeat identifier of a :attr:`MessageType.HB_RES` message.

        Returns:
            int: The heartbeat ID.
        """
        cdef heartbeat_id_t hb_id = 0
        self._check_read(self.buf.read_hb_res(&hb_id), MessageType.HB_RES)
        return hb_id

    def read_error(self):
        """Read the error code of a :attr:`MessageType.ERROR` message.

        Returns:
            ErrorCode: The error code.
        """
        cdef ErrorCode error = ErrorCode.OK
        self._check_read(self.buf.read_error(&error), MessageType.ERROR)
        return ErrorCode(error)
