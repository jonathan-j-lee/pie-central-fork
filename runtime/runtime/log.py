"""Runtime Logging."""

import asyncio
import collections.abc
import contextlib
import dataclasses
import functools
import logging
import typing
from typing import Any, Callable, Literal, NoReturn, Optional, Union

import orjson as json
import structlog
import structlog.processors
import structlog.stdlib

from . import rpc
from .exception import RuntimeBaseException
from .rpc import get_logger

__all__ = ['get_logger', 'get_null_logger', 'LogPublisher', 'configure']


Event = collections.abc.MutableMapping[str, Any]
ProcessorReturnType = Union[Event, str, bytes]
Processor = Callable[[Any, str, Event], ProcessorReturnType]


def drop(_logger: structlog.stdlib.AsyncBoundLogger, _method: str, _event: Event, /) -> NoReturn:
    """A simple :mod:`structlog` processor to drop all events."""
    raise structlog.DropEvent


def get_null_logger() -> structlog.stdlib.AsyncBoundLogger:
    """Make a logger that drops all events."""
    logger = structlog.get_logger(
        processors=[drop],
        wrapper_class=structlog.stdlib.AsyncBoundLogger,
    )
    return typing.cast(structlog.stdlib.AsyncBoundLogger, logger)


@dataclasses.dataclass
class LogPublisher(rpc.Client):
    """An RPC client for publishing log records over the network."""

    send_queue: asyncio.Queue[tuple[str, Event]] = dataclasses.field(
        default_factory=lambda: asyncio.Queue(512)
    )
    loop: asyncio.AbstractEventLoop = dataclasses.field(default_factory=asyncio.get_running_loop)

    def __post_init__(self) -> None:
        super().__post_init__()
        self.logger = get_null_logger()

    def __call__(
        self,
        logger: structlog.stdlib.AsyncBoundLogger,
        method: str,
        event: Event,
        /,
    ) -> Event:
        self.loop.call_soon_threadsafe(self.send_queue.put_nowait, (method, dict(event)))
        return event

    async def __aenter__(self) -> 'LogPublisher':
        result = await super().__aenter__()
        worker = asyncio.create_task(self._send_forever(), name='send')
        self.stack.callback(worker.cancel)
        return result

    async def _send_forever(self) -> NoReturn:
        while True:
            method, event = await self.send_queue.get()
            with contextlib.suppress(asyncio.TimeoutError):
                await self.call[method](event, notification=True)


@functools.lru_cache(maxsize=16)
def get_level_num(level_name: str, default: int = logging.DEBUG) -> int:
    """Translate a :mod:`logging` level name into its numeric value.

    Arguments:
        level_name: Such as ``'DEBUG'``,
        default: The level to return if the name is invalid.

    Example:
        >>> get_level_num('INFO')
        20
        >>> assert get_level_num('DNE', default=logging.ERROR) == logging.ERROR
    """
    level = getattr(logging, level_name.upper(), None)
    return level if isinstance(level, int) else default


def filter_by_level(level: str) -> Processor:
    """Build a :mod:`structlog` processor to filter events by log level (severity)."""
    min_level = get_level_num(level)

    def processor(
        _logger: structlog.stdlib.AsyncBoundLogger,
        method: str,
        event: ProcessorReturnType,
        /,
    ) -> ProcessorReturnType:
        if get_level_num(method) < min_level:
            raise structlog.DropEvent
        return event

    return processor


def add_exception_context(
    _logger: structlog.stdlib.AsyncBoundLogger,
    _method: str,
    event: Event,
    /,
) -> Event:
    """A processor to add the context of a :class:`RuntimeBaseException` to the event's context.

    The event context's entries take priority over those of the exception.
    """
    exception = event.get('exc_info')
    if isinstance(exception, RuntimeBaseException):
        event = exception.context | event
    return event


def configure(
    publisher: Optional[LogPublisher] = None,
    fmt: Literal['json', 'pretty'] = 'json',
    level: str = 'INFO',
) -> None:
    """Configure :mod:`structlog` with the desired log format and filtering."""
    logging.captureWarnings(True)
    renderers: list[Processor] = [publisher] if publisher else []
    logger_factory: Callable[..., Union[structlog.PrintLogger, structlog.BytesLogger]]
    if fmt == 'pretty':
        renderers.append(structlog.processors.ExceptionPrettyPrinter())
        renderers.append(structlog.dev.ConsoleRenderer(pad_event=40))
        logger_factory = structlog.PrintLoggerFactory()
    else:
        renderers.append(
            structlog.processors.JSONRenderer(serializer=json.dumps),
        )
        logger_factory = structlog.BytesLoggerFactory()

    structlog.configure(
        cache_logger_on_first_use=True,
        wrapper_class=structlog.stdlib.AsyncBoundLogger,
        processors=[
            structlog.threadlocal.merge_threadlocal_context,
            structlog.processors.add_log_level,
            add_exception_context,
            filter_by_level(level),
            structlog.processors.format_exc_info,
            structlog.processors.TimeStamper(fmt='iso'),
            *renderers,
        ],
        logger_factory=logger_factory,
    )
