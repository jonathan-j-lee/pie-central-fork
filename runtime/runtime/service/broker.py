"""Broker Service Handler."""

import asyncio
import collections
import contextlib
import ctypes
import dataclasses
import functools
import re
import shlex
from typing import Any, ClassVar, Iterable, Optional, Union

import click
import orjson as json
import structlog

from .. import log, process, rpc
from ..buffer import BufferManager, DeviceBufferError, Parameter

__all__ = ['Broker', 'main']


@dataclasses.dataclass
class Broker(rpc.Handler):
    """The coordinator between Runtime's clients and Runtime's other processes.

    Attributes:
        ctx: Command-line context.
        update_publisher: A client for notifying subscribers of Smart Device parameter updates.
        client: A client for interprocess calls.
        buffers: A buffer manager.
        uids: Smart Device UIDs.
    """

    ctx: click.Context
    update_publisher: rpc.Client
    client: rpc.Client
    buffers: BufferManager
    uids: set[str] = dataclasses.field(default_factory=set)
    logger: structlog.stdlib.AsyncBoundLogger = dataclasses.field(default_factory=log.get_logger)

    PYLINT_EXEC: ClassVar[str] = 'pylint'
    MESSAGE_TEMPLATE: ClassVar[str] = (
        '{{"line":{line},"column":{column},"msg":"{msg}","msg_id":"{msg_id}","symbol":"{symbol}",'
        '"category":"{category}","obj":"{obj}"}}'
    )
    PYLINT_OPTIONS: ClassVar[list[str]] = [
        f"--msg-template='{MESSAGE_TEMPLATE}'",
        '--disable=missing-module-docstring,missing-function-docstring',
    ]
    PATCHED_SYMBOLS: ClassVar[frozenset[str]] = frozenset({'Robot', 'Gamepad'})

    @functools.cached_property
    def _env_prefix(self) -> str:
        return (self.ctx.auto_envvar_prefix or 'RT').upper()

    def get_envvar(self, name: str) -> str:
        """Convert an option name into its corresponding environment variable."""
        return f'{self._env_prefix}_{name}'.upper()

    def get_name(self, envvar: str) -> str:
        """Convert an environment variable into its corresponding option name."""
        return envvar.lower().removeprefix(f'{self._env_prefix.lower()}_')

    @rpc.route
    async def get_option(self, option: Optional[str] = None) -> Union[Any, dict[str, Any]]:
        """Get a command-line option.

        Arguments:
            option: The option name. If not provided, all options are returned.

        Returns:
            If the option name was requested, a single option value. Otherwise, a mapping from
            all option names to their respective values.
        """
        if option:
            return self.ctx.obj.envvars[self.get_envvar(option)]
        return {self.get_name(envvar): value for envvar, value in self.ctx.obj.envvars.items()}

    @staticmethod
    def format_args(options: dict[str, Any]) -> Iterable[str]:
        """Normalize a option name-value mapping as a flat command-line argument list.

        Arguments:
            options: Option name-value mapping. Names are in snake case.

        Returns:
            A command-line argument list.

        Note:
            Tokens are not quoted with ``shlex.quote``.
        """
        for option, value in options.items():
            if option in ('help', 'version'):
                continue
            flag = f"--{option.replace('_', '-')}"
            if not isinstance(value, bool):
                if not isinstance(value, (list, tuple)):
                    value = [value]
                for element in value:
                    yield flag
                    yield str(element)

    @rpc.route
    async def set_option(self, options: dict[str, Any]) -> None:
        """Set a command-line option to be used when Runtime is next restarted.

        Note:
            Command-line switches are not supported at this time.
        """
        items = self.ctx.obj.envvars.items()
        current_options = {self.get_name(envvar): value for envvar, value in items}
        current_options.update(options)
        args = list(self.format_args(current_options))
        await asyncio.to_thread(self.ctx.command.parse_args, self.ctx, args)

    def filter_lint_message(self, message: dict[str, Any]) -> bool:
        """Exclude spurious lint messages."""
        if message['symbol'] == 'undefined-variable':
            match = re.match("Undefined variable '(?P<symbol>.+)'", message['msg'])
            if match and match.group('symbol') in self.PATCHED_SYMBOLS:
                return False
        return True

    def parse_lint_output(self, stdout: str, _stderr: str) -> Iterable[dict[str, Union[str, int]]]:
        """Parse raw ``pylint`` output into JSON records.

        Arguments:
            stdout: ``pylint`` subprocess standard output.

        Returns:
            A list of dictionaries, each of which has the keys: ``line``, ``column``, ``msg``,
            ``msg_id``, ``symbol``, ``category``, and ``obj``. See the `Pylint Output`_
            documentation for details.

        Note:
            We cannot selectively disable certain errors within a category from the command line.
            For example, undefined variables 'Robot' and 'Gamepad' are OK because the student API
            is patched in, but we still want to emit warnings for undefined variables created by
            students (so we cannot disable the "undefined-variable" category entirely). This means
            the total score will always start with a large penalty and has a meaningless baseline.
            We solve this problem by computing the score client-side.

        .. _Pylint Output:
            https://docs.pylint.org/en/1.6.0/output.html
        """
        issue_counter: dict[str, int] = collections.defaultdict(lambda: 0)
        for line in stdout.splitlines():
            with contextlib.suppress(json.JSONDecodeError, KeyError):
                message = json.loads(line)
                if self.filter_lint_message(message):
                    yield message
                    issue_counter[message['symbol']] += 1
        self.logger.sync_bl.info(
            'Linted student code',
            module=self.ctx.obj.options['exec_module'],
            issues=dict(issue_counter),
        )

    @rpc.route
    async def lint(self) -> list[dict[str, Union[str, int]]]:
        """Lint student code to catch errors and suggest best practices.

        Returns:
            A list of lint messages, each of which represents one warning. See
            :meth:`Broker.parse_lint_output` for details on the format of the output.
        """
        shell = await asyncio.create_subprocess_exec(
            self.PYLINT_EXEC,
            *self.PYLINT_OPTIONS,
            shlex.quote(self.ctx.obj.options['exec_module']),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        await asyncio.wait_for(process.run_process(shell), 5)
        stdout, stderr = await shell.communicate()
        return list(await asyncio.to_thread(self.parse_lint_output, stdout, stderr))

    @functools.cached_property
    def button_params(self) -> list[Parameter]:
        """Gamepad button parameters."""
        gamepad_type = self.buffers.catalog['gamepad']
        params = list(gamepad_type.params.values())
        params = [param for param in params if param.platform_type == ctypes.c_bool]
        params.sort(key=lambda param: param.id)
        return params

    @rpc.route
    def update_gamepads(self, update: dict[str, dict[str, Union[int, float]]]) -> None:
        """Update gamepad parameters.

        Arguments:
            update: A map of gamepad indices to their values.
        """
        for index, params in update.items():
            gamepad = self.buffers.get_or_create(('gamepad', int(index)))
            with gamepad.transaction():
                for joystick in ('left', 'right'):
                    for axis in ('x', 'y'):
                        with contextlib.suppress(KeyError):
                            value = params[joystick[0] + axis]
                            gamepad.set(f'joystick_{joystick}_{axis}', value)
                bitmap = int(params.get('btn', 0))
                for i, param in enumerate(self.button_params):
                    gamepad.set(param.name, bool((bitmap >> i) & 0b1))

    def make_update(self) -> dict[str, dict[str, Any]]:
        """Build a Smart Device update."""
        update = {}
        for uid in self.uids:
            with contextlib.suppress(DeviceBufferError):
                update[uid] = self.buffers[int(uid)].get_update()
        return update

    async def send_update(self) -> None:
        """Broadcast a Smart Device update."""
        update = await asyncio.to_thread(self.make_update)
        await self.update_publisher.call.update(update, notification=True)

    async def update_uids(self) -> None:
        """Update the set of valid Smart Device UIDs."""
        try:
            new_uids = await self.client.call.list_uids(address=b'device-service')
            self.uids.clear()
            self.uids.update(new_uids)
        except asyncio.TimeoutError as exc:
            await self.logger.error('Broker could not refresh UIDs', exc_info=exc)


async def main(ctx: click.Context, **options: Any) -> None:
    """Async entry point.

    Arguments:
        **options: Command-line options.
    """
    async with process.Application('broker', options) as app:
        await app.make_log_forwarder()
        await app.make_log_publisher()
        await app.make_router()
        broker = Broker(
            ctx,
            await app.make_update_client(),
            await app.make_client(),
            app.make_buffer_manager(),
            logger=app.logger.bind(),
        )
        await app.make_service(broker)
        await asyncio.gather(
            app.report_health(),
            process.spin(broker.send_update, interval=options['update_interval']),
            process.spin(broker.update_uids, interval=1),
        )
