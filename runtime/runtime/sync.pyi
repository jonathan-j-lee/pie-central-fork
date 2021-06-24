import contextlib
import types
from typing import Any, Final, Iterator, Optional, Union

from .exception import RuntimeBaseException

class SyncError(RuntimeBaseException):
    def __init__(self, message: str, errno: int, **context: Any) -> None: ...
    @staticmethod
    @contextlib.contextmanager
    def suppress(*errnos: int) -> Iterator[None]: ...

class Mutex:
    SIZE: Final[int]
    def __init__(
        self,
        buf: Optional[Union[bytearray, memoryview]] = ...,
        /,
        *,
        shared: bool = ...,
        recursive: bool = ...,
    ) -> None: ...
    def __enter__(self, /) -> None: ...
    def __exit__(
        self,
        _exc_type: Optional[type[BaseException]],
        _exc: Optional[BaseException],
        _traceback: Optional[types.TracebackType],
        /,
    ) -> Optional[bool]: ...
    def initialize(self, /) -> None: ...
    def destory(self, /) -> None: ...
    def acquire(self, /, *, timeout: Optional[float] = ...) -> None: ...
    def release(self, /) -> None: ...
