import contextlib
import functools
from typing import Any, Iterator

import click
import orjson as json

from ..buffer import Buffer
from ..messaging import ErrorCode, Message, MessageError, MessageType


@contextlib.contextmanager
def indent(depth: int = 2) -> Iterator[None]:
    echo, secho = click.echo, click.secho
    try:

        @functools.wraps(echo)
        def indented_echo(*args: Any, **kwargs: Any) -> None:
            echo(' ' * depth, nl=False)
            echo(*args, **kwargs)

        @functools.wraps(secho)
        def indented_secho(*args: Any, **kwargs: Any) -> None:
            secho(' ' * depth, nl=False)
            secho(*args, **kwargs)

        click.echo, click.secho = indented_echo, indented_secho
        yield
    finally:
        click.echo, click.secho = echo, secho


def _format(buffer: Buffer, message: dict[str, Any]) -> Iterator[Message]:
    if type_id := message.get('type_id'):
        msg_type = MessageType(type_id)
    else:
        msg_type = MessageType[message['type']]
    if msg_type is MessageType.PING:
        yield Message.make_ping()
    elif msg_type is MessageType.SUB_REQ:
        yield buffer.make_sub_req(message['params'], message['interval'])
    elif msg_type is MessageType.SUB_RES:
        buffer.update(buffer.make_sub_req(message['params'], message['interval']))
        buffer.uid = int(message['uid'])
        yield buffer.make_sub_res()
    elif msg_type is MessageType.DEV_READ:
        buffer.read(message['params'])
        yield from buffer.emit_dev_rw()
    elif msg_type is MessageType.DEV_WRITE:
        for param, value in message['params'].items():
            buffer.write(param, value)
        yield from buffer.emit_dev_rw()
    elif msg_type is MessageType.DEV_DATA:
        for param, value in message['params'].items():
            buffer.set(param, value)
        yield from buffer.emit_dev_data()
    elif msg_type is MessageType.DEV_DISABLE:
        yield Message.make_dev_disable()
    elif msg_type is MessageType.HB_REQ:
        yield Message.make_hb_req(message['heartbeat_id'])
    elif msg_type is MessageType.HB_RES:
        yield Message.make_hb_res(message['heartbeat_id'])
    else:
        yield Message.make_error(ErrorCode[message['error']])
    # TODO: support error_code


def format_message(options: dict[str, Any]) -> None:
    for record in options['message']:
        buffer = options['dev_type'].attach()
        buffer.valid = True
        try:
            for message in _format(buffer, record):
                print(message.encode().hex())
        except (KeyError, MessageError) as exc:
            click.secho(
                f'-> Failed to format message: {type(exc).__name__}: {str(exc)}',
                fg='bright_red',
                bold=True,
                err=True,
            )
            continue


def _parse(buffer: Buffer, message: Message) -> dict[str, Any]:
    record = {
        'type': message.type.name,
        'type_id': message.type.value,
        'payload_len': len(message),
    }
    buffer.update(message)
    if message.type in {MessageType.SUB_REQ, MessageType.SUB_RES}:
        record['params'] = sorted(buffer.subscription)
        record['interval'] = buffer.interval
        if message.type is MessageType.SUB_RES:
            record['uid'] = str(int(buffer.uid))
    elif message.type is MessageType.DEV_READ:
        record['params'] = sorted(buffer.get_read())
    elif message.type is MessageType.DEV_WRITE:
        record['params'] = buffer.get_write()
    elif message.type is MessageType.DEV_DATA:
        record['params'] = buffer.get_update()
    elif message.type is MessageType.HB_REQ:
        record['heartbeat_id'] = message.read_hb_req()
    elif message.type is MessageType.HB_RES:
        record['heartbeat_id'] = message.read_hb_res()
    elif message.type is MessageType.ERROR:
        error = message.read_error()
        record['error'], record['error_code'] = error.name, error.value
    return record


def _display_message_pretty(record: dict[str, Any]) -> None:
    click.secho(
        f'-> Message type: {record.pop("type")} ({hex(record.pop("type_id"))})',
        fg='bright_green',
        bold=True,
    )
    with indent():
        click.secho(
            f'Payload length: {record.pop("payload_len")} bytes',
            fg='bright_blue',
            bold=True,
        )
        if (uid := record.pop('uid', None)) is not None:
            click.echo(f'UID: {uid} ({hex(int(uid))})')
        if (interval := record.pop('interval', None)) is not None:
            click.echo(f'Interval: {interval}s ({int(1000*interval)}ms)')
        if (hb_id := record.pop('heartbeat_id', None)) is not None:
            click.echo(f'Heartbeat ID: {hb_id} ({hex(hb_id)})')
        error = record.pop('error', None)
        error_code = record.pop('error_code', None)
        if error is not None and error_code is not None:
            click.echo(f'Error: {error} ({hex(error_code)})')
        if params := record.pop('params', None):
            click.echo('Parameters:')
            with indent():
                if isinstance(params, dict):
                    for param, value in params.items():
                        click.echo(f'{param}: {value!r}')
                else:
                    click.echo(', '.join(params))


def parse_messages(options: dict[str, Any]) -> None:
    buffer = options['dev_type'].attach()
    buffer.valid = True
    for encoding in options['message']:
        try:
            message = Message.decode(encoding)
            record = _parse(buffer, message)
        except MessageError as exc:
            click.secho(
                f'-> Failed to parse message: {type(exc).__name__}: {exc}',
                fg='bright_red',
                bold=True,
                err=True,
            )
            continue
        if options['output_format'] == 'json':
            print(json.dumps(record).decode())
        else:
            _display_message_pretty(record)
