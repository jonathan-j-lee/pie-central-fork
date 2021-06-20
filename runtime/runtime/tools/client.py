import click

from .. import process

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
    'execute': 'challenge-service',
}


async def main(ctx: click.Context) -> None:
    async with process.Application('cli', ctx.obj.options) as app:
        client = await app.make_client()
        method = app.options['method']
        address = app.options['address'] or DEFAULT_ADDRESSES.get(method)
        if not address:
            await app.logger.error('Address not provided or inferred', method=method)
            return
        try:
            result = await client.call[method](
                *app.options['arguments'],
                address=address.encode(),
                notification=app.options['notification'],
            )
            await app.logger.info('Remote call succeeded', result=result)
        except Exception as exc:
            await app.logger.error('Remote call failed', exc_info=exc)
