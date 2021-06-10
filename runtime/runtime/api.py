"""Student API.

Most of these interfaces are just thin wrappers around :class:`runtime.buffer.BufferManager`.
"""

import abc
import asyncio
import dataclasses
import enum
import time
from typing import Any, Awaitable, Callable, Protocol, Union

import structlog

from .buffer import Buffer, BufferManager

__all__ = ['Alliance', 'Actions', 'Robot', 'Gamepad', 'Field']
Action = Callable[[], Awaitable[None]]  # For example, a no-argument coroutine function


@enum.unique
class Alliance(enum.IntEnum):
    """The alliances that compete in a match."""

    BLUE = 0
    GOLD = 1


class StudentAPI(abc.ABC):
    """Base type for all student-callable interfaces."""

    logger = structlog.get_logger(wrapper_class=structlog.stdlib.BoundLogger)


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
    def is_running(self, action: Action, /) -> bool:
        """Check whether an action is already running."""


@dataclasses.dataclass
class DeviceAPI(StudentAPI):
    """Base type for all APIs that access shared memory buffers."""

    buffers: BufferManager


class Robot(DeviceAPI):
    """API for interacting with Smart Devices."""

    def get(self, uid: Union[str, int], param: str, /) -> Any:
        return self.buffers[int(uid)].get(param)

    def write(self, uid: Union[str, int], param: str, value: Any, /) -> None:
        self.buffers[int(uid)].write(param, value)

    # Legacy API method aliases.
    get_value = get
    set_value = write


class Gamepad(DeviceAPI):
    def get(self, param: str, index: int = 0, /) -> Any:
        return self.buffers['gamepad', index].get(param)

    # Legacy API method aliases.
    get_value = get


@dataclasses.dataclass
class Field(DeviceAPI):
    """API for interacting with the field and other robots."""

    start: float = dataclasses.field(default_factory=time.time)

    @property
    def _buffer(self, /) -> Buffer:
        return self.buffers['field', 0]

    @property
    def alliance(self, /) -> Alliance:
        """The alliance this robot is a member of in this match."""
        return Alliance(self._buffer.alliance)

    @property
    def clock(self, /) -> float:
        """The number of seconds since the current match phase (autonomus/teleop) started."""
        return time.time() - self.start

    def send(self, obj: Any, /) -> None:
        pass  # TODO

    def recv(self, /) -> Any:
        pass  # TODO


class StudentCodeModule(Protocol):
    Alliance: type[Alliance] = Alliance
    Actions: Actions
    Robot: Robot
    Gamepad: Gamepad
    Field: Field
    # The ``print`` function is not listed here because Mypy does not yet support replacing
    # callables: https://github.com/python/mypy/issues/708
