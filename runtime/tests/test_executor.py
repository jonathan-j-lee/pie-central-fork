import asyncio
import inspect
import re
import signal
import threading
import types

from runtime import api, process
from runtime.service.executor import (
    handle_timeout,
    run_once,
    ExecutionError,
    ExecutionRequest,
    AsyncExecutor,
    Dispatcher,
    main,
)

import pytest


@pytest.fixture
def dispatcher():
    timeouts = {
        re.compile(r'.*_setup'): 1,
        re.compile(r'.*_main'): 0.1,
    }
    dispatcher = Dispatcher(
        None,
        'testcode.incr',
        timeouts,
        async_exec=AsyncExecutor(max_actions=2),
    )
    methods = {'debug', 'info', 'warn', 'warning', 'error', 'critical'}
    methods = {method: (lambda *args, **kwargs: None) for method in methods}
    dispatcher.logger = types.SimpleNamespace(sync_bl=types.SimpleNamespace(**methods))
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
        assert callable(func) and not inspect.iscoroutinefunction(func)
    assert dispatcher.student_code.Alliance is api.Alliance


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
    counts = []
    async def main():
        try:
            await asyncio.to_thread(dispatcher.sync_exec.schedule, ExecutionRequest())
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
        finally:
            dispatcher.sync_exec.stop()
    service_thread = threading.Thread(target=lambda: asyncio.run(main()), daemon=True)
    service_thread.start()
    dispatcher.sync_exec.execute_forever()
    service_thread.join()
    auto_counts, teleop_counts, idle_counts = counts
    assert auto_counts == {'autonomous_setup': 1, 'autonomous_main': 5}
    assert teleop_counts, idle_counts == {'teleop_setup': 1, 'teleop_main': 5}


@pytest.mark.asyncio
async def test_sync_not_main_thread(dispatcher):
    with pytest.raises(ExecutionError):
        await asyncio.to_thread(dispatcher.sync_exec.execute_forever)


def make_action():
    async def waiter(done: asyncio.Event):
        await done.wait()
    return waiter


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
