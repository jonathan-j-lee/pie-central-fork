import enum
from typing import ByteString, Sized, Union

from .exception import RuntimeBaseException

class MessageError(RuntimeBaseException): ...

class MessageType(enum.IntEnum):
    PING = ...
    SUB_REQ = ...
    SUB_RES = ...
    DEV_READ = ...
    DEV_WRITE = ...
    DEV_DATA = ...
    DEV_DISABLE = ...
    HB_REQ = ...
    HB_RES = ...
    ERROR = ...

class ErrorCode(enum.IntEnum):
    OK = ...
    BACKOFF = ...
    INVALID_TYPE = ...
    BUFFER_OVERFLOW = ...
    UNEXPECTED_DELIMETER = ...
    BAD_CHECKSUM = ...
    GENERIC_ERROR = ...

class ParameterMap:
    def set_param(self, index: int, base: int, size: int) -> None: ...
    def clear_param(self, index: int) -> None: ...

class Message:
    MAX_PARAMS: int
    MAX_SIZE: int
    MAX_ENCODING_SIZE: int
    DELIM: bytes
    NO_PARAMS: int
    ALL_PARAMS: int
    @property
    def type(self) -> MessageType: ...
    def __len__(self) -> int: ...
    def encode_into_buf(self, buf: Union[bytearray, memoryview]) -> int:
        pass
    def encode(self) -> bytearray:
        pass
    @staticmethod
    def decode(buf: ByteString) -> Message: ...
    @staticmethod
    def make_ping() -> Message: ...
    @staticmethod
    def make_sub_req(params: int, interval: int) -> Message: ...
    @staticmethod
    def make_sub_res(
        params: int,
        interval: int,
        device_id: int,
        year: int,
        random: int,
    ) -> Message: ...
    @staticmethod
    def make_dev_read(params: int) -> Message: ...
    @staticmethod
    def make_dev_write(params: int, param_map: ParameterMap) -> Message: ...
    @staticmethod
    def make_dev_data(params: int, param_map: ParameterMap) -> Message: ...
    @staticmethod
    def make_dev_disable() -> Message: ...
    @staticmethod
    def make_hb_req(hb_id: int) -> Message: ...
    @staticmethod
    def make_hb_res(hb_id: int) -> Message: ...
    @staticmethod
    def make_error(error_code: Union[int, ErrorCode]) -> Message: ...
    @staticmethod
    def make_unsubscribe() -> Message: ...
    def read_sub_req(self) -> tuple[int, int]: ...
    def read_sub_res(self) -> tuple[int, int, tuple[int, int, int]]: ...
    def read_dev_read(self) -> int: ...
    def read_dev_write(self, param_map: ParameterMap) -> int: ...
    def read_dev_data(self, param_map: ParameterMap) -> int: ...
    def read_hb_req(self) -> int: ...
    def read_hb_res(self) -> int: ...
    def read_error(self) -> ErrorCode: ...
