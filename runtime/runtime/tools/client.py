import asyncio

import cbor2
import structlog

from .. import process
from ..rpc import RuntimeRPCError

DEFAULT_ADDRESSES: dict[str, str] = {
    'get_option': 'broker-service',
    'set_option': 'broker-service',
    'lint': 'broker-service',
    'update_gamepads': 'broker-service',
    'list_uids': 'device-service',
    'ping': 'device-service',
    'disable': 'device-service',
    'subscribe': 'device-service',
    'unsubscribe': 'device-service',
    'read': 'device-service',
    'heartbeat': 'device-service',
    'idle': 'executor-service',
    'auto': 'executor-service',
    'teleop': 'executor-service',
    'estop': 'executor-service',
}


async def main(ctx):
    async with process.Application('cli', ctx.obj.options) as app:
        client = await app.make_client()
        logger = structlog.get_logger(wrapper_class=structlog.stdlib.AsyncBoundLogger)
        method = app.options['method']
        address = app.options['address'] or DEFAULT_ADDRESSES.get(method)
        if not address:
            await logger.error('Address not provided or inferred', method=method)
            return
        try:
            result = await client.call[method](
                *app.options['arguments'],
                address=address.encode(),
                notification=app.options['notification'],
            )
            await logger.info('Remote call succeeded', result=result)
        except (asyncio.TimeoutError, ValueError, RuntimeRPCError, cbor2.CBOREncodeError) as exc:
            await logger.error('Remote call failed', exc_info=exc)
