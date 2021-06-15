import asyncio
import inspect
import re
import signal
import threading
import types
from pathlib import Path
from unittest.mock import ANY

import runtime
from runtime import api, process
from runtime.__main__ import load_yaml
from runtime.buffer import BufferManager, DeviceBufferError
from runtime.exception import EmergencyStopException
from runtime.service.executor import (
    run_once,
    ExecutionError,
    ExecutionRequest,
    AsyncExecutor,
    Dispatcher,
    main,
)

import pytest


@pytest.fixture(scope='module')
def catalog():
    catalog_path = Path(runtime.__file__).parent / 'catalog.yaml'
    yield BufferManager.make_catalog(load_yaml(catalog_path))


@pytest.fixture
def buffers(catalog):
    with BufferManager(catalog, shared=False) as buffers:
        yield buffers


@pytest.fixture
def dispatcher(mocker, buffers):
    timeouts = {
        re.compile(r'.*_setup'): 1,
        re.compile(r'.*_main'): 0.1,
    }
    dispatcher = Dispatcher(
        buffers,
        'testcode.incr',
        timeouts,
        {'left-motor': 0xc_00_00000000_00000000},
        async_exec=AsyncExecutor(max_actions=2),
        logger=types.SimpleNamespace(),
    )
    mocker.patch.object(dispatcher, 'logger')
    dispatcher.reload()
    yield dispatcher


@pytest.fixture
async def async_exec(dispatcher):
    dispatch = asyncio.create_task(dispatcher.async_exec.dispatch(cooldown=0.1), name='dispatch')
    while dispatcher.async_exec.loop is None:
        await asyncio.sleep(0.05)
    yield dispatcher.async_exec
    dispatch.cancel()


def test_import(dispatcher):
    dispatcher.prepare_student_code_run([])
    func_names = (
        'challenge',
        'autonomous_setup',
        'autonomous_main',
        'teleop_setup',
        'teleop_main',
    )
    for func_name in func_names:
        func = getattr(dispatcher.student_code, func_name)
        assert callable(func)
        assert not inspect.iscoroutinefunction(func)
    mod = dispatcher.student_code
    assert mod.Alliance is api.Alliance
    assert isinstance(mod.Actions, api.Actions)
    assert isinstance(mod.Robot, api.Robot)
    assert isinstance(mod.Gamepad, api.Gamepad)
    assert isinstance(mod.Field, api.Field)
    assert callable(mod.print)
    assert not inspect.iscoroutinefunction(mod.print)


def test_reload(dispatcher):
    dispatcher.prepare_student_code_run([])
    assert dispatcher.student_code.challenge(1) == 2
    dispatcher.student_code.challenge = lambda x: x + 2
    assert dispatcher.student_code.challenge(1) == 3
    dispatcher.prepare_student_code_run([])
    assert dispatcher.student_code.challenge(1) == 2


def test_bad_imports(dispatcher):
    dispatcher.student_code = types.ModuleType('testcode.badsyntax')
    requests = [{'func': 'teleop_setup'}]
    with pytest.raises(SyntaxError):
        dispatcher.prepare_student_code_run(requests)
    dispatcher.student_code = types.ModuleType('testcode.nohalt')
    with pytest.raises(ExecutionError):
        run_once(dispatcher.prepare_student_code_run, [], timeout=0.1)


def test_sync_queueing(dispatcher):
    requests = [
        {'func': 'teleop_setup'},
        {'func': 'invalid'},
        {'func': 'counters'},
        {'func': 'teleop_main'},
        {'func': 'challenge', 'args': [0xdeadbeef]},
        {'func': 'challenge', 'args': [0xc0debeef], 'timeout': 0.5},
    ]
    dispatcher.prepare_student_code_run(requests)
    from testcode import incr as studentcode
    assert dispatcher.sync_exec.requests.get_nowait() == ExecutionRequest(
        func=studentcode.teleop_setup,
        timeout=pytest.approx(1),
    )
    assert dispatcher.sync_exec.requests.get_nowait() == ExecutionRequest(
        func=studentcode.teleop_main,
        timeout=pytest.approx(0.1),
    )
    assert dispatcher.sync_exec.requests.get_nowait() == ExecutionRequest(
        func=studentcode.challenge,
        args=[0xdeadbeef],
        timeout=pytest.approx(1),
    )
    assert dispatcher.sync_exec.requests.get_nowait() == ExecutionRequest(
        func=studentcode.challenge,
        args=[0xc0debeef],
        timeout=pytest.approx(0.5),
    )
    assert dispatcher.sync_exec.requests.empty()


def test_sync_queueing_blank(dispatcher):
    dispatcher.student_code = types.ModuleType('testcode.blank')
    requests = [{'func': 'teleop_setup'}, {'func': 'teleop_main', 'periodic': True}]
    dispatcher.prepare_student_code_run(requests)
    assert dispatcher.sync_exec.requests.empty()


