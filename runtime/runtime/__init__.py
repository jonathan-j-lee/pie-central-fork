import asyncio

import click

from runtime import buffer, log, process
from runtime.service import broker, device, executor

__version__ = '0.9.0'


async def main(ctx: click.Context) -> None:
    try:
        tasks = {
            asyncio.create_task(broker.main(ctx, **ctx.obj.options), name='broker'),
            process.run_process(
                process.AsyncProcess(
                    target=device.target,
                    kwargs=ctx.obj.options,
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
        }
        await asyncio.sleep(0.05)
        await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
    finally:
        buffer.BufferStore.unlink_all()
