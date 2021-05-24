"""Smart Device Management."""

import abc
import asyncio
import contextlib
import dataclasses
import glob
from numbers import Real
from pathlib import Path
from typing import ClassVar, Iterable, Optional, Union
from urllib.parse import urlsplit

import serial
import serial_asyncio as aioserial
import structlog
from serial.tools import list_ports

from .. import process, rpc
from ..buffer import BufferManager, DeviceBuffer, DeviceUID, RuntimeBufferError
from ..exception import RuntimeBaseException
from ..messaging import Message, MessageError, MessageType

HAS_UDEV = True
try:
    import pyudev
except ImportError:  # pragma: no cover; platform-dependent
    HAS_UDEV = False

__all__ = [
    'DeviceError',
    'PollingObserver',
    'SmartDeviceClient',
    'SmartDeviceManager',
    'main',
]


class DeviceError(RuntimeBaseException):
    """General device error."""


class SmartDeviceObserver(abc.ABC):
    """Watch for recently connected Smart Devices."""

    @abc.abstractmethod
    async def get_ports(self) -> set[Path]:
        """Retrieve a set of serial ports of recently connected devices."""


if HAS_UDEV:  # pragma: no cover; platform-dependent
    __all__.append('EventObserver')

    @dataclasses.dataclass
    class EventObserver(SmartDeviceObserver):
        """Detect Smart Devices using Linux's udev.

        Attributes:
            devices: A queue of batches of detected devices. The devices are batched to reduce
                expensive calls to :func:`list_ports.comports`.
        """

        devices: asyncio.Queue[list[pyudev.Device]] = dataclasses.field(
            default_factory=lambda: asyncio.Queue(128),
        )
        context: pyudev.Context = dataclasses.field(default_factory=pyudev.Context)
        monitor: pyudev.Monitor = None

        SUBSYSTEM: ClassVar[str] = 'usb'
        DEVICE_TYPE: ClassVar[str] = 'usb_interface'
        VENDOR_ID: ClassVar[int] = 0x2341
        PRODUCT_ID: ClassVar[int] = 0x8037

        def __post_init__(self):
            self.monitor = self.monitor or pyudev.Monitor.from_netlink(self.context)
            self.monitor.filter_by(self.SUBSYSTEM, self.DEVICE_TYPE)

        @classmethod
        def is_sensor(cls, device: pyudev.Device) -> bool:
            """Determine whether a udev device is a Smart Sensor."""
            try:
                vendor_id, product_id, _ = device.properties['PRODUCT'].split('/')
                return int(vendor_id, 16) == cls.VENDOR_ID and int(product_id, 16) == cls.PRODUCT_ID
            except (KeyError, ValueError):
                return False

        def handle_devices(self, devices: Iterable[pyudev.Device]):
            """Callback for handling newly connected devices."""
            valid_devices = []
            for device in devices:
                if self.is_sensor(device) and device.action in {None, 'add'}:
                    valid_devices.append(device)
            if valid_devices:
                with contextlib.suppress(asyncio.QueueFull):
                    self.devices.put_nowait(valid_devices)

        async def start(self):
            """Begin monitoring udev events and register initially connected devices."""
            asyncio.get_running_loop().add_reader(self.monitor.fileno(), self.on_new_events)
            self.monitor.start()
            devices = await asyncio.to_thread(self.context.list_devices, subsystem=self.SUBSYSTEM)
            self.handle_devices(devices)

        def on_new_events(self):
            """Callback when new udev events are available."""
            self.handle_devices(iter(lambda: self.monitor.poll(0), None))

        async def get_ports(self) -> set[Path]:
            if not self.monitor.started:
                await self.start()
            devices = await self.devices.get()
            ports = await asyncio.to_thread(list_ports.comports, include_links=True)
            paths = set()
            for port in ports:
                if port.location and any(port.location in device.sys_path for device in devices):
                    paths.add(Path(port.device))
            return paths


@dataclasses.dataclass
class PollingObserver(SmartDeviceObserver):
    """Detect Smart Devices by polling the filesystem.

    This observer exists for portability on systems without udev.
    """

    patterns: frozenset[str] = frozenset({'/dev/ttyACM*'})
    interval: Real = 1
    ports: set[Path] = dataclasses.field(default_factory=set)

    def __post_init__(self):
        self.patterns = frozenset(self.patterns)

    async def get_ports(self) -> set[Path]:
        ports = set()
        for pattern in self.patterns:
            ports.update(map(Path, await asyncio.to_thread(glob.glob, pattern)))
        await asyncio.sleep(self.interval)
        new_ports = ports - self.ports
        self.ports.clear()
        self.ports.update(ports)
        return new_ports


