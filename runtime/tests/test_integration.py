import asyncio
import collections
import contextlib
import dataclasses
import functools
import sys
from typing import Any
from pathlib import Path

import orjson as json
import pytest

from runtime import process, rpc


@dataclasses.dataclass
class DeviceUpdateHandler(rpc.Handler):
    updates: list[dict] = dataclasses.field(default_factory=list)

    @rpc.route
    async def update(self, data: dict[str, dict[str, Any]]):
        self.updates.append(data)


@contextlib.asynccontextmanager
async def runtime_cli(*args, **kwargs):
    subprocess = await asyncio.create_subprocess_exec(
        sys.executable,
        '-m',
        'runtime',
        '--exec-module',
        'testcode.integration',
        *args,
        **kwargs,
    )
    # To ensure the root runtime process reaps (possibly kills) its child processes, we set the
    # root process's timeout above the default value. Otherwise, we may get a race where the root
    # process is killed before its child is killed, leaking the child process.
    task = asyncio.create_task(
        process.run_process(subprocess, terminate_timeout=3),
        name='runtime',
    )
    yield task, subprocess
    if subprocess.returncode is None:
        task.cancel()
        await task


async def runtime_client(func: str, *args) -> list[Any]:
    requests = [{'func': 'fib', 'args': [20]}, {'func': 'fib', 'args': [21]}]
    async with runtime_cli(
        'client',
        '--arguments',
        json.dumps(args).decode(),
        func,
        stdout=asyncio.subprocess.PIPE,
    ) as (_, subprocess):
        stdout, _ = await subprocess.communicate()
    records = map(json.loads, stdout.splitlines())
    (results,) = (record['result'] for record in records if 'result' in record)
    return results


@pytest.fixture(scope='module')
def event_loop(request):
    loop = asyncio.get_event_loop_policy().new_event_loop()
    yield loop
    loop.close()


@pytest.fixture(scope='module')
async def pager():
    async with runtime_cli('--log-format', 'pretty', 'log-pager'):
        await asyncio.sleep(0.2)
        yield


@pytest.fixture(scope='module')
async def server(app):
    async with runtime_cli('server', stdout=asyncio.subprocess.DEVNULL):
        await asyncio.sleep(0.6)
        yield


@pytest.fixture(scope='module')
async def devices(server):
    uids = [
        0x0_00_00000000_00000000,
        0x1_00_00000000_00000000,
        0x2_00_00000000_00000000,
        0x3_00_00000000_00000000,
        0x4_00_00000000_00000000,
        0x5_00_00000000_00000000,
        0x7_00_00000000_00000000,
        0xa_00_00000000_00000000,
        0xb_00_00000000_00000000,
        0xc_00_00000000_00000000,
        0xc_00_00000000_00000001,
        0xd_00_00000000_00000000,
    ]
    async with runtime_cli('emulate-dev', *map(str, uids), stdout=asyncio.subprocess.DEVNULL):
        await asyncio.sleep(0.2)
        yield


@pytest.fixture(scope='module')
async def app():
    options = {
        'update_addr': 'udp://224.1.1.1:6003',
        'control_addr': 'udp://localhost:6002',
        'thread_pool_workers': 1,
        'debug': True,
        'log_format': 'pretty',
        'log_level': 'info',
        'service_workers': 1,
    }
    async with process.Application('frontend', options) as app:
        yield app


@pytest.fixture(scope='module')
async def update_handler(app):
    handler = DeviceUpdateHandler()
    await app.make_update_service(handler)
    yield handler


@pytest.fixture(scope='module')
async def control_client(app):
    yield await app.make_control_client()


@pytest.fixture(autouse=True, scope='function')
async def idle(update_handler):
    yield
    async with runtime_cli('client', 'idle') as (task, _):
        await task
    await asyncio.sleep(0.2)
    update_handler.updates.clear()


@pytest.fixture
async def move_module():
    testcode = Path(__file__).parent / 'testcode'
    (testcode / 'integration.py').rename(testcode / 'integration.bak.py')
    (testcode / 'incr.py').rename(testcode / 'integration.py')
    yield
    (testcode / 'integration.py').rename(testcode / 'incr.py')
    (testcode / 'integration.bak.py').rename(testcode / 'integration.py')


