import asyncio
import contextlib
import ctypes
import dataclasses
from typing import Any, AsyncContextManager, AsyncIterable
from urllib.parse import urlsplit

import structlog

from .. import process
from ..buffer import BufferManager, DeviceUID
from ..messaging import Message, MessageType
from ..service.device import SmartDevice

_numeric_types = {
    ctypes.c_float,
    ctypes.c_double,
    ctypes.c_longdouble,
    ctypes.c_byte,
    ctypes.c_short,
    ctypes.c_int,
    ctypes.c_long,
    ctypes.c_longlong,
    ctypes.c_ubyte,
    ctypes.c_ushort,
    ctypes.c_uint,
    ctypes.c_ulong,
    ctypes.c_ulonglong,
    ctypes.c_size_t,
    ctypes.c_ssize_t,
}


@dataclasses.dataclass
class SmartDeviceService(SmartDevice):
    sub_task: asyncio.Future = dataclasses.field(default_factory=asyncio.Future)

    async def _send_sub_update(self):
        messages = await asyncio.to_thread(lambda: list(self.buffer.emit_subscription()))
        for message in messages:
            await self.write_queue.put(message)

    def disable(self):
        with self.buffer.transaction():
            for param in self.buffer.params.values():
                if param.writeable:
                    if param.platform_type in _numeric_types:
                        self.buffer.write(param.name, 0)
                    elif param.platform_type is ctypes.c_bool:
                        self.buffer.write(param.name, False)

    async def _emit_responses(self, message: Message, /) -> AsyncIterable[Message]:
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

    def _update(self):
        with self.buffer.transaction():
            read_params, write_params = self.buffer.get_read(), self.buffer.get_write()
            for param in read_params:
                self.buffer.set(param, self.buffer.get(param))
            for param, value in write_params.items():
                if self.buffer.params[param].readable:
                    self.buffer.set(param, value)
            return read_params, write_params, list(self.buffer.emit_dev_data())

    @contextlib.asynccontextmanager
    async def communicate(self, /) -> AsyncContextManager[set[asyncio.Task]]:
        async with super().communicate() as tasks:
            try:
                yield tasks
            finally:
                self.sub_task.cancel()

    async def poll_buffer(self):
        self._check_buffer()
        _, _, messages = await asyncio.to_thread(self._update)
        for message in messages:
            await self.write_queue.put(message)


@contextlib.asynccontextmanager
async def start_virtual_device(
    buffers: BufferManager,
    uid: int,
    options: dict[str, Any],
) -> AsyncContextManager[set[asyncio.Task]]:
    vsd_addr_parts = urlsplit(options['dev_vsd_addr'])
    reader, writer = await asyncio.open_connection(vsd_addr_parts.hostname, vsd_addr_parts.port)
    buffer = buffers.get_or_create(uid)
    buffer.uid = DeviceUID.from_int(uid)
    device = SmartDeviceService(reader, writer, buffer)
    async with device.communicate() as tasks:
        poll = process.spin(device.poll_buffer, interval=options['dev_poll_interval'])
        tasks.add(asyncio.create_task(device.handle_messages(), name='dev-handle'))
        tasks.add(asyncio.create_task(poll, name='dev-poll'))
        yield tasks


async def main(ctx):
    async with process.Application('dev-emulator', ctx.obj.options) as app:
        buffers = app.make_buffer_manager(shared=False)
        logger = structlog.get_logger()
        tasks = set()
        try:
            for uid in app.options['uid']:
                vsd = start_virtual_device(buffers, uid, app.options)
                tasks.update(await app.stack.enter_async_context(vsd))
            await asyncio.gather(*tasks)
        except ConnectionRefusedError as exc:
            await logger.error('Connection refused', exc_info=exc)
