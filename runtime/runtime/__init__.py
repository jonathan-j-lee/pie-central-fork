import asyncio

from runtime.service import broker

__version__ = '0.0.1-alpha'


async def main(ctx, options):
    await asyncio.gather(
        broker.main(ctx, **options),
    )
