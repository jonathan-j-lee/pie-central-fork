"""Common Runtime exceptions."""

from typing import Any

# isort: unique-list
__all__ = ['EmergencyStopException', 'RuntimeBaseException']


class RuntimeBaseException(Exception):
    """Base exception for Runtime business logic.

    Parameters:
        message: A human-readable description of the exception.
        context: Machine-readable data.
    """

    def __init__(self, message: str, /, **context: Any) -> None:
        super().__init__(message)
        self.context = context

    def __repr__(self, /) -> str:
        cls_name, args = self.__class__.__name__, [repr(self.args[0])]
        args.extend(f'{name}={value!r}' for name, value in self.context.items())
        return f'{cls_name}({", ".join(args)})'


class EmergencyStopException(SystemExit):
    """An exception indicating Runtime should stop immediately.

    Do not attempt to restart a subprocess whose exit code is :attr:`EXIT_CODE`.
    Instead, the parent process should re-raise the exception.

    Attributes:
        EXIT_CODE: The process exit code used to represent an emergency stop.
    """

    EXIT_CODE: int = 0xFF

    def __init__(self, /) -> None:
        super().__init__(self.EXIT_CODE)
