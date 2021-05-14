import asyncio
import contextlib
import dataclasses
import functools
import logging
from typing import NoReturn, Optional

import orjson as json
import structlog
import structlog.processors
import structlog.stdlib

from . import rpc
from .exception import RuntimeBaseException

__all__ = ['null_logger', 'LogPublisher', 'configure']


def drop(_logger: structlog.BoundLogger, _method: str, _event: dict):
    raise structlog.DropEvent


null_logger = structlog.get_logger(processors=[drop])


@dataclasses.dataclass
class LogPublisher(rpc.Client):
    send_queue: asyncio.Queue[tuple[str, dict]] = dataclasses.field(
        default_factory=lambda: asyncio.Queue(512)
    )
    loop: asyncio.AbstractEventLoop = dataclasses.field(default_factory=asyncio.get_running_loop)

    def __call__(self, logger: structlog.BoundLogger, method: str, event: dict):
        self.loop.call_soon_threadsafe(self.send_queue.put_nowait, (method, dict(event)))
        return event

    async def __aenter__(self):
        result = await super().__aenter__()
        worker = asyncio.create_task(self._send_forever(), name='send')
        self.stack.callback(worker.cancel)
        return result

    async def _send_forever(self) -> NoReturn:
        while True:
            method, event = await self.send_queue.get()
            with contextlib.suppress(asyncio.TimeoutError):
                await self.call[method](event, address=method.encode(), notification=True)


@functools.lru_cache(maxsize=16)
def get_level_num(level_name: str, default: int = logging.DEBUG) -> int:
    level = getattr(logging, level_name.upper(), None)
    return level if isinstance(level, int) else default


def filter_by_level(level: str):
    min_level = get_level_num(level)

    def processor(_logger: structlog.BoundLogger, method: str, event: dict):
        if get_level_num(method) < min_level:
            raise structlog.DropEvent
        return event

    return processor


def add_exception_context(_logger: structlog.BoundLogger, _method: str, event: dict):
    exception = event.get('exc_info')
    if isinstance(exception, RuntimeBaseException):
        event = exception.context | event
    return event


def configure(publisher: Optional[LogPublisher] = None, fmt: str = 'json', level: str = 'INFO'):
    logging.captureWarnings(True)
    renderers = [publisher] if publisher else []
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
