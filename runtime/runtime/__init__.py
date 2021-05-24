import asyncio

from runtime import buffer, log, process
from runtime.service import broker, device, executor

__version__ = '0.0.1-alpha'


async def main(ctx, options):
    log.configure(fmt='pretty')
    try:
        await asyncio.gather(
            device.main(**options),
            # broker.main(ctx, **options),
            # process.run_process(
            #     process.AsyncProcess(target=executor.target, args=('executor',), kwargs=options)
            # ),
        )
    finally:
        buffer.BufferManager.unlink_all()
