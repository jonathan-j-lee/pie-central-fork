import asyncio
from pathlib import Path

import click
import pytest
import zmq

import runtime
from runtime import remote
from runtime.buffer import BufferStore
from runtime.cli import cli, load_yaml
from runtime.service.broker import Broker


@pytest.fixture(scope='module')
def catalog():
    catalog_path = Path(runtime.__file__).parent / 'catalog.yaml'
    yield BufferStore.make_catalog(load_yaml(catalog_path))


@pytest.fixture
def buffers(catalog):
    with BufferStore(catalog) as buffers:
        yield buffers
    BufferStore.unlink_all()


@pytest.fixture
async def update_publisher(mocker):
    publisher = remote.Client(remote.SocketNode(socket_type=zmq.PUB))
    mocker.patch.object(publisher.call, 'update', autospec=True)
    future = asyncio.get_running_loop().create_future()
    publisher.call.update.return_value = future
    future.set_result(None)
    yield publisher


@pytest.fixture
async def client(mocker):
    client = remote.Client(remote.SocketNode(socket_type=zmq.DEALER))
    mocker.patch.object(client.call, 'list_uids', autospec=True)
    yield client


@pytest.fixture
async def broker(update_publisher, client, buffers):
    args = [
        '--exec-module=testcode.lint',
        '--dev-name=left_motor:309480287454862199079567360',
        'server',
    ]
    with cli.make_context('cli', args) as ctx:
        ctx.obj.options.update(ctx.params)
        broker = Broker(ctx, update_publisher, client, buffers)
        limit_switch = broker.buffers.get_or_open(0x0000_00_FFFFFFFF_FFFFFFFF)
        limit_switch.set('switch0', True)
        limit_switch.set('switch1', False)
        limit_switch.set('switch2', True)
        broker.buffers.stack.close()
        broker.buffers[0x0000_00_FFFFFFFF_FFFFFFFF].valid = True
        broker.logger = broker.logger.bind()
        yield broker


@pytest.mark.asyncio
async def test_option(broker):
    assert await broker.get_option('exec_module') == 'testcode.lint'
    await broker.set_option({'exec_module': 'testcode'})
    await broker.set_option({'router_backend': 'ipc:///tmp/rt.sock'})
    options = await broker.get_option()
    assert options['exec_module'] == 'testcode'
    assert options['router_backend'] == ['ipc:///tmp/rt.sock']
    options = {'router_backend': [], 'help': True, 'version': True, 'debug': False}
    await broker.set_option(options)
    router_backends = sorted(await broker.get_option('router_frontend'))
    assert router_backends == sorted({'tcp://*:6000', 'ipc:///tmp/rt-rpc.sock'})
    with pytest.raises(click.BadParameter):
        await broker.set_option({'client_option': 'BADOPTION:1'})


@pytest.mark.asyncio
async def test_lint(broker):
    record1, record2, record3 = sorted(
        await broker.lint(),
        key=lambda record: record['symbol'],
    )
    assert record1['symbol'] == 'global-statement'
    assert record1['type'] == 'warning'
    assert record1['message'] == 'Using the global statement'
    assert record2['symbol'] == 'invalid-name'
    assert record2['type'] == 'convention'
    assert record3['symbol'] == 'undefined-variable'
    assert record3['type'] == 'error'
    assert record3['message'] == "Undefined variable 'doesnt_exist'"


@pytest.mark.asyncio
async def test_gamepad_update(broker):
    update1 = {
        '0': {'lx': -0.5, 'ly': -1, 'rx': 1, 'ry': 0.5, 'btn': 0b1},
    }
    update2 = {
        '0': {'lx': -0.7, 'ry': 0.7, 'btn': 0b110},
        '1': {'lx': 0.7},
    }
    update3 = {
        '1': {'lx': -0.5},
    }
    broker.update_gamepads(update1)
    buf0 = broker.buffers['gamepad', 0]
    assert buf0.get('joystick_left_x') == pytest.approx(-0.5)
    assert buf0.get('joystick_left_y') == pytest.approx(-1)
    assert buf0.get('joystick_right_x') == pytest.approx(1)
    assert buf0.get('joystick_right_y') == pytest.approx(0.5)
    assert buf0.get('button_a')
    assert not buf0.get('button_b')
    assert not buf0.get('button_x')
    broker.update_gamepads(update2)
    assert buf0.get('joystick_left_x') == pytest.approx(-0.7)
    assert buf0.get('joystick_left_y') == pytest.approx(-1)
    assert buf0.get('joystick_right_x') == pytest.approx(1)
    assert buf0.get('joystick_right_y') == pytest.approx(0.7)
    assert not buf0.get('button_a')
    assert buf0.get('button_b')
    assert buf0.get('button_x')
    buf1 = broker.buffers['gamepad', 1]
    assert buf1.get('joystick_left_x') == pytest.approx(0.7)
    assert not buf1.get('button_a')
    assert not buf1.get('button_b')
    assert not buf1.get('button_x')
    broker.update_gamepads(update3)
    assert buf0.get('joystick_left_x') == pytest.approx(-0.7)
    assert buf0.get('joystick_left_y') == pytest.approx(-1)
    assert buf0.get('joystick_right_x') == pytest.approx(1)
    assert buf0.get('joystick_right_y') == pytest.approx(0.7)
    assert buf1.get('joystick_left_x') == pytest.approx(-0.5)


@pytest.mark.asyncio
async def test_send_update(broker):
    await broker.send_update()
    broker.update_publisher.call.update.assert_called_with({}, notification=True)
    future = asyncio.get_running_loop().create_future()
    broker.client.call.list_uids.return_value = future
    future.set_result([str(0x0_00_FFFFFFFF_FFFFFFFF)])
    await broker.update_uids()
    await broker.send_update()
    update = {
        str(0x0000_00_FFFFFFFF_FFFFFFFF): {
            'switch0': True,
            'switch1': False,
            'switch2': True,
        },
    }
    broker.update_publisher.call.update.assert_called_with(update, notification=True)
    future = asyncio.get_running_loop().create_future()
    broker.client.call.list_uids.return_value = future
    uids = [
        str(0x0000_00_FFFFFFFF_FFFFFFFF),
        str(0x0000_FF_FFFFFFFF_FFFFFFFF),
        str(0xFFFF_FF_FFFFFFFF_FFFFFFFF),
    ]
    future.set_result(uids)
    await broker.update_uids()
    await broker.send_update()
    broker.update_publisher.call.update.assert_called_with(
        {str(0x0000_00_FFFFFFFF_FFFFFFFF): {}},
        notification=True,
    )
