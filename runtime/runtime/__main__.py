import asyncio
import collections
import dataclasses
import functools
import re
from numbers import Real
from pathlib import Path
from typing import Any, Callable, NamedTuple, Optional, Union

import click
import orjson as json
import uvloop
import zmq

import runtime
from runtime.tools import client, devemulator


class OptionGroupMixin:
    @staticmethod
    def format_group(ctx, formatter, header: str, params: list[click.Parameter]):
        with formatter.section(header):
            options = []
            for param in params:
                record = param.get_help_record(ctx)
                if record is not None:
                    options.append(record)
            formatter.write_dl(options, col_max=30)

    def format_options(self, ctx, formatter):
        grouped_params = collections.defaultdict(list)
        for param in self.get_params(ctx):
            group = getattr(param, 'group', None)
            grouped_params[group].append(param)
        other_params = grouped_params.pop(None, None) or []
        for group in sorted(grouped_params, key=lambda group: group.key):
            params = grouped_params[group]
            header = group.header or f'{group.key.title()} Options'
            self.format_group(ctx, formatter, header, params)
        self.format_group(ctx, formatter, 'Other Options', other_params)
        if isinstance(self, click.Group):
            self.format_commands(ctx, formatter)


class OptionGroupMultiCommand(OptionGroupMixin, click.Group):
    pass


class OptionGroupCommand(OptionGroupMixin, click.Command):
    pass


@dataclasses.dataclass
class OptionStore:
    options: dict[str, Any] = dataclasses.field(default_factory=dict)
    envvars: dict[str, Any] = dataclasses.field(default_factory=dict)


class OptionGroup(NamedTuple):
    key: str
    header: Optional[str] = None


class Option(click.Option):
    def __init__(self, *args, group: Optional[OptionGroup] = None, **kwargs):
        super().__init__(*args, **kwargs)
        self.group = group

    def process_value(self, ctx: click.Context, value):
        ctx.ensure_object(OptionStore)
        if value:
            ctx.obj.envvars[f'{ctx.auto_envvar_prefix}_{self.name}'.upper()] = value
        return super().process_value(ctx, value)


class OptionGroupFactory:
    def __init__(self):
        self.current = None

    def group(self, *args, **kwargs):
        self.current = OptionGroup(*args, **kwargs)
        return lambda func: func

    def option(self, *args, **kwargs):
        return click.option(*args, **kwargs, group=self.current)


@functools.lru_cache(maxsize=16)
def make_converter(convert):
    def callback(_ctx, _param, value):
        if isinstance(value, (tuple, list)):
            return tuple(convert(element) for element in value)
        return convert(value)

    return callback


def make_multipart_parser(*converters: Callable[[str], Any], delimeter: str = ':'):
    if not converters:
        raise ValueError('not enough converters')

    def convert(element: str):
        components = element.rsplit(delimeter, maxsplit=len(converters) - 1)
        if len(components) != len(converters):
            raise click.BadParameter('not enough parts provided')
        for i, (converter, component) in enumerate(zip(converters, components)):
            try:
                yield converter(component)
            except (TypeError, ValueError, AttributeError) as exc:
                raise click.BadParameter(f'failed to parse part {i+1}: {exc}')

    return make_converter(lambda value: tuple(convert(value)))


def to_int_or_bytes(value: str) -> Union[int, bytes]:
    try:
        return int(value)
    except ValueError:
        return bytes.fromhex(value.removeprefix('"').removesuffix('"'))


def check_positive(value: Real) -> Real:
    if value <= 0:
        raise click.BadParameter(f'{value} should be a positive number')
    return value


def parse_uid(value: str) -> int:
    bases = (10, 16)
    for base in bases:
        try:
            return int(value, base=base)
        except ValueError:
            pass
    bases_list = ', '.join(map(str, bases))
    raise click.BadParameter(f'{value!r} should be an integer (bases: {bases_list})')


def check_uid(value: str) -> int:
    uid = parse_uid(value)
    if not 0 <= uid < (1 << 96):
        raise click.BadParameter(f'{hex(uid)} should be a 96-bit unsigned integer')
    return uid


optgroup = OptionGroupFactory()
click.option = functools.partial(click.option, cls=Option)
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
    show_default=True,
    help='Device catalog file.',
)
@optgroup.option(
    '--dev-name',
    callback=make_multipart_parser(str, check_uid),
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
    type=click.Choice(['debug', 'info', 'warn', 'error', 'critical'], case_sensitive=False),
    default='debug',
    help='Minimum severity of log records displayed.',
)
@optgroup.option(
    '--log-format',
    type=click.Choice(['json', 'pretty'], case_sensitive=False),
    default='pretty',
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
def cli(ctx, **options):
    uvloop.install()
    ctx.obj.options.update(options)


@cli.command()
@click.pass_context
def start(ctx, **options):
    """
    Start the Runtime daemon.
    """
    ctx.obj.options.update(options)
    asyncio.run(runtime.main(ctx))


@cli.command(name='emulate-dev')
@click.argument('uid', callback=make_converter(check_uid), nargs=-1)
@click.pass_context
def emulate(ctx, **options):
    """Emulate Smart Devices."""
    ctx.obj.options.update(options)
    asyncio.run(devemulator.main(ctx))


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
def client_cli(ctx, **options):
    """Invoke a remote procedure call."""
    ctx.obj.options.update(options)
    asyncio.run(client.main(ctx))


if __name__ == '__main__':
    cli(prog_name=f'python -m {__package__}')  # pylint: disable=no-value-for-parameter
