"""Common Runtime exceptions."""


class RuntimeBaseException(Exception):
    """Base exception for Runtime-specific behavior."""

    def __init__(self, message: str, **context):
        super().__init__(message)
        self.context = context

    def __repr__(self) -> str:
        cls_name, args = self.__class__.__name__, [repr(self.args[0])]
        args.extend(f'{name}={value!r}' for name, value in self.context.items())
        return f'{cls_name}({", ".join(args)})'


class EmergencyStopException(SystemExit):
    """An exception indicating Runtime should stop immediately.

    Do not attempt to restart a subprocess whose exit code is
    :attr:`EmergencyStopException.EXIT_CODE`. Instead, re-raise the exception in the parent
    process."""

    EXIT_CODE = 0xFF

    def __init__(self):
        super().__init__(self.EXIT_CODE)
