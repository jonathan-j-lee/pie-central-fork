import asyncio
import dataclasses
import functools
import sys
from typing import AsyncIterator, Awaitable, Callable

import click
import orjson as json
import structlog

from .. import log, process, rpc


@dataclasses.dataclass
class LogHandler(rpc.Handler):
    logger: structlog.stdlib.AsyncBoundLogger = dataclasses.field(
        default_factory=lambda: log.get_logger().bind(),
    )

    async def echo(self, method: Callable[..., Awaitable[None]], event: log.Event) -> None:
        message = event.pop('event', '(no message)')
        await method(message, **event)

    @rpc.route
    async def debug(self, event: log.Event) -> None:
        await self.echo(self.logger.debug, event)

    @rpc.route
    async def info(self, event: log.Event) -> None:
        await self.echo(self.logger.info, event)

    @rpc.route
    async def warning(self, event: log.Event) -> None:
        await self.echo(self.logger.warning, event)

    @rpc.route
    async def error(self, event: log.Event) -> None:
        await self.echo(self.logger.error, event)

    @rpc.route
    async def critical(self, event: log.Event) -> None:
        await self.echo(self.logger.critical, event)


async def read_stdin() -> AsyncIterator[bytes]:
    loop = asyncio.get_running_loop()
    reader = asyncio.StreamReader()
    protocol_factory = functools.partial(asyncio.StreamReaderProtocol, reader)
    await loop.connect_read_pipe(protocol_factory, sys.stdin)
    while not reader.at_eof():
        yield await reader.readline()


async def main(ctx: click.Context) -> None:
    stream = sys.stderr if ctx.obj.options['log_format'] == 'pretty' else sys.stderr.buffer
    logger = log.get_logger(stream)
    async with process.Application('pager', ctx.obj.options, logger=logger.bind()) as app:
        handler = LogHandler()
        if app.options['source'] == 'remote':
            await app.make_log_subscriber(handler)
            while True:
                await asyncio.sleep(60)
        else:
            async for line in read_stdin():
                try:
                    event = json.loads(line)
                    level = event.get('level', 'debug')
                    await handler.dispatch(level, event)
                except json.JSONDecodeError as exc:
                    await app.logger.error('Failed to decode line', exc_info=exc)
