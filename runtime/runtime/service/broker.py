"""Broker service handler."""

import asyncio
import collections
import contextlib
import ctypes
import functools
import re
import shlex
import typing
from dataclasses import dataclass, field
from typing import Any, ClassVar, Iterator, Optional, Union

import click
import orjson as json

from .. import api, log, process, remote
from ..buffer import BufferStore, DeviceBufferError, Parameter

# isort: unique-list
__all__ = ['Broker', 'main']


@dataclass
class Broker(remote.Handler):
    """The coordinator between Runtime's clients and Runtime's other processes.

    Parameters:
        ctx: Command-line context.
        update_publisher: A client for broadcasting Smart Device parameter updates.
        client: A client for interprocess calls.
        buffers: A buffer manager.
        uids: Smart Device UIDs.
    """

    ctx: click.Context
    update_publisher: remote.Client
    client: remote.Client
    buffers: BufferStore
    uids: set[str] = field(default_factory=set)
    logger: log.AsyncLogger = field(default_factory=log.get_logger)

    PYLINT_EXEC: ClassVar[str] = 'pylint'
    PYLINT_OPTIONS: ClassVar[list[str]] = [
        '--disable=missing-module-docstring,missing-function-docstring',
        '--output-format=json',
    ]
    PATCHED_SYMBOLS: ClassVar[frozenset[str]] = frozenset(
        typing.get_type_hints(api.StudentCodeModule),
    )

    @functools.cached_property
    def _env_prefix(self) -> str:
        return (self.ctx.auto_envvar_prefix or 'RT').upper()

    def _get_envvar(self, name: str) -> str:
        """Convert an option name into its corresponding environment variable."""
        return f'{self._env_prefix}_{name}'.upper()

    def _get_name(self, envvar: str) -> str:
        """Convert an environment variable into its corresponding option name."""
        return envvar.lower().removeprefix(f'{self._env_prefix.lower()}_')

    @remote.route
    async def get_option(self, option: Optional[str] = None) -> Any:
        """Get a command-line option.

        Parameters:
            option: The option name. If not provided, all options are returned.

        Returns:
            If the option name was requested, a single option value. Otherwise, a
            mapping from all option names to their respective values.
        """
        if option:
            return self.ctx.obj.envvars[self._get_envvar(option)]
        envvars = self.ctx.obj.envvars.items()
        return {self._get_name(envvar): value for envvar, value in envvars}

    @staticmethod
    def _format_args(options: dict[str, Any]) -> Iterator[str]:
        """Normalize a option name-value mapping as a flat command-line argument list.

        Parameters:
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

    @remote.route
    async def set_option(self, options: dict[str, Any]) -> None:
        """Set a command-line option to be used when Runtime is next restarted.

        Note:
            Command-line switches are not supported at this time.
        """
        items = self.ctx.obj.envvars.items()
        current_options = {self._get_name(envvar): value for envvar, value in items}
        current_options.update(options)
        args = list(self._format_args(current_options))
        await asyncio.to_thread(self.ctx.command.parse_args, self.ctx, args)

    def _filter_lint_message(self, message: dict[str, Any], /) -> bool:
        """Exclude spurious lint messages."""
        if message['symbol'] == 'undefined-variable':
            match = re.match("Undefined variable '(?P<symbol>.+)'", message['message'])
            if match and match.group('symbol') in self.PATCHED_SYMBOLS:
                return False
        return True

    def _parse_lint_output(
        self,
        stdout: str,
        stderr: str,
    ) -> list[dict[str, Union[str, int]]]:
        """Parse a ``pylint`` process's raw output into JSON records."""
        issue_counter: dict[str, int] = collections.defaultdict(lambda: 0)
        messages = []
        for message in filter(self._filter_lint_message, json.loads(stdout)):
            issue_counter[message['symbol']] += 1
            messages.append(message)
        self.logger.sync_bl.info(
            'Linted student code',
            module=self.ctx.obj.options['exec_module'],
            issues=dict(issue_counter),
        )
        if stderr:
            self.logger.sync_bl.error('Linter wrote to stderr', stderr=stderr)
        return messages

    @remote.route
    async def lint(self, /) -> list[dict[str, Union[str, int]]]:
        """Lint student code to identify errors and suggest best practices.

        Returns:
            A list of warnings. See the `Pylint Output`_ documentation for details.

        Note:
            The numerical score Pylint produces is not reported because Runtime's API
            built-ins (:mod:`runtime.api`) are always flagged as undefined. There is no
            way to selectively exclude certain errors within a category from the score
            calculation. Perfectly written student code will always have a meaningless
            penalty.

        .. _Pylint Output:
            https://docs.pylint.org/en/1.6.0/output.html
        """
        subprocess = await asyncio.create_subprocess_exec(
            self.PYLINT_EXEC,
            *self.PYLINT_OPTIONS,
            shlex.quote(self.ctx.obj.options['exec_module']),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        await asyncio.wait_for(process.run_process(subprocess), 5)
        stdout, stderr = await subprocess.communicate()
        return await asyncio.to_thread(self._parse_lint_output, stdout, stderr)

    @functools.cached_property
    def button_params(self) -> list[Parameter]:
        """Gamepad button parameters."""
        gamepad_type = self.buffers.catalog['gamepad']
        params = list(gamepad_type.params.values())
        params = [param for param in params if param.platform_type == ctypes.c_bool]
        params.sort(key=lambda param: param.id)
        return params

    @remote.route
    def update_gamepads(self, update: dict[str, dict[str, Any]]) -> None:
        """Update gamepad parameters.

        Parameters:
            update: A map of gamepad indices to their values.
        """
        for index, params in update.items():
            gamepad = self.buffers.get_or_open(('gamepad', int(index)))
            with gamepad.transaction():
                for joystick in ('left', 'right'):
                    for axis in ('x', 'y'):
                        with contextlib.suppress(KeyError):
                            value = params[joystick[0] + axis]
                            gamepad.set(f'joystick_{joystick}_{axis}', value)
                bitmap = int(params.get('btn', 0))
                for i, param in enumerate(self.button_params):
                    gamepad.set(param.name, bool((bitmap >> i) & 0b1))

    def _make_update(self) -> dict[str, dict[str, Any]]:
        """Build a Smart Device update."""
        update = {}
        for uid in self.uids:
            with contextlib.suppress(KeyError, DeviceBufferError):
                update[uid] = self.buffers[int(uid)].get_update()
        return update

    async def send_update(self) -> None:
        """Broadcast a Smart Device update."""
        update = await asyncio.to_thread(self._make_update)
        await self.update_publisher.call.update(update, notification=True)

    async def update_uids(self) -> None:
        """Update the set of valid Smart Device UIDs."""
        try:
            new_uids = await self.client.call.list_uids(
                address=b'device-service',
                timeout=0.2,
            )
            self.uids.clear()
            self.uids.update(new_uids)
        except asyncio.TimeoutError as exc:
            await self.logger.warn('Broker could not refresh UIDs', exc_info=exc)


async def main(ctx: click.Context, **options: Any) -> None:
    """Async entry point.

    Parameters:
        options: Processed command-line options.
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
        await app.make_control_service(broker)
        await asyncio.gather(
            app.report_health(),
            process.spin(broker.send_update, interval=options['update_interval']),
            process.spin(broker.update_uids, interval=1),
        )
