import asyncio
from pathlib import Path

import click
import pytest
import structlog
import zmq

import runtime
from runtime import rpc
from runtime.__main__ import cli, load_catalog
from runtime.buffer import BufferManager
from runtime.service.broker import Broker


@pytest.fixture(scope='module')
def catalog():
    catalog_path = Path(runtime.__file__).parent / 'catalog.yaml'
    yield load_catalog(catalog_path)


@pytest.fixture
def buffers(catalog):
    with BufferManager(catalog) as buffers:
        yield buffers
    BufferManager.unlink_all()


@pytest.fixture
async def update_publisher(mocker):
    publisher = rpc.Client(rpc.SocketNode(socket_type=zmq.PUB))
    mocker.patch.object(publisher.call, 'update', autospec=True)
    publisher.call.update.return_value = future = asyncio.Future()
    future.set_result(None)
    yield publisher


@pytest.fixture
async def client(mocker):
    client = rpc.Client(rpc.SocketNode(socket_type=zmq.DEALER))
    mocker.patch.object(client.call, 'list_uids', autospec=True)
    yield client


@pytest.fixture
async def broker(update_publisher, client, buffers):
    args = [
        '--exec-module=testcode.lint',
        '--dev-name=left_motor:309480287454862199079567360',
        'start',
    ]
    with cli.make_context('cli', args) as ctx:
        broker = Broker(ctx, update_publisher, client, buffers)
        limit_switch = broker.buffers.get_or_create(0x0000_00_ffffffff_ffffffff)
        limit_switch.set('switch0', True)
        limit_switch.set('switch1', False)
        limit_switch.set('switch2', True)
        broker.buffers.stack.close()
        broker.buffers[0x0000_00_ffffffff_ffffffff].valid = True
        yield broker


@pytest.mark.asyncio
async def test_option(broker):
    assert await broker.get_option('exec_module') == 'testcode.lint'
    await broker.set_option({'exec_module': 'testcode'})
    await broker.set_option({'router_backend': 'ipc:///tmp/rt.sock'})
    options = await broker.get_option()
    assert options['exec_module'] == 'testcode'
    assert options['router_backend'] == ['ipc:///tmp/rt.sock']
    await broker.set_option({'router_backend': [], 'help': True, 'version': True, 'debug': False})
    router_backends = sorted(await broker.get_option('router_frontend'))
    assert router_backends == sorted({'tcp://*:6000', 'ipc:///tmp/rt-rpc.sock'})
    with pytest.raises(click.BadParameter):
        await broker.set_option({'client_option': 'BADOPTION:1'})


@pytest.mark.asyncio
async def test_lint(broker):
    record1, record2 = await broker.lint()
    assert record1['symbol'] == 'undefined-variable'
    assert record1['category'] == 'error'
    assert record1['msg'] == "Undefined variable 'doesnt_exist'"
    assert record2['symbol'] == 'global-statement'
    assert record2['category'] == 'warning'
    assert record2['msg'] == 'Using the global statement'


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
    broker.client.call.list_uids.return_value = future = asyncio.Future()
    future.set_result([str(0x0_00_ffffffff_ffffffff)])
    await broker.update_uids()
    await broker.send_update()
    broker.update_publisher.call.update.assert_called_with(
        {str(0x0000_00_ffffffff_ffffffff): {'switch0': True, 'switch1': False, 'switch2': True}},
        notification=True,
    )
    broker.client.call.list_uids.return_value = future = asyncio.Future()
    future.set_result([
        str(0x0000_00_ffffffff_ffffffff),
        str(0x0000_ff_ffffffff_ffffffff),
        str(0xffff_ff_ffffffff_ffffffff),
    ])
    await broker.update_uids()
    await broker.send_update()
    broker.update_publisher.call.update.assert_called_with(
        {str(0x0000_00_ffffffff_ffffffff): {}},
        notification=True,
    )
