"""Command-line interface and configuration."""

import asyncio
import collections
import contextlib
import dataclasses
import functools
import re
from pathlib import Path
from typing import Any, Callable, Iterator, NamedTuple, Optional, TypeVar, Union

import click
import orjson as json
import uvloop
import yaml
import zmq

import runtime

from . import log
from .buffer import Buffer, BufferManager
from .tools import client, devemulator, logpager, msgparser


class OptionGroupCommand(click.Command):
    @staticmethod
    def format_group(
        ctx: click.Context,
        formatter: click.HelpFormatter,
        header: str,
        params: list[click.Parameter],
    ) -> None:
        with formatter.section(header):
            options = []
            for param in params:
                record = param.get_help_record(ctx)
                if record is not None:
                    options.append(record)
            formatter.write_dl(options, col_max=30)

    def format_options(self, ctx: click.Context, formatter: click.HelpFormatter) -> None:
        grouped_params: dict['OptionGroup', list[click.Parameter]] = collections.defaultdict(list)
        other_params: list[click.Parameter] = []
        for param in self.get_params(ctx):
            group = getattr(param, 'group', None)
            params = grouped_params[group] if group else other_params
            params.append(param)
        for group in sorted(grouped_params, key=lambda group: group.key):
            params = grouped_params[group]
            header = group.header or f'{group.key.title()} Options'
            self.format_group(ctx, formatter, header, params)
        self.format_group(ctx, formatter, 'Other Options', other_params)


class OptionGroupMultiCommand(OptionGroupCommand, click.Group):
    def format_options(self, ctx: click.Context, formatter: click.HelpFormatter) -> None:
        super().format_options(ctx, formatter)
        self.format_commands(ctx, formatter)


@dataclasses.dataclass
class OptionStore:
    options: dict[str, Any] = dataclasses.field(default_factory=dict)
    envvars: dict[str, Any] = dataclasses.field(default_factory=dict)


class OptionGroup(NamedTuple):
    key: str
    header: Optional[str] = None