def make_observer():
    """Make an observer suitable for this platform."""
    return EventObserver() if HAS_UDEV else PollingObserver()


@dataclasses.dataclass
class SmartDevice(abc.ABC):
    """A sensor or actuator that uses the Smart Device protocol.

    Attributes:
        reader: Stream reader.
        writer: Stream writer.
        buffer: Shared memory buffer, which is initialized once the device type is discovered.
        hb_requests: Maps the IDs of in-flight heartbeat requests to events set once the response
            arrives.
        read_queue: A queue of messages read from the device.
        write_queue: A queue of messages waiting to be written to the device.
        logger: A logger instance bound to device context data.
    """

    reader: asyncio.StreamReader
    writer: asyncio.StreamWriter
    buffer: Optional[DeviceBuffer] = None
    requests: rpc.RequestTracker = dataclasses.field(
        default_factory=lambda: rpc.RequestTracker(upper=256),
    )
    read_queue: asyncio.Queue[Message] = dataclasses.field(
        default_factory=lambda: asyncio.Queue(128),
    )
    write_queue: asyncio.Queue[Message] = dataclasses.field(
        default_factory=lambda: asyncio.Queue(128),
    )
    logger: structlog.stdlib.AsyncBoundLogger = dataclasses.field(
        default_factory=lambda: structlog.get_logger(
            wrapper_class=structlog.stdlib.AsyncBoundLogger,
        ),
    )

    async def read_messages(self):
        """Read inbound messages indefinitely.

        Raises:
            serial.SerialException: If the serial transport becomes unavailable.
        """
        while True:
            try:
                buf = await self.reader.readuntil(separator=Message.DELIM)
                buf_view = memoryview(buf)[: -len(Message.DELIM)]
                message = await asyncio.to_thread(Message.decode, buf_view)
                await self.read_queue.put(message)
                await self.logger.debug('Read message', type=message.type.name)
            except (MessageError, RuntimeBufferError) as exc:
                await self.logger.error('Device read error', exc_info=exc)

    async def write_messages(self):
        """Write outbound messages indefinitely.

        Raises:
            serial.SerialException: If the serial transport becomes unavailable.
        """
        write_buf = bytearray(Message.MAX_ENCODING_SIZE)
        while True:
            try:
                message = await self.write_queue.get()
                size = await asyncio.to_thread(message.encode_into_buf, write_buf)
                self.writer.write(memoryview(write_buf)[:size])
                self.writer.write(Message.DELIM)
                await self.logger.debug('Wrote message', type=message.type.name)
            except (MessageError, RuntimeBufferError) as exc:
                await self.logger.error('Device write error', exc_info=exc)

    async def heartbeat(
        self,
        heartbeat_id: Optional[int] = None,
        timeout: Real = 1,
        block: bool = True,
    ):
        """Send a heartbeat request.

        Arguments:
            heartbeat_id: A one-byte heartbeat identifier. If not provided, a unique ID is randomly
                generated.
            timeout: The duration in seconds to wait for the response to return.
            block: Whether to wait for the heartbeat response.

        Raises:
            ValueError: If the heartbeat ID is not unique. Either a non-unique ID was provided, or
                the ID generator could not produce a unique ID.
            asyncio.TimeoutError: If the timeout is exhausted.
        """
        with self.requests.new_request(heartbeat_id) as (request_id, result):
            message = await asyncio.to_thread(Message.make_hb_req, request_id)
            await self.write_queue.put(message)
            if block:
                return await asyncio.wait_for(result, timeout)

    @contextlib.asynccontextmanager
    async def communicate(self) -> set[asyncio.Task]:
        """Context manager to start and stop reading and writing messages."""
        async with contextlib.AsyncExitStack() as stack:
            stack.push_async_callback(self.logger.info, 'Device closed')
            stack.callback(self.writer.close)
            read_task = asyncio.create_task(self.read_messages(), name='dev-read')
            write_task = asyncio.create_task(self.write_messages(), name='dev-write')
            stack.callback(read_task.cancel)
            stack.callback(write_task.cancel)
            await self.logger.info('Device opened')
            try:
                yield {read_task, write_task}
            except asyncio.TimeoutError as exc:
                await self.logger.error('Device type not discovered', exc_info=exc)
            except serial.SerialException as exc:
                await self.logger.error('Device disconnected', exc_info=exc)

    @abc.abstractmethod
    async def handle_messages(self):
        """Handle inbound messages indefinitely."""