@pytest.mark.slow
@pytest.mark.asyncio
async def test_sync_dispatch(dispatcher):
    counts, result = [], []
    async def main():
        try:
            await dispatcher.execute([{'func': 'bad'}])
            await dispatcher.auto()
            await asyncio.sleep(0.45)
            counts.append(dict(dispatcher.student_code.counters))
            await dispatcher.teleop()
            # The delay has been bumped up here because the fifth cycle of ``autonomous_main`` will
            # still be running with ~0.05 s to go.
            await asyncio.sleep(0.5)
            counts.append(dict(dispatcher.student_code.counters))
            await dispatcher.idle()
            await asyncio.sleep(0.3)
            counts.append(dict(dispatcher.student_code.counters))
            await dispatcher.execute([{'func': 'bad', 'periodic': True}])
            requests = [
                {'func': 'challenge', 'args': [1]},
                {'func': 'challenge', 'args': [2]},
            ]
            result.extend(await dispatcher.execute(requests, block=True))
        finally:
            dispatcher.sync_exec.stop()
    service_thread = threading.Thread(target=lambda: asyncio.run(main()), daemon=True)
    service_thread.start()
    dispatcher.sync_exec.execute_forever()
    service_thread.join()
    auto_counts, teleop_counts, idle_counts = counts
    assert auto_counts == {'autonomous_setup': 1, 'autonomous_main': 5}
    assert teleop_counts, idle_counts == {'teleop_setup': 1, 'teleop_main': 5}
    assert result == [2, 3]


@pytest.mark.asyncio
async def test_estop(dispatcher):
    service_thread = threading.Thread(target=dispatcher.estop, daemon=True)
    service_thread.start()
    with pytest.raises(EmergencyStopException):
        dispatcher.sync_exec.execute_forever()
    service_thread.join()


@pytest.mark.asyncio
async def test_sync_not_main_thread(dispatcher):
    with pytest.raises(ExecutionError):
        await asyncio.to_thread(dispatcher.sync_exec.execute_forever)


def make_action():
    async def waiter(done: asyncio.Event):
        await done.wait()
    return waiter


@pytest.mark.asyncio
async def test_actions_result(async_exec):
    loop = asyncio.get_running_loop()
    async def func() -> int:
        return 0xdeadbeef
    request = ExecutionRequest(func=func, loop=loop, future=loop.create_future())
    async_exec.schedule(request)
    assert await request.future == 0xdeadbeef



@pytest.mark.asyncio
async def test_actions_exc(async_exec):
    loop = asyncio.get_running_loop()
    async def func():
        raise OSError
    request = ExecutionRequest(func=func, loop=loop, future=loop.create_future())
    async_exec.schedule(request)
    with pytest.raises(OSError):
        await request.future


@pytest.mark.asyncio
async def test_actions_unique(async_exec):
    done, action = asyncio.Event(), make_action()
    baseline_count = len(asyncio.all_tasks())
    async_exec.run(action, done)
    await asyncio.sleep(0.1)
    assert async_exec.is_running(action)
    assert len(asyncio.all_tasks()) == baseline_count + 2
    async_exec.run(action, done)
    await asyncio.sleep(0.1)
    assert async_exec.is_running(action)
    assert len(asyncio.all_tasks()) == baseline_count + 2
    done.set()


@pytest.mark.asyncio
async def test_max_actions(async_exec):
    done = asyncio.Event()
    action1, action2, action3 = make_action(), make_action(), make_action()
    async_exec.schedule(ExecutionRequest())
    async_exec.run(action1, done)
    async_exec.run(action2, done)
    async_exec.run(action3, done)
    await asyncio.sleep(0.2)
    assert async_exec.is_running(action1)
    assert async_exec.is_running(action2)
    assert not async_exec.is_running(action3)
    done.set()


@pytest.mark.asyncio
async def test_actions_timeout(async_exec):
    done, action = asyncio.Event(), make_action()
    async_exec.run(action, done, timeout=0.2)
    await asyncio.sleep(0.1)
    assert async_exec.is_running(action)
    await asyncio.sleep(0.2)
    assert not async_exec.is_running(action)


@pytest.mark.asyncio
async def test_action_periodic(async_exec):
    ctr = 0
    async def incr():
        nonlocal ctr
        ctr += 1
    async_exec.run(incr, periodic=True, timeout=0.1)
    await asyncio.sleep(0.35)
    assert async_exec.is_running(incr)
    assert ctr == 4


@pytest.mark.asyncio
async def test_actions_cancel(async_exec):
    done = asyncio.Event()
    action1, action2 = make_action(), make_action()
    async_exec.run(action1, done)
    async_exec.run(action2, done)
    await asyncio.sleep(0.1)
    assert async_exec.is_running(action1)
    assert async_exec.is_running(action2)
    await asyncio.to_thread(async_exec.cancel)
    await asyncio.sleep(0.1)
    assert not async_exec.is_running(action1)
    assert not async_exec.is_running(action2)
    async_exec.run(action1, done)
    async_exec.run(action2, done)
    await asyncio.sleep(0.1)
    assert async_exec.is_running(action1)
    assert async_exec.is_running(action2)
    done.set()


