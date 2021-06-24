"""Logging configuration.

This module largely wraps the :mod:`structlog` framework to provide flexible structured
logging for Runtime services. A chain of "processors" (callables) filters or transforms
events produced by log statements.

To the greatest extent possible, this module favors native :mod:`structlog`
functionality over integration with the standard :mod:`logging` module for `performance
reasons <https://www.structlog.org/en/stable/performance.html>`_. :mod:`structlog` also
provides an async interface that :mod:`logging` does not.


Note:
    :mod:`structlog` also has a notion of *bound* and *unbound* loggers. An *unbound*
    logger is a proxy that borrows its configuration from the global configuration set
    by :func:`runtime.log.configure`. Once a logger is bound by calling
    :meth:`structlog.BoundLogggerBase.bind`, the global configuration is copied into the
    logger's local state and frozen. Further changes in the global configuration no
    longer affect the bound logger.

    Because unbound loggers are proxies that perform some introspection on every call,
    prefer bound loggers, which are much more performant because their methods are
    concrete.
"""

import asyncio
import contextlib
import functools
import logging
from dataclasses import dataclass, field
from typing import Any, Callable, Literal, MutableMapping, NoReturn, Optional, Union

import orjson as json
import structlog
import structlog.processors
from structlog.stdlib import AsyncBoundLogger as AsyncLogger
from structlog.stdlib import BoundLogger as Logger

from . import remote
from .exception import RuntimeBaseException

__all__ = [
    'AsyncLogger',
    'LEVELS',
    'LogPublisher',
    'Logger',
    'configure',
    'get_level_num',
    'get_logger',
    'get_null_logger',
]


Event = MutableMapping[str, Any]
ProcessorReturnType = Union[Event, str, bytes]
Processor = Callable[[Any, str, Event], ProcessorReturnType]
LEVELS: list[str] = ['debug', 'info', 'warn', 'error', 'critical']
"""Log severity levels, in ascending order of severity.

These levels correspond to those used by the built-in :mod:`logging` library:

============ ================================= =========================================
Level        Description                       Example
============ ================================= =========================================
``debug``    Frequent, low-level tracing.      A Smart Device message is received.
``info``     Normal operation (default level). A Smart Device connects.
``warn``     Unusual or anomalous events.      Referencing a nonexistent device.
``error``    Failure mode.                     A subprocess returns a nonzero exit code.
``critical`` Cannot continue running.          Emergency stop.
============ ================================= =========================================
"""


def drop(_logger: AsyncLogger, _method: str, _event: Event, /) -> NoReturn:
    """A simple :mod:`structlog` processor to drop all events."""
    raise structlog.DropEvent


get_logger = remote.get_logger
"""Get an unbound async-compatible logger.

Parameters:
    factory_args: Positional arguments passed to the logger factory.
    context: Contextual variables added to every event produced by this logger.
"""


def get_null_logger() -> AsyncLogger:
    """Get an async-compatible logger that drops all events unconditionally.

    Useful for objects that emit unimportant or noisy log events. :class:`LogPublisher`
    also uses a null logger internally, since using a real logger would result in a
    feedback loop.
    """
    return get_logger(processors=[drop])


@dataclass
class LogPublisher(remote.Client):
    """A client for publishing log events over a network.

    A :class:`LogPublisher` instance is a threadsafe :mod:`structlog` processor
    (callable). The processor feeds incoming events into an internal queue, which a
    worker task drains. For each event, the worker issues a notification call, where the
    method name is the log level and the only argument is the event dictionary.

    The worker and queue are not initialized until the async context is entered. The
    worker is attached to the context's running loop.

    Parameters:
        send_queue_capacity: The maximum size of the event queue. A nonpositive capacity
            indicates the queue size should be unbounded. When the queue is full, any
            additional events are dropped.
    """

    send_queue_capacity: int = 512
    send_queue: Optional[asyncio.Queue[tuple[str, Event]]] = field(
        default=None,
        init=False,
        repr=False,
    )
    loop: Optional[asyncio.AbstractEventLoop] = field(
        default=None,
        init=False,
        repr=False,
    )

    def __post_init__(self, /) -> None:
        super().__post_init__()
        self.logger = get_null_logger()

    def __call__(self, _logger: AsyncLogger, method: str, event: Event, /) -> Event:
        if self.loop and self.send_queue and event.get('transmit', True):
            # Since later processors can mutate the event dictionary, we feed a copy
            # into the queue.
            self.loop.call_soon_threadsafe(
                self.send_queue.put_nowait,
                (method, dict(event)),
            )
        return event

    async def __aenter__(self, /) -> 'LogPublisher':
        result = await super().__aenter__()
        self.loop = asyncio.get_running_loop()
        self.send_queue = asyncio.Queue(self.send_queue_capacity)
        worker = asyncio.create_task(self._send_forever(), name='log-publish')
        self.stack.callback(worker.cancel, 'log publisher worker cancelled')
        return result

    async def _send_forever(self, /) -> NoReturn:
        if not self.send_queue:  # pragma: no cover; always initialized by `__aenter__`
            raise ValueError('queue is not initialized')
        while True:
            method, event = await self.send_queue.get()
            with contextlib.suppress(asyncio.TimeoutError):
                await self.call[method](event, notification=True)