class Option(click.Option):
    def __init__(self, *args: Any, group: Optional[OptionGroup] = None, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self.group = group

    def process_value(self, ctx: click.Context, value: Any) -> Any:
        ctx.ensure_object(OptionStore)
        if value:
            ctx.obj.envvars[f'{ctx.auto_envvar_prefix}_{self.name}'.upper()] = value
        return super().process_value(ctx, value)


FC = TypeVar('FC', Callable[..., Any], click.Command)
Callback = Callable[[click.Context, click.Parameter, Any], Any]


class OptionGroupFactory:
    def __init__(self) -> None:
        self.current: Optional[OptionGroup] = None

    def group(self, *args: Any, **kwargs: Any) -> Callable[[FC], FC]:
        self.current = OptionGroup(*args, **kwargs)
        return lambda func: func

    def option(self, *args: Any, **kwargs: Any) -> Callable[[FC], FC]:
        return click.option(*args, **kwargs, group=self.current)


@functools.lru_cache(maxsize=64)
def make_converter(convert: Callable[[Any], Any]) -> Callback:
    """Make a :mod:`click` callback that applies a conversion to each option value.

    Works with options provided multiple times (where ``multiple=True``).

    Arguments:
        convert: A unary conversion callable. The argument/return types are arbitrary and need not
            be the same.

    Returns:
        A :mod:`click`-compatible callback.
    """

    def callback(_ctx: click.Context, _param: click.Parameter, value: Any, /) -> Any:
        try:
            if isinstance(value, (tuple, list)):
                return tuple(convert(element) for element in value)
            return convert(value)
        except Exception as exc:
            raise click.BadParameter(str(exc)) from exc

    return callback


def make_multipart_parser(*converters: Callable[[str], Any], delimeter: str = ':') -> Callback:
    """Make a :mod:`click` callback that parses a tuple-like multipart option.

    Examples:
        >>> make_multipart_parser()
        Traceback (most recent call last):
          ...
        ValueError: not enough converters
        >>> convert = make_multipart_parser(int, int)
        >>> convert(None, None, '1')
        Traceback (most recent call last):
          ...
        click.exceptions.BadParameter: not enough parts provided
        >>> convert(None, None, '1:2')
        (1, 2)
    """
    if not converters:
        raise ValueError('not enough converters')

    def convert(element: str) -> Iterator[Any]:
        components = element.rsplit(delimeter, maxsplit=len(converters) - 1)
        if len(components) != len(converters):
            raise click.BadParameter('not enough parts provided')
        for i, (converter, component) in enumerate(zip(converters, components)):
            try:
                yield converter(component)
            except Exception as exc:
                raise click.BadParameter(f'failed to parse part {i+1}: {exc}') from exc

    return make_converter(lambda value: tuple(convert(value)))


def to_int_or_bytes(value: str) -> Union[int, bytes]:
    r"""Parse a value as either an integer or a bytestring.

    Examples:
        >>> to_int_or_bytes('1212')
        1212
        >>> to_int_or_bytes('-1')
        -1
        >>> to_int_or_bytes('a0')
        b'\xa0'
        >>> to_int_or_bytes("'1212'")  # Note the disambiguation
        b'\x12\x12'
        >>> to_int_or_bytes('zz')
        Traceback (most recent call last):
          ...
        ValueError: non-hexadecimal number found in fromhex() arg at position 0
    """
    try:
        return int(value)
    except ValueError:
        return bytes.fromhex(value.removeprefix("'").removesuffix("'"))


def check_positive(value: float) -> float:
    """Check whether the provided value is strictly positive.

    Examples:
        >>> check_positive(0.01)
        0.01
        >>> check_positive(0)
        Traceback (most recent call last):
          ...
        ValueError: '0' should be a positive number
        >>> check_positive(-0.01)
        Traceback (most recent call last):
          ...
        ValueError: '-0.01' should be a positive number
    """
    if value <= 0:
        raise ValueError(f"'{value}' should be a positive number")
    return value


def parse_uid(value: str) -> int:
    """Parse a Smart Device UID as an integer.

    Examples:
        >>> parse_uid('1234')
        1234
        >>> hex(parse_uid('0xdeadbeef'))
        '0xdeadbeef'
        >>> parse_uid('0o12')
        Traceback (most recent call last):
          ...
        ValueError: '0o12' could not be parsed as an integer (attempted bases: 10, 16)
        >>> parse_uid(hex(1 << 96))
        Traceback (most recent call last):
          ...
        ValueError: '0x1000000000000000000000000' should be a 96-bit unsigned integer
        >>> parse_uid(str(-1))
        Traceback (most recent call last):
          ...
        ValueError: '-1' should be a 96-bit unsigned integer
    """
    bases = (10, 16)
    for base in bases:
        try:
            uid = int(value, base=base)
        except ValueError:
            continue
        else:
            if not 0 <= uid < (1 << 96):
                raise ValueError(f'{value!r} should be a 96-bit unsigned integer')
            return uid
    bases_list = ', '.join(map(str, bases))
    raise ValueError(
        f'{value!r} could not be parsed as an integer (attempted bases: {bases_list})',
    )


def load_catalog(path: Union[str, Path]) -> dict[str, type[Buffer]]:
    try:
        with Path(path).open() as stream:
            catalog = yaml.load(stream, Loader=yaml.SafeLoader)
        return BufferManager.make_catalog(catalog)
    except yaml.YAMLError as exc:
        message = f'Unable to parse device catalog ({path})'
        mark = getattr(exc, 'problem_mark', None)
        if mark:
            # The PyYAML docs recommend this pattern: https://pyyaml.org/wiki/PyYAMLDocumentation
            message += f': line {mark.line + 1}, column {mark.column + 1}'
        raise click.BadParameter(message) from exc


optgroup = OptionGroupFactory()
click.option: Callable[[FC], FC] = functools.partial(click.option, cls=Option)  # type: ignore[misc]
get_zmq_option = lambda option: getattr(zmq, option.upper())


@click.group(
    context_settings=dict(auto_envvar_prefix='RT', max_content_width=100, show_default=True),
    cls=OptionGroupMultiCommand,
)
@optgroup.group('broker')
@optgroup.option(
    '--router-frontend',
    metavar='ADDRESS',
    multiple=True,
    default=['tcp://*:6000', 'ipc:///tmp/rt-rpc.sock'],
    help='Addresses the frontend should bind to.',
)
@optgroup.option(
    '--router-backend',
    metavar='ADDRESS',
    multiple=True,
    default=['ipc:///tmp/rt-srv.sock'],
    help='Addresses the backend should bind to',
)
@optgroup.option(
    '--control-addr',
    metavar='ADDRESS',
    default='udp://localhost:6002',
    help='Address to bind to for receiving control messages.',
)
@optgroup.option(
    '--update-addr',
    metavar='ADDRESS',
    default='udp://224.1.1.1:6003',
    help='IP multicast group address to connect to for transmitting update messages.',
)
@optgroup.option(
    '--update-interval',
    callback=make_converter(check_positive),
    type=float,
    default=0.1,
    help='Duration in seconds between Smart Device updates.',
)
@optgroup.group('device')
@optgroup.option(
    '--dev-catalog',
    type=click.Path(dir_okay=False, exists=True),
    default=(Path(__file__).parent / 'catalog.yaml'),
    callback=make_converter(load_catalog),
    show_default=True,
    help='Device catalog file.',
)
@optgroup.option(
    '--dev-name',
    callback=make_multipart_parser(str, parse_uid),
    metavar='NAME:UID',
    multiple=True,
    help='Assign a human-readable name to a device UID.',
)
@optgroup.option(
    '--dev-baud-rate',
    callback=make_converter(check_positive),
    type=int,
    default=115200,
    help=(
        'Smart Device serial Baud rate. '
        'Depending on the underlying hardware, non-standard baud rates may or may not work.'
    ),
)
@optgroup.option(
    '--dev-poll-interval',
    callback=make_converter(check_positive),
    type=float,
    default=0.04,
    help='Interval (in seconds) at which device reads/writes should be written.',
)
@optgroup.option(
    '--dev-vsd-addr',
    metavar='ADDRESS',
    default='tcp://localhost:6004',
    help='Address to bind to for accepting Virtual Smart Device connections.',
)
@optgroup.group('executor')
@optgroup.option(
    '--exec-timeout',
    callback=make_multipart_parser(re.compile, lambda value: check_positive(float(value))),
    metavar='FN:TIMEOUT',
    multiple=True,
    default=['.*_setup:1', '.*_main:0.05'],
    help=(
        'Set an execution timeout for student code functions. '
        'The left-hand side is a regular expression pattern matching a function name. '
        'The right-hand side is the number of seconds. '
        'When multiple patterns match the same function, the timeout is undefined.'
    ),
)
@optgroup.option(
    '--exec-module',
    metavar='MODULE',
    default='studentcode',
    help='Student code module name. Ensure that this module exists in PYTHONPATH.',
)
@optgroup.group('log')
@optgroup.option(
    '--log-level',
    type=click.Choice(log.LEVELS, case_sensitive=False),
    default='info',
    help='Minimum severity of log records displayed.',
)
@optgroup.option(
    '--log-format',
    type=click.Choice(['json', 'pretty'], case_sensitive=False),
    default='json',
    help='Format of records printed to standard output.',
)
@optgroup.option(
    '--log-frontend',
    metavar='ADDRESS',
    multiple=True,
    default=['tcp://*:6001'],
    help='Addresses the frontend should bind to.',
)
@optgroup.option(
    '--log-backend',
    metavar='ADDRESS',
    multiple=True,
    default=['ipc:///tmp/rt-log.sock'],
    help='Addresses the backend should bind to.',
)
@optgroup.group('process')
@optgroup.option(
    '--proc-timeout',
    callback=make_converter(check_positive),
    type=float,
    default=2,
    help='Duration in seconds to wait for subprocesses to terminate before sending a kill signal.',
)
@optgroup.option(
    '--thread-pool-workers',
    callback=make_converter(check_positive),
    type=int,
    default=1,
    help='Number of threads to spawn for executing blocking code.',
)
@optgroup.option(
    '--service-workers',
    callback=make_converter(check_positive),
    type=int,
    default=5,
    help='Number of workers per service.',
)
@optgroup.option(
    '--client-option',
    callback=make_multipart_parser(get_zmq_option, to_int_or_bytes),
    metavar='OPTION:VALUE',
    multiple=True,
    default=['SNDTIMEO:1000'],
    help='ZMQ socket options for clients.',
)
@optgroup.option(
    '--service-option',
    callback=make_multipart_parser(get_zmq_option, to_int_or_bytes),
    metavar='OPTION:VALUE',
    multiple=True,
    default=['SNDTIMEO:1000'],
    help='ZMQ socket options for services.',
)
@optgroup.option(
    '--health-check-interval',
    callback=make_converter(check_positive),
    type=float,
    default=60,
    help='Seconds between health checks.',
)
@click.option('--debug/--no-debug', help='Enable the event loop debugger.')
@click.version_option(version=runtime.__version__, message='%(version)s')
@click.pass_context
def cli(ctx: click.Context, **options: Any) -> None:
    uvloop.install()
    ctx.obj.options.update(options)


@cli.command()
@click.pass_context
def start(ctx: click.Context, **options: Any) -> None:
    """
    Start the Runtime daemon.
    """
    ctx.obj.options.update(options)
    asyncio.run(runtime.main(ctx))


@cli.command(name='client')
@click.option('--notification/--no-notification', help='Issue a notification call.')
@click.option(
    '--arguments',
    callback=make_converter(json.loads),
    default='[]',
    help='Positional arguments (in JSON format).',
)
@click.option('--address', help='Service address (identity).')
@click.argument('method')
@click.pass_context
def client_cli(ctx: click.Context, **options: Any) -> None:
    """Issue a remote call."""
    ctx.obj.options.update(options)
    asyncio.run(client.main(ctx))


@cli.command()
@click.argument('uid', callback=make_converter(parse_uid), nargs=-1)
@click.pass_context
def emulate_dev(ctx: click.Context, **options: Any) -> None:
    """Emulate Smart Devices."""
    ctx.obj.options.update(options)
    asyncio.run(devemulator.main(ctx))


def get_buf_type(
    ctx: click.Context,
    _param: click.Parameter,
    value: str,
) -> type[Buffer]:
    catalog: dict[str, type[Buffer]] = ctx.obj.options['dev_catalog']
    with contextlib.suppress(KeyError):
        return catalog[value]
    not_found = click.BadParameter(
        'Unrecognized device. Provide a valid device ID (integer) or name.',
    )
    try:
        device_id = int(value)
    except ValueError as exc:
        raise not_found from exc
    for buf_type in catalog.values():
        if getattr(buf_type, 'device_id', None) == device_id:
            return buf_type
    raise not_found


@cli.command()
@click.argument('dev_type', callback=get_buf_type)
@click.argument('message', callback=make_converter(json.loads), nargs=-1)
@click.pass_context
def format_msg(ctx: click.Context, **options: Any) -> None:
    """Format a Smart Device message."""
    ctx.obj.options.update(options)
    msgparser.format_message(ctx.obj.options)


@cli.command()
@click.option(
    '--output-format',
    type=click.Choice(['json', 'pretty'], case_sensitive=False),
    default='pretty',
    help='Format of records printed to standard output.',
)
@click.argument('dev_type', callback=get_buf_type)
@click.argument('message', callback=make_converter(bytes.fromhex), nargs=-1)
@click.pass_context
def parse_msg(ctx: click.Context, **options: Any) -> None:
    """Parse a Smart Device message."""
    ctx.obj.options.update(options)
    msgparser.parse_messages(ctx.obj.options)


@cli.command()
@click.option(
    '--source',
    type=click.Choice(['stdin', 'remote'], case_sensitive=False),
    default='remote',
    help='Where to gather log records from.',
)
@click.pass_context
def log_pager(ctx: click.Context, **options: Any) -> None:
    """Start a pager for viewing log records.

    The pager collects log records (in jsonlines format) in real time from either Runtime's log
    frontend or from standard input and writes the formatted records to standard output.

    As a well-behaved shell application, the pager works well in a pipeline with other shell
    utilities. Using `jq` to perform transformations is a common use case. The pager itself may
    emit log records to standard error (for example, when encountering invalid JSON).

    In the following example, the first pager subscribes to all messages with the "warning"
    severity or above and feeds the jsonlines output to a filter that selects records emitted by
    the "broker" process. The second pager pretty-prints the filtered output:

    \b
        $ alias rt='python -m runtime'
        $ rt --log-level warn log-pager \\
            | jq --unbuffered -c '. | select(.app == "broker")' \\
            | rt --log-format pretty log-pager --source stdin

    In another example, we collect the first 10 records emitted and store them for replay:

    \b
        $ head -10 <(rt log-pager) > records.jsonl
    """
    ctx.obj.options.update(options)
    asyncio.run(logpager.main(ctx))


if __name__ == '__main__':
    cli(prog_name=f'python -m {__package__}')  # pylint: disable=no-value-for-parameter
