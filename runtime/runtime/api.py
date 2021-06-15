"""Student API.

Most of these interfaces are just thin wrappers around :class:`runtime.buffer.BufferManager`.
"""

import abc
import asyncio
import dataclasses
import enum
import functools
import time
from typing import (
    Any,
    Awaitable,
    Callable,
    ClassVar,
    Mapping,
    Optional,
    Protocol,
    TypeVar,
    Union,
)

import structlog

from .buffer import Buffer, BufferKey, BufferManager, DeviceBufferError

__all__ = ['safe', 'Alliance', 'Actions', 'Robot', 'Gamepad', 'Field']
Action = Callable[[], Awaitable[None]]  # For example, a no-argument coroutine function


@enum.unique
class Alliance(enum.IntEnum):
    """The alliances that compete in a match."""

    BLUE = 0
    GOLD = 1


class StudentAPI(abc.ABC):
    """Base type for all student-callable interfaces."""


class Actions(StudentAPI):
    """API for performing asynchronous execution.

    An "action" is a special function defined with the ``async def`` keywords, like so:

        >>> async def wave_hand():
        ...     Robot.set(SERVO_UID, 'servo0', -0.5)
        ...     await Actions.sleep(1)
        ...     Robot.set(SERVO_UID, 'servo0', 0.5)

    In this example, the robot's servo rotates 45 degrees counterclockwise from the motor's center,
    waits one second, and then rotates 90 degrees clockwise. Actions are useful for triggering
    time-sensitive events outside the normal ``autonomous_main`` or ``teleop_main`` functions.
    """

    @staticmethod
    async def sleep(duration: float, /) -> None:
        """Pause the program for some amount of time.

        Arguments:
            duration: The number of seconds to wait for. Must be a nonnegative number.

        Note:
            Remember to use ``await`` before :meth:`Actions.sleep`.
        """
        await asyncio.sleep(duration)

    @abc.abstractmethod
    def run(
        self,
        action: Action,
        /,
        *args: Any,
        timeout: float = 30,
        periodic: bool = False,
    ) -> None:
        """Schedule an action to run outside of the ``*_main`` functions."""

    @abc.abstractmethod
    def is_running(self, action: Action, /) -> Optional[bool]:
        """Check whether an action is already running."""


@dataclasses.dataclass
class DeviceAPI(StudentAPI):
    """Base type for all APIs that access shared memory buffers."""

    buffers: BufferManager
    logger: structlog.stdlib.BoundLogger

    def _get_default(self, type_name: str, param: str) -> Any:
        buf_type = self.buffers.catalog[type_name]
        return buf_type.params[param].default

    def _get(self, key: BufferKey, param: str) -> Any:
        type_name, _ = key = self.buffers.normalize_key(key)
        default = self._get_default(type_name, param)
        context = {'type': type_name, 'param': param, 'default': default}
        try:
            buffer = self.buffers[key]
        except (DeviceBufferError, KeyError) as exc:
            self.logger.warn('Device does not exist', exc_info=exc, **context)
            return default
        try:
            return buffer.get(param)
        except DeviceBufferError as exc:
            self.logger.warn('Unable to get parameter', exc_info=exc, **context)
            return default


RT = TypeVar('RT')


def safe(method: Callable[..., RT]) -> Callable[..., Optional[RT]]:
    @functools.wraps(method)
    def wrapper(self: DeviceAPI, /, *args: Any, **kwargs: Any) -> Optional[RT]:
        try:
            return method(self, *args, **kwargs)
        except Exception as exc:  # pylint: disable=broad-except; student-facing function
            self.logger.error(f'{method.__name__}(...) raised an error', exc_info=exc)
            return None

    return wrapper


@dataclasses.dataclass
class Robot(DeviceAPI):
    """API for interacting with Smart Devices."""

    names: Mapping[str, int] = dataclasses.field(default_factory=dict)

    def _translate_uid(self, uid: Union[str, int]) -> int:
        if isinstance(uid, str):
            uid = self.names.get(uid, uid)
        try:
            return int(uid)
        except ValueError as exc:
            raise DeviceBufferError(
                'UID is neither an integer nor a name',
                names=list(self.names),
            ) from exc

    @safe
    def get(self, uid: Union[str, int], param: str, /) -> Any:
        return self._get(self._translate_uid(uid), param)

    @safe
    def write(self, uid: Union[str, int], param: str, value: Any, /) -> None:
        self.buffers[self._translate_uid(uid)].write(param, value)

    # Legacy API method aliases.
    get_value = get
    set_value = write


@dataclasses.dataclass
class Gamepad(DeviceAPI):
    enabled: bool = True

    TYPE_NAME: ClassVar[str] = 'gamepad'

    @safe
    def get(self, param: str, index: int = 0, /) -> Any:
        if not self.enabled:
            default = self._get_default(self.TYPE_NAME, param)
            self.logger.error('Gamepad is not enabled in autonomous', param=param, index=0)
            return default
        return self._get((self.TYPE_NAME, index), param)

    # Legacy API method aliases.
    get_value = get


@dataclasses.dataclass
class Field(DeviceAPI):
    """API for interacting with the field and other robots."""

    start: float = dataclasses.field(default_factory=time.time)

    @property
    def _buffer(self, /) -> Buffer:
        return self.buffers['field', 0]

    @property  # type: ignore[misc]
    @safe
    def alliance(self, /) -> Alliance:
        """The alliance this robot is a member of in this match."""
        return Alliance(self._buffer.alliance)

    def clock(self, /) -> float:
        """The number of seconds since the current match phase (autonomus/teleop) started."""
        return time.time() - self.start

    @safe
    def send(self, obj: Any, /) -> None:
        ...  # TODO

    @safe
    def recv(self, /) -> Any:
        ...  # TODO


class StudentCodeModule(Protocol):
    Alliance: type[Alliance] = Alliance
    Actions: Actions
    Robot: Robot
    Gamepad: Gamepad
    Field: Field
    # The ``print`` function is not listed here because Mypy does not yet support replacing
    # callables: https://github.com/python/mypy/issues/708
