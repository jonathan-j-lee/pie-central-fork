import asyncio
import dataclasses
import functools
import logging
from typing import Union

import orjson as json
import structlog
import structlog.processors
import structlog.stdlib
import zmq.asyncio

from . import rpc
from .exception import RuntimeBaseException


@dataclasses.dataclass
class LogRelay(rpc.Client):
    queue: asyncio.Queue[tuple[str, dict]] = dataclasses.field(
        default_factory=lambda: asyncio.Queue(512)
    )
    loop: asyncio.AbstractEventLoop = dataclasses.field(default_factory=asyncio.get_running_loop)

    def __call__(self, logger: structlog.BoundLogger, method: str, event: dict):
        self.loop.call_soon_threadsafe(self.queue.put_nowait, (method, event))
        return event

    def reset(self):
        super().reset()
        self.workers.add(asyncio.create_task(self.forward(), name='forward'))

    async def forward(self):
        while True:
            method, event = await self.queue.get()
            with contextlib.suppress(asyncio.TimeoutError):
                await self.call[method](event, service_or_topic=method.encode(), notification=True)


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


def configure(relay: LogRelay, fmt: str = 'json', level: str = 'INFO'):
    logging.captureWarnings(True)
    if fmt == 'pretty':
        renderers = [
            structlog.processors.ExceptionPrettyPrinter(),
            structlog.dev.ConsoleRenderer(pad_event=40),
        ]
        logger_factory = structlog.PrintLoggerFactory()
    else:
        renderers = [
            structlog.processors.JSONRenderer(serializer=json.dumps),
        ]
        logger_factory = structlog.BytesLoggerFactory()

    structlog.configure(
        cache_logger_on_first_use=True,
        wrapper_class=structlog.stdlib.AsyncBoundLogger,
        processors=[
            structlog.threadlocal.merge_threadlocal_context,
            structlog.processors.add_log_level,
            filter_by_level(level),
            structlog.processors.format_exc_info,
            structlog.processors.TimeStamper(fmt='iso'),
            relay,
            *renderers,
        ],
        logger_factory=logger_factory,
    )
