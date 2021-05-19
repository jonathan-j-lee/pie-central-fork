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

from .. import process, rpc
from ..buffer import BufferManager, Parameter, RuntimeBufferError

__all__ = ['Broker', 'main']


@dataclasses.dataclass
class Broker(rpc.Handler):
    ctx: click.Context
    update_publisher: rpc.Client
    client: rpc.Client
    buffers: BufferManager = dataclasses.field(default_factory=BufferManager)
    uids: set[int] = dataclasses.field(default_factory=set)
    logger: ClassVar[structlog.stdlib.AsyncBoundLogger] = structlog.get_logger(
        wrapper_class=structlog.stdlib.AsyncBoundLogger,
    )

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

    def get_envvar(self, name: str) -> str:
        return f'{self.ctx.auto_envvar_prefix}_{name}'.upper()

    def get_name(self, envvar: str) -> str:
        return envvar.lower().removeprefix(f'{self.ctx.auto_envvar_prefix.lower()}_')

    @rpc.route
    async def get_option(self, option: Optional[str] = None) -> Union[Any, dict[str, Any]]:
        if option:
            return self.ctx.obj[self.get_envvar(option)]
        return {self.get_name(envvar): value for envvar, value in self.ctx.obj.items()}

    def get_args(self, options: dict[str, Any]) -> list[str]:
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
    async def set_option(self, options: dict[str, Any]):
        """
        Note:
            Command-line switches are not supported at this time.
        """
        current_options = {self.get_name(envvar): value for envvar, value in self.ctx.obj.items()}
        current_options.update(options)
        args = list(self.get_args(current_options))
        await asyncio.to_thread(self.ctx.command.parse_args, self.ctx, args)

    def filter_lint_message(self, message: dict[str, Any]) -> bool:
        """Exclude spurious lint messages."""
        if message['symbol'] == 'undefined-variable':
            match = re.match("Undefined variable '(?P<symbol>.+)'", message['msg'])
            if match.group('symbol') in self.PATCHED_SYMBOLS:
                return False
        return True

    def parse_lint_output(self, stdout: str, _stderr: str) -> Iterable[dict]:
        """
        Note:
            We cannot selectively disable certain errors within a category from the command line.
            For example, undefined variables 'Robot' and 'Gamepad' are OK because the student API
            is patched in, but we still want to emit warnings for undefined variables created by
            students (so we cannot disable the "undefined-variable" category entirely). This means
            the total score will always start with a large penalty and has a meaningless baseline.
            We solve this problem by computing the score client-side.
        """
        issue_counter = collections.defaultdict(lambda: 0)
        for line in stdout.splitlines():
            with contextlib.suppress(json.JSONDecodeError, KeyError):
                message = json.loads(line)
                if self.filter_lint_message(message):
                    yield message
                    issue_counter[message['symbol']] += 1
        self.logger.sync_bl.info(
            'Linted student code',
            module=self.ctx.params['exec_module'],
            issues=dict(issue_counter),
        )

    @rpc.route
    async def lint(self) -> list[dict]:
        """Lint student code to catch errors and suggest best practices.

        Returns:
            A list of lint messages, each of which represents one warning.
        """
        shell = await asyncio.create_subprocess_exec(
            self.PYLINT_EXEC,
            *self.PYLINT_OPTIONS,
            shlex.quote(self.ctx.params['exec_module']),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        await asyncio.wait_for(process.run_process(shell), 5)
        stdout, stderr = await shell.communicate()
        return list(await asyncio.to_thread(self.parse_lint_output, stdout, stderr))

    @functools.cached_property
    def button_params(self) -> list[Parameter]:
        gamepad_type = self.buffers.catalog['gamepad']
        return [param for param in gamepad_type.params if param.platform_type == ctypes.c_bool]

    @rpc.route
    def update_gamepads(self, update):
        for index, params in update.items():
            gamepad = self.buffers.get_or_create(('gamepad', int(index)))
            with gamepad.operation():
                for joystick in ('left', 'right'):
                    for axis in ('x', 'y'):
                        with contextlib.suppress(KeyError):
                            param = f'joystick_{joystick}_{axis}'
                            value = params[joystick[0] + axis]
                            gamepad.set_value(param, value, write_block=False)
                bitmap = params.get('btn', 0)
                for i, param in enumerate(self.button_params):
                    gamepad.set_value(param.name, bool((bitmap >> i) & 0b1), write_block=False)

    def make_update(self) -> dict[str, dict[str, Any]]:
        update = {}
        for uid in self.uids:
            with contextlib.suppress(RuntimeBufferError):
                update[str(uid)] = self.buffers[uid].get_update()
        return update

    async def send_update(self):
        update = await asyncio.to_thread(self.make_update)
        await self.update_publisher.call.update(update, notification=True)

    async def update_uids(self):
        try:
            new_uids = await self.client.call.list_uids(address=b'device')
            self.uids.clear()
            self.uids.update(new_uids)
        except asyncio.TimeoutError as exc:
            await self.logger.error('Broker could not refresh UIDs', exc_info=exc)


async def main(ctx, **options):
    async with process.EndpointManager('broker', options) as manager:
        await manager.make_log_proxy()
        buffers = manager.stack.enter_context(BufferManager())
        broker = Broker(
            ctx,
            await manager.make_update_client(),
            await manager.make_client(),
            buffers,
        )
        await asyncio.to_thread(broker.buffers.load_catalog, options['dev_catalog'])
        await manager.make_service(broker)
        await asyncio.gather(
            process.spin(broker.send_update, interval=options['update_interval']),
            process.spin(broker.update_uids, interval=1),
        )