class SmartDeviceClient(SmartDevice):
    async def ping(self):
        """Ping the sensor to receive a subscription response."""
        await self.write_queue.put(Message.make_ping())

    async def disable(self):
        """Disable the sensor."""
        await self.write_queue.put(Message.make_dev_disable())

    async def subscribe(self, params: Optional[list[str]] = None, interval: Real = 0.04):
        """Receive periodic updates for zero or more parameters.

        Arguments:
            params: A list of parameter names.
            interval: The duration between subscription updates in seconds.

        Raises:
            OverflowError: If interval cannot fit in an unsigned 16-bit integer.
        """
        if not params:
            params = [param.name for param in self.buffer.params if param.subscribed]
            interval = getattr(self.buffer, 'interval', interval)
        sub_req = await asyncio.to_thread(
            Message.make_sub_req,
            self.buffer.to_bitmap(params),
            int(1000 * interval),
        )
        await self.write_queue.put(sub_req)

    async def unsubscribe(self):
        """Stop receiving subscription updates."""
        await self.write_queue.put(Message.make_unsubscribe())

    def handle_sub_res(self, message: Message):
        """Copy subscription/UID information into the internal buffer.

        Raises:
            MessageError: If the message does not have the :attr:``MessageType.SUB_REQ`` type or is
                otherwise unable to be read.
        """
        with self.buffer.operation():
            uid = int(self.buffer.uid)
            self.logger = self.logger.bind(uid=uid)
            self.buffer.set_subscription(message)
            self.logger.sync_bl.info(
                'Received subscription response',
                type=type(self.buffer).__name__,
                uid=uid,
                params=self.buffer.subscription,
                delay=self.buffer.delay,
            )

    async def discover(self, buffers: BufferManager, *, interval: Real = 1) -> DeviceUID:
        """Identify information about a newly connected device.

        This method periodically pings the device to get a subscription response, which contains
        the current subscription and the UID. Once the UID is known, the device allocates a buffer.

        Arguments:
            buffers: The buffer manager that will allocate the buffer.
            interval: The delay in seconds between pings.
        """
        ping = asyncio.create_task(process.spin(self.ping, interval=interval))
        try:
            while True:
                message = await self.read_queue.get()
                if message.type is MessageType.SUB_RES:
                    _, _, uid = message.read_sub_res()
                    self.buffer = await asyncio.to_thread(buffers.get_or_create, DeviceUID(*uid))
                    await asyncio.to_thread(self.handle_sub_res, message)
                    return self.buffer.uid
        finally:
            ping.cancel()

    async def handle_messages(self):
        if not self.buffer:
            raise DeviceError('device buffer not initialized')
        while True:
            message = await self.read_queue.get()
            try:
                if message.type is MessageType.HB_REQ:
                    response = await asyncio.to_thread(Message.make_hb_res, message.read_hb_req())
                    await self.write_queue.put(response)
                elif message.type is MessageType.HB_RES:
                    heartbeat_id = message.read_hb_res()
                    try:
                        self.requests.register_response(heartbeat_id, None)
                    except KeyError as exc:
                        raise MessageError(
                            'unknown heartbeat response ID',
                            heartbeat_id=heartbeat_id,
                        ) from exc
                elif message.type is MessageType.SUB_RES:
                    await asyncio.to_thread(self.handle_sub_res, message)
                elif message.type is MessageType.DEV_DATA:
                    await asyncio.to_thread(self.buffer.update_data, message)
                elif message.type is MessageType.ERROR:
                    raise MessageError(
                        'error message received',
                        error_code=message.read_error().name,
                    )
                else:
                    raise MessageError('message type not handled')
            except (ValueError, MessageError) as exc:
                await self.logger.error('Message handling error', exc_info=exc)


DeviceKey = Union[str, int]


