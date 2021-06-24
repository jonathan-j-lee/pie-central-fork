import asyncio
import contextlib
from dataclasses import dataclass, field
from typing import Any, AsyncIterator, NoReturn, Optional
from urllib.parse import urlsplit

import click

from .. import process
from ..buffer import BufferStore, DeviceBufferError
from ..messaging import Message, MessageType
from ..service.device import SmartDevice


@dataclass
class SmartDeviceService(SmartDevice):
    sub_task: asyncio.Future[NoReturn] = field(
        default_factory=lambda: asyncio.get_running_loop().create_future(),
        init=False,
        repr=False,
    )

    def _get_sub_update(self, /) -> list[Message]:
        return list(self.buffer.emit_subscription())

    async def _send_sub_update(self, /) -> None:
        messages = await asyncio.to_thread(self._get_sub_update)
        for message in messages:
            await self.write_queue.put(message)

    def disable(self, /) -> None:
        with self.buffer.transaction():
            for param in self.buffer.params.values():
                if param.writeable:
                    with contextlib.suppress(DeviceBufferError):
                        self.buffer.write(param.name, param.default)

    async def _emit_responses(self, message: Message, /) -> AsyncIterator[Message]:
        if message.type in {MessageType.PING, MessageType.SUB_REQ}:
            yield await asyncio.to_thread(self.buffer.make_sub_res)
            interval = await asyncio.to_thread(getattr, self.buffer, 'interval')
            if message.type is MessageType.SUB_REQ:
                self.sub_task.cancel()
                if interval > 0:
                    self.sub_task = asyncio.create_task(
                        process.spin(self._send_sub_update, interval=interval),
                        name='sub-update',
                    )
        elif message.type is MessageType.DEV_DISABLE:
            await asyncio.to_thread(self.disable)
            await self.logger.info('Device disabled')
        elif message.type not in {MessageType.DEV_READ, MessageType.DEV_WRITE}:
            async for response in super()._emit_responses(message):
                yield response

    def _update(self) -> tuple[frozenset[str], dict[str, Any], list[Message]]:
        with self.buffer.transaction():
            read_params, write_params = self.buffer.get_read(), self.buffer.get_write()
            for param in read_params:
                self.buffer.set(param, self.buffer.get(param))
            for param, value in write_params.items():
                if self.buffer.params[param].readable:
                    self.buffer.set(param, value)
            return read_params, write_params, list(self.buffer.emit_dev_data())

    @contextlib.asynccontextmanager
    async def communicate(self, /) -> AsyncIterator[set[asyncio.Task[NoReturn]]]:
        async with super().communicate() as tasks:
            try:
                yield tasks
            finally:
                self.sub_task.cancel()

    async def poll_buffer(self, /) -> None:
        _, _, messages = await asyncio.to_thread(self._update)
        for message in messages:
            await self.write_queue.put(message)


@contextlib.asynccontextmanager
async def start_virtual_device(
    buffers: BufferStore,
    uid: int,
    options: dict[str, Any],
    params: Optional[dict[str, Any]] = None,
    **kwargs: Any,
) -> AsyncIterator[set[asyncio.Task[NoReturn]]]:
    address = urlsplit(options['dev_vsd_addr'])
    reader, writer = await asyncio.open_connection(address.hostname, address.port)
    buffer = buffers.get_or_open(uid)
    buffer.uid = uid
    for param, value in (params or {}).items():
        buffer.set(param, value)
    device = SmartDeviceService(reader, writer, buffer, **kwargs)
    async with device.communicate() as tasks:
        poll = process.spin(device.poll_buffer, interval=options['dev_poll_interval'])
        tasks.add(asyncio.create_task(device.handle_messages(), name='dev-handle'))
        tasks.add(asyncio.create_task(poll, name='dev-poll'))
        yield tasks


async def main(ctx: click.Context) -> None:
    async with process.Application('dev-emulator', ctx.obj.options) as app:
        await app.make_log_publisher()
        buffers = app.make_buffer_manager(shared=False)
        tasks = set()
        try:
            for uid, *parts in app.options['device']:
                params = {}
                if parts:
                    params, *_ = parts
                vsd = start_virtual_device(
                    buffers,
                    uid,
                    app.options,
                    params,
                    logger=app.logger.bind(),
                )
                tasks.update(await app.stack.enter_async_context(vsd))
            await asyncio.gather(*tasks)
        except ConnectionRefusedError as exc:
            await app.logger.error('Connection refused', exc_info=exc)