@functools.lru_cache(maxsize=16)
def get_level_num(level_name: str, /, *, default: int = logging.DEBUG) -> int:
    """Translate a :mod:`logging` level name into its numeric value.

    Parameters:
        level_name: A case-insensitive name, such as ``'DEBUG'``.
        default: The numeric level to return if the name is invalid.

    Example:
        >>> get_level_num('INFO')
        20
        >>> assert get_level_num('DNE') == logging.DEBUG == 10
    """
    level = getattr(logging, level_name.upper(), None)
    return level if isinstance(level, int) else default


def _filter_by_level(level: str, /) -> Processor:
    """Build a :mod:`structlog` processor to filter events by log level (severity)."""
    min_level = get_level_num(level)

    def processor(
        _logger: AsyncLogger,
        method: str,
        event: ProcessorReturnType,
        /,
    ) -> ProcessorReturnType:
        if get_level_num(method) < min_level:
            raise structlog.DropEvent
        return event

    return processor


def _add_exc_context(_logger: AsyncLogger, _method: str, event: Event, /) -> Event:
    """A processor to add the context of a :class:`RuntimeBaseException` to the event.

    When the keys of the exception context clash with those of the event, the event's
    entries take priority.
    """
    exception = event.get('exc_info')
    if isinstance(exception, RuntimeBaseException):
        event = exception.context | event
    return event


def configure(
    publisher: Optional[LogPublisher] = None,
    /,
    *,
    fmt: Literal['json', 'pretty'] = 'json',
    level: str = 'INFO',
) -> None:
    """Configure :mod:`structlog` with the desired log format and filtering.

    Parameters:
        publisher: A publisher added into the processor chain just before rendering.
        fmt: The format of events written to standard output.
        level: The minimum log level (inclusive) that should be processed. Severities
            are compared using :func:`runtime.log.get_level_num`.

    For development, we recommend the ``'pretty'`` log format, which is human-readable
    and renders exception tracebacks but cannot be parsed:

    .. code-block:: text

        2021-06-29T21:01:22.301992Z [info     ] Router connected to endpoint
        2021-06-29T21:01:22.304771Z [info     ] Health check                   threads=4
        Traceback (most recent call last):
          File "/usr/lib/python3.9/asyncio/tasks.py", line 492, in wait_for
            fut.result()
        asyncio.exceptions.CancelledError

    In production, we recommend the ``'json'`` format, which produces events in
    `jsonlines <https://jsonlines.org/>`_ format (required entries shown):

    .. code-block:: json

        {"event":"Started","level":"info","timestamp":"2021-06-29T21:04:15.507057Z"}
        {"event":"Started","level":"info","timestamp":"2021-06-29T21:04:15.510914Z"}
    """
    logging.captureWarnings(True)
    renderers: list[Processor] = [publisher] if publisher else []
    logger_factory: Callable[..., Union[structlog.PrintLogger, structlog.BytesLogger]]
    if fmt == 'pretty':
        renderers.append(structlog.processors.ExceptionPrettyPrinter())
        renderers.append(structlog.dev.ConsoleRenderer(pad_event=40))
        logger_factory = structlog.PrintLogger
    else:
        renderers.append(structlog.processors.JSONRenderer(serializer=json.dumps))
        logger_factory = structlog.BytesLogger

    structlog.configure(
        cache_logger_on_first_use=True,
        wrapper_class=AsyncLogger,
        processors=[
            structlog.threadlocal.merge_threadlocal_context,
            structlog.processors.add_log_level,
            _filter_by_level(level),
            _add_exc_context,
            structlog.processors.format_exc_info,
            structlog.processors.TimeStamper(fmt='iso'),
            *renderers,
        ],
        logger_factory=logger_factory,
    )
