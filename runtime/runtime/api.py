"""Student API for controlling the robot.

The student provides a single Python file containing a minimum of four functions:

    >>> def autonomous_setup():
    ...     ...
    >>> def autonomous_main():
    ...     ...
    >>> def teleop_setup():
    ...     ...
    >>> def teleop_main():
    ...     ...

The ``*_setup`` functions---``autonomous_setup`` and ``teleop_setup``---run once at the
start of the autonomous and teleop phases, respectively. After the setup function runs,
the corresponding ``*_main`` functions run periodically until the end of the phase. The
frequency of ``main`` calls is configurable, but the default interval is 0.1s.

These interfaces are largely thin wrappers around :class:`runtime.buffer.BufferStore`.
"""

import abc
import asyncio
import enum
import functools
import time
from dataclasses import dataclass, field
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

from . import log
from .buffer import Buffer, BufferKey, BufferStore, DeviceBufferError

__all__ = [
    'Actions',
    'Alliance',
    'BufferAPI',
    'Field',
    'Gamepad',
    'Robot',
    'StudentAPI',
    'safe',
]

Action = Callable[..., Awaitable[None]]


@enum.unique
class Alliance(enum.IntEnum):
    """The alliances that compete in a match.

    Attributes:
        BLUE: The blue alliance.
        GOLD: The gold alliance.
    """

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

    In this example, the robot's servo rotates 45 degrees counterclockwise from the
    motor's center, waits one second, and then rotates 90 degrees clockwise. Actions are
    useful for triggering time-sensitive events outside the ``autonomous_main`` or
    ``teleop_main`` functions, which fire at a fixed frequency.

    To schedule an action to run, call :meth:`Actions.run` on the action's name from one
    of the regular ``*_setup`` or ``*_main`` functions, like so:

        >>> def autonomous_setup():
        ...     Actions.run(wave_hand)  # Correct
        ...     wave_hand()             # Incorrect: will not run

    Do not call an action like you would call a regular function.
    """

    @staticmethod
    async def sleep(duration: float, /) -> None:
        """Pause the current action for some amount of time.

        Parameters:
            duration: The number of seconds to wait for. Must be a nonnegative number.

        Note:
            Remember to use the ``await`` keyword before :meth:`Actions.sleep`.
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
        """Schedule an action to run outside of the ``*_main`` functions.

        Parameters:
            action: An action (coroutine function).
            args: Positional arguments to pass to the action.
            timeout: Maximum number of seconds the action should be allowed to run for.
                Must be a nonnegative number.
            periodic: Whether to run the action repeatedly or not. A periodic action
                that completes before the timeout has elapsed is not rescheduled early.
        """

    @abc.abstractmethod
    def is_running(self, action: Action, /) -> Optional[bool]:
        """Check whether an action is already running.

        Parameters:
            action: An action (coroutine function).
        """


@dataclass
class BufferAPI(StudentAPI):
    """Base type for all APIs that access shared memory buffers.

    Parameters:
        buffers: Buffer store.
        logger: Synchronous bound logger.
    """

    buffers: BufferStore
    logger: log.Logger

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
    """A decorator that wraps API methods to catch and log any exceptions.

    Parameters:
        method: API method to be wrapped.

    Returns:
        The method wrapper. If the wrapped method raises an :class:`Exception`, the
        wrapper's return value will be :data:`None`. :class:`BaseException` is too broad
        to catch.
    """

    @functools.wraps(method)
    def wrapper(self: BufferAPI, /, *args: Any, **kwargs: Any) -> Optional[RT]:
        try:
            return method(self, *args, **kwargs)
        except Exception as exc:  # pylint: disable=broad-except; student-facing method
            self.logger.error(f'{method.__name__}(...) raised an error', exc_info=exc)
            return None

    return wrapper


@dataclass
class Robot(BufferAPI):
    """API for accessing Smart Devices.

    Parameters:
        names: A mapping from human-readable device names (aliases) to UIDs that
            students can configure.
    """

    names: Mapping[str, int] = field(default_factory=dict)

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
        """Get a Smart Device parameter.

        Parameters:
            uid: Either a UID as an integer or a device name to be resolved into a UID.
            param: Parameter name.

        Returns:
            The current parameter value. Because written parameters take time to
            propogate to the device and the device must send an acknowledgement, the
            current value may not immediately reflect a written value.
        """
        return self._get(self._translate_uid(uid), param)

    @safe
    def write(self, uid: Union[str, int], param: str, value: Any, /) -> None:
        """Write a Smart Device parameter.

        Parameters:
            uid: Either a UID as an integer or a device name to be resolved into a UID.
            param: Parameter name.
            value: New parameter value.
        """
        self.buffers[self._translate_uid(uid)].write(param, value)


@dataclass
class Gamepad(BufferAPI):
    """API for reading game controller inputs.

    Parameters:
        enabled: Whether gamepads are enabled. In autonomous mode, this parameter should
            be set to :data:`False`.
    """

    enabled: bool = True

    TYPE_NAME: ClassVar[str] = 'gamepad'

    @safe
    def get(self, param: str, index: int = 0, /) -> Any:
        """Get a gamepad parameter.

        Attempting to access a gamepad while it is disabled will emit a warning but
        will still return a type-safe default value.

        Parameters:
            param: Parameter name.
            index: Gamepad identifier (a nonnegative integer).
        """
        if not self.enabled:
            default = self._get_default(self.TYPE_NAME, param)
            self.logger.error(
                'Gamepad is not enabled in autonomous',
                param=param,
                index=index,
            )
            return default
        return self._get((self.TYPE_NAME, index), param)


@dataclass
class Field(BufferAPI):
    """API for interacting with the field and other robots.

    Parameters:
        start: The UNIX timestamp (in seconds) of the start of the current
            autonomous/teleop phase.
    """

    start: float = field(default_factory=time.time)

    @property
    def _buffer(self, /) -> Buffer:
        return self.buffers['field', 0]

    @property  # type: ignore[misc]
    @safe
    def alliance(self, /) -> Alliance:
        """The alliance this robot is a member of in this match."""
        return Alliance(self._buffer.alliance)

    def clock(self, /) -> float:
        """The number of seconds since autonomus or teleop started."""
        return time.time() - self.start

    @safe
    def send(self, obj: Any, /) -> None:
        """Send a message to an allied robot."""
        ...  # TODO

    @safe
    def recv(self, /) -> Any:
        """Receive a message from an allied robot."""
        ...  # TODO


class StudentCodeModule(Protocol):
    """The API symbols made available to the student code module.

    Note:
        The :func:`print` function should also be listed, but Mypy does not yet support
        replacing callables: https://github.com/python/mypy/issues/708
    """

    Alliance: type[Alliance] = Alliance
    Actions: Actions
    Robot: Robot
    Gamepad: Gamepad
    Field: Field
