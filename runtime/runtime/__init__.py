import asyncio

from runtime import buffer, log, process
from runtime.service import broker, device, executor

__version__ = '0.0.1-alpha'


async def main(ctx):
    log.configure(fmt='pretty')
    try:
        await asyncio.gather(
            broker.main(ctx, **ctx.obj.options),
            process.run_process(
                process.AsyncProcess(
                    target=lambda: asyncio.run(device.main(**ctx.obj.options)),
                    name='device',
                ),
            ),
            process.run_process(
                process.AsyncProcess(
                    target=executor.target,
                    args=('executor',),
                    kwargs=ctx.obj.options,
                    name='executor',
                ),
            ),
            process.run_process(
                process.AsyncProcess(
                    target=executor.target,
                    args=('challenge',),
                    kwargs=ctx.obj.options,
                    name='challenge',
                ),
            ),
        )
    finally:
        buffer.BufferManager.unlink_all()