def get_params(updates):
    params = collections.defaultdict(list)
    for update in updates:
        for uid, param_map in update.items():
            for param, value in param_map.items():
                params[uid, param].append(value)
    return params


def strip(sequence):
    return [value for value in sequence if abs(value) > 0]


def assert_ascending(sequence):
    for prev_value, next_value in zip(sequence[:-1], sequence[1:]):
        assert prev_value <= next_value


def assert_descending(sequence):
    assert_ascending(sequence[::-1])


@pytest.mark.asyncio
async def test_autonomous(pager, server, devices, update_handler):
    async with runtime_cli('client', 'auto') as (task, _):
        await task
    await asyncio.sleep(2.5)
    updates = list(update_handler.updates)
    params = get_params(updates)
    left_cycle = params[str(0xc_00_00000000_00000000), 'duty_cycle']
    right_cycle = params[str(0xc_00_00000000_00000001), 'duty_cycle']
    assert len(left_cycle) > 0.5*len(updates)
    assert len(right_cycle) > 0.5*len(updates)
    assert_ascending(left_cycle)
    assert_descending(right_cycle)
    assert max(left_cycle) > 0.9
    assert min(left_cycle) < 0.6
    assert min(right_cycle) < -0.9
    assert max(right_cycle) > -0.6


@pytest.mark.asyncio
async def test_teleop(pager, server, devices, update_handler, control_client):
    async with runtime_cli('client', 'teleop') as (task, _):
        await task
    duty_cycle = 0
    while duty_cycle <= 1:
        update = {
            '0': {
                'ly': duty_cycle,
                'ry': -duty_cycle,
                'btn': (1 if duty_cycle > 0.6 else 0),
            },
        }
        await asyncio.gather(
            asyncio.sleep(0.05),
            control_client.call.update_gamepads(update, notification=True),
        )
        duty_cycle += 0.05
    await asyncio.sleep(0.2)  # Wait for the last updates to come in.
    updates = list(update_handler.updates)
    params = get_params(updates)
    left_cycle = strip(params[str(0xc_00_00000000_00000000), 'duty_cycle'])
    right_cycle = strip(params[str(0xc_00_00000000_00000001), 'duty_cycle'])
    assert_ascending(left_cycle)
    assert_descending(right_cycle)
    assert max(left_cycle) > 0.9
    assert min(left_cycle) < 0.6
    assert min(right_cycle) < -0.9
    assert max(right_cycle) > -0.6
    left_deadband = params[str(0xc_00_00000000_00000000), 'deadband']
    assert min(left_deadband) == pytest.approx(0)
    assert max(left_deadband) == pytest.approx(0.1)


@pytest.mark.asyncio
async def test_challenge(pager, server):
    requests = [{'func': 'fib', 'args': [20]}, {'func': 'fib', 'args': [21]}]
    assert await runtime_client('execute', requests, True) == [6765, 10946]


@pytest.mark.asyncio
async def test_live_student_code(pager, server, move_module):
    requests = [{'func': 'challenge', 'args': [1]}]
    assert await runtime_client('execute', requests, True) == [2]


@pytest.mark.asyncio
async def test_device_disconnect(pager, server):
    start_limit_switch = functools.partial(
        runtime_cli,
        'emulate-dev',
        '1:{"switch0":true}',
        stdout=asyncio.subprocess.DEVNULL,
    )
    requests = [{'func': 'read_limit_switch', 'args': [2], 'timeout': 2.1}]
    async with start_limit_switch() as (dev_task, _):
        await asyncio.sleep(0.2)
        client = asyncio.create_task(runtime_client('execute', requests, True))
        await asyncio.sleep(1)
    await asyncio.gather(dev_task, asyncio.sleep(0.2))
    async with start_limit_switch():
        await asyncio.sleep(0.2)
        (readings,) = await client
    current = None
    readings = [current := reading for reading in readings if reading is not current]
    assert readings == [True, False, True]
