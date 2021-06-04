from pathlib import Path

import click.testing
import orjson as json
import pytest

from runtime.__main__ import cli


@pytest.fixture
def records():
    yield [
        {'type': 'PING', 'type_id': 16, 'payload_len': 0},
        {
            'type': 'SUB_REQ',
            'type_id': 17,
            'payload_len': 4,
            'params': ['duty_cycle'],
            'interval': 0.123,
        },
        {
            'type': 'SUB_RES',
            'type_id': 18,
            'payload_len': 15,
            'params': ['duty_cycle'],
            'interval': 0.123,
            'uid': '56668397794435742564352',
        },
        {'type': 'DEV_READ', 'type_id': 19, 'payload_len': 2, 'params': ['duty_cycle']},
        {'type': 'DEV_WRITE', 'type_id': 20, 'payload_len': 6, 'params': {'duty_cycle': 0.123}},
        {'type': 'DEV_DATA', 'type_id': 21, 'payload_len': 6, 'params': {'duty_cycle': 0.456}},
        {'type': 'DEV_DISABLE', 'type_id': 22, 'payload_len': 0},
        {'type': 'HB_REQ', 'type_id': 23, 'payload_len': 1, 'heartbeat_id': 255},
        {'type': 'HB_RES', 'type_id': 24, 'payload_len': 1, 'heartbeat_id': 255},
        {
            'type': 'ERROR',
            'type_id': 255,
            'payload_len': 1,
            'error': 'UNEXPECTED_DELIMETER',
            'error_code': 253,
        },
    ]


@pytest.fixture
def messages():
    yield [
        b'\x02\x10\x02\x10',
        b'\x04\x11\x04\x01\x02{\x02o',
        b'\x04\x12\x0f\x01\x02{\x02\x0c\x01\x01\x01\x01\x01\x01\x01\x01\x01\x02k',
        b'\x04\x13\x02\x01\x02\x10',
        b'\x04\x14\x06\x01\x06m\xe7\xfb=_',
        b'\x04\x15\x06\x01\x06\xd5x\xe9>h',
        b'\x02\x16\x02\x16',
        b'\x05\x17\x01\xff\xe9',
        b'\x05\x18\x01\xff\xe6',
        b'\x05\xff\x01\xfd\x03',
    ]


def run_command(args: list[str]) -> tuple[list[str], list[str]]:
    cli_runner = click.testing.CliRunner(mix_stderr=False)
    result = cli_runner.invoke(cli, args)
    assert result.exit_code == 0
    assert not result.exception
    return result.stdout.splitlines(), result.stderr.splitlines()


def make_approx(obj):
    if isinstance(obj, float):
        return pytest.approx(obj)
    elif isinstance(obj, dict):
        return {key: make_approx(value) for key, value in obj.items()}
    elif isinstance(obj, list):
        return list(map(make_approx, obj))
    else:
        return obj


def test_format(messages, records):
    records.append({})
    args = ['format-msg', 'polar-bear'] + [json.dumps(record).decode() for record in records]
    stdout, stderr = run_command(args)
    assert list(map(bytes.fromhex, stdout)) == messages
    assert stderr == ["-> Failed to format message: KeyError: 'type'"]


def test_parse_json(messages, records):
    messages.append(b'\xff')
    args = ['parse-msg', 'polar-bear', '--output-format', 'json']
    args += [message.hex() for message in messages]
    stdout, stderr = run_command(args)
    assert list(map(json.loads, stdout)) == make_approx(records)
    assert stderr == [
        '-> Failed to parse message: MessageError: failed to decode Smart Device message',
    ]


def test_parse_pretty(messages):
    messages.append(b'\xff')
    args = ['parse-msg', 'polar-bear', '--output-format', 'pretty']
    args += [message.hex() for message in messages]
    stdout, stderr = run_command(args)
    with (Path(__file__).parent / 'parse-msg-pretty.stdout').open() as stream:
        assert stdout == stream.read().splitlines()
    assert stderr == [
        '-> Failed to parse message: MessageError: failed to decode Smart Device message',
    ]