@dataclasses.dataclass
class SmartDeviceManager(rpc.Handler):
    """Manage the lifecycle and operations of Smart Devices.

    Attributes:
        observer: An observer for detecting hotplugged Smart Devices.
        buffers: A buffer manager for opening/closing shared memory.
        devices: Map device UIDs to device instances.

    Note:
        Although integer UIDs are used internally, UIDs are transported over the network as
        strings because the serialization protocol may not support 96-bit integers.
    """

    observer: SmartDeviceObserver = dataclasses.field(default_factory=make_observer)
    buffers: BufferManager = dataclasses.field(default_factory=BufferManager)
    devices: dict[int, SmartDeviceClient] = dataclasses.field(default_factory=dict)
    logger: structlog.stdlib.AsyncBoundLogger = dataclasses.field(
        default_factory=lambda: structlog.get_logger(
            wrapper_class=structlog.stdlib.AsyncBoundLogger,
        ),
    )

    @rpc.route
    async def list_uids(self) -> list[str]:
        """List the UIDs of Smart Devices connected currently."""
        return list(self.devices)

    def _normalize_uids(self, uids: Optional[Union[DeviceKey, list[DeviceKey]]]) -> list[int]:
        if uids is None:
            return list(self.devices)
        if isinstance(uids, (str, int)):
            uids = [uids]
        return list(map(int, uids))

    @rpc.route
    async def ping(self, uids: Optional[Union[DeviceKey, list[DeviceKey]]] = None):
        """Ping one or more devices.

        Arguments:
            uids: The UIDs of devices to ping. If ``None`` is provided, this handler will ping all
                devices. A single UID or a list of UIDs may also be provided.
        """
        for uid in self._normalize_uids(uids):
            await self.devices[uid].ping()

    @rpc.route
    async def disable(self, uids: Optional[Union[DeviceKey, list[DeviceKey]]] = None):
        """Disable one or more devices.

        Arguments:
            uids: The UIDs of devices to disable. See :meth:`SmartDeviceManager.ping` for an
                explanation of this argument's type.
        """
        for uid in self._normalize_uids(uids):
            await self.devices[uid].disable()

    @rpc.route
    async def subscribe(
        self,
        uid: DeviceKey,
        params: Optional[list[str]] = None,
        interval: Real = 0.04,
    ):
        """Send subscription requests to a device.

        Arguments:
            uid: The UID of the device to send the request to.

        The remaining arguments are passed to :meth:`SmartDevice.subscribe`.
        """
        await self.devices[int(uid)].subscribe(params, interval)

    @rpc.route
    async def unsubscribe(self, uids: Optional[Union[DeviceKey, list[DeviceKey]]] = None):
        for uid in self._normalize_uids(uids):
            await self.devices[uid].unsubscribe()

    @rpc.route
    async def heartbeat(
        self,
        uid: DeviceKey,
        heartbeat_id: Optional[int] = None,
        timeout: Optional[Real] = 1,
        block: bool = True,
    ):
        """Send heartbeat requests to a device.

        Arguments:
            uid: The UID of the device to send the request to.

        The remaining arguments are passed to :meth:`SmartDevice.heartbeat`.
        """
        await self.devices[int(uid)].heartbeat(heartbeat_id, timeout, block)

    async def run_device(
        self,
        reader: asyncio.StreamReader,
        writer: asyncio.StreamWriter,
        port: Optional[Path] = None,
        discovery_timeout: Real = 10,
    ):
        """Create and register a new Smart Device and block until the connection closes.

        Arguments:
            reader: Stream reader.
            writer: Stream writer.
            port: The COM port path, if this is a serial connection. If not provided, this method
                assumes this device is virtual.
            discovery_timeout: Duration in seconds to wait for the initial subscription response
                to return.
        """
        port = str(port) if port else '(virtual)'
        device = SmartDeviceClient(reader, writer, logger=self.logger.bind(port=port))
        async with device.communicate() as rw_tasks:
            uid = int(await asyncio.wait_for(device.discover(self.buffers), discovery_timeout))
            self.devices[uid] = device
            await device.subscribe()
            handle_task = asyncio.create_task(device.handle_messages(), name='dev-handle')
            try:
                await asyncio.gather(handle_task, *rw_tasks)
            finally:
                handle_task.cancel()
                self.devices.pop(uid, None)

    async def open_serial_devices(self, **options):
        """Open serial ports and schedule their execution concurrently.

        Arguments:
            **options: Keyword arguments passed to :func:`serial_asyncio.open_serial_connection`.
        """
        await self.logger.info(
            'Opening serial connections',
            observer_type=type(self.observer).__name__,
        )
        while True:
            ports = await self.observer.get_ports()
            for port in ports:
                reader, writer = await aioserial.open_serial_connection(url=str(port), **options)
                asyncio.create_task(self.run_device(reader, writer, port), name='run-device')


async def main(**options):
    """Async entry point.

    Arguments:
        **options: Command-line options.
    """
    async with process.EndpointManager('device', options) as manager:
        device_manager = SmartDeviceManager(
            buffers=manager.stack.enter_context(BufferManager()),
        )
        await asyncio.to_thread(device_manager.buffers.load_catalog, options['dev_catalog'])
        await manager.make_service(device_manager)
        vsd_addr = urlsplit(options['dev_vsd_addr'])
        server = await asyncio.start_server(
            device_manager.run_device,
            vsd_addr.hostname,
            vsd_addr.port,
            reuse_port=True,
        )
        server = await manager.stack.enter_async_context(server)
        await asyncio.gather(
            device_manager.open_serial_devices(
                baudrate=options['dev_baud_rate'],
            ),
            server.serve_forever(),
        )