@pytest.mark.asyncio
async def test_actions_stop(async_exec):
    task_count = len(asyncio.all_tasks())
    done, action = asyncio.Event(), make_action()
    async_exec.run(action, done)
    await asyncio.sleep(0.1)
    assert async_exec.is_running(action)
    async_exec.stop()
    await asyncio.sleep(0.1)
    assert not async_exec.is_running(action)
    assert len(asyncio.all_tasks()) == task_count - 1  # The ``dispatch`` task is gone.


@pytest.mark.parametrize('key,create,param,value', [
    (('gamepad', 0), True, 'joystick_left_x', 0.123),
    (('gamepad', 0), False, 'joystick_left_x', 0),
    (('gamepad', 0), True, 'button_a', True),
    (('gamepad', 0), False, 'button_a', False),
    (0xc_00_00000000_00000000, True, 'duty_cycle', -0.456),
    (0xc_00_00000000_00000000, False, 'duty_cycle', 0),
])
def test_device_get(key, create, param, value, dispatcher):
    if create:
        dispatcher.buffers.get_or_create(key).set(param, value)
    if isinstance(value, float):
        value = pytest.approx(value)
    if isinstance(key, int):
        assert dispatcher.student_code.Robot.get(key, param) == value
    else:
        assert dispatcher.student_code.Gamepad.get(param) == value
    if not create:
        dispatcher.logger.sync_bl.warn.assert_called_once_with(
            'Device does not exist',
            exc_info=ANY,
            type=ANY,
            param=param,
            default=value,
        )


@pytest.mark.parametrize('key', [('gamepad', 0), 0xc_00_00000000_00000000])
def test_device_get_no_param(key, dispatcher):
    dispatcher.buffers.get_or_create(key)
    if isinstance(key, int):
        assert dispatcher.student_code.Robot.get(key, 'not_a_param') is None
    else:
        assert dispatcher.student_code.Gamepad.get('not_a_param') is None
    dispatcher.logger.sync_bl.error.assert_called_once_with(
        'get(...) raised an error',
        exc_info=ANY,
    )


def test_robot_get_writeonly(dispatcher):
    dispatcher.buffers.get_or_create(0xc_00_00000000_00000000)
    assert dispatcher.student_code.Robot.get(
        0xc_00_00000000_00000000,
        'pid_pos_setpoint',
    ) == pytest.approx(0)
    dispatcher.logger.sync_bl.warn.assert_called_once_with(
        'Unable to get parameter',
        exc_info=ANY,
        type='polar-bear',
        param='pid_pos_setpoint',
        default=pytest.approx(0),
    )


def test_robot_get_name_translation(dispatcher):
    dispatcher.buffers.get_or_create(0xc_00_00000000_00000000).set('duty_cycle', 0.123)
    assert dispatcher.student_code.Robot.get('left-motor', 'duty_cycle') == pytest.approx(0.123)
    assert dispatcher.student_code.Robot.get('right-motor') is None
    dispatcher.logger.sync_bl.error.assert_called_once_with(
        'get(...) raised an error',
        exc_info=ANY,
    )


def test_robot_write(dispatcher):
    buffer = dispatcher.buffers.get_or_create(0xc_00_00000000_00000000)
    dispatcher.student_code.Robot.write(0xc_00_00000000_00000000, 'duty_cycle', 0.123)
    assert buffer.get_write() == {'duty_cycle': pytest.approx(0.123)}


def test_robot_write_readonly(dispatcher):
    dispatcher.buffers.get_or_create(0)
    dispatcher.student_code.Robot.write(0, 'switch0', True)
    dispatcher.logger.sync_bl.error.assert_called_once_with(
        'write(...) raised an error',
        exc_info=ANY,
    )


def test_robot_write_name_translation(dispatcher):
    buffer = dispatcher.buffers.get_or_create(0xc_00_00000000_00000000)
    dispatcher.student_code.Robot.write('left-motor', 'duty_cycle', 0.456)
    assert buffer.get_write() == {'duty_cycle': pytest.approx(0.456)}
    assert dispatcher.student_code.Robot.write('right-motor', 'duty_cycle', 0.456) is None
    dispatcher.logger.sync_bl.error.assert_called_once_with(
        'write(...) raised an error',
        exc_info=ANY,
    )


def test_gamepad_disabled(dispatcher):
    dispatcher.reload(enable_gamepads=False)
    Gamepad = dispatcher.student_code.Gamepad
    assert Gamepad.get('joystick_left_x') == pytest.approx(0)
    dispatcher.logger.sync_bl.error.assert_called_once_with(
        'Gamepad is not enabled in autonomous',
        param='joystick_left_x',
        index=0,
    )
