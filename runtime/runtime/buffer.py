"""Peripheral Data Storage and Sharing."""

import collections.abc
import contextlib
import ctypes
import dataclasses
import functools
import io
import operator
import re
import time
import warnings
from multiprocessing.shared_memory import SharedMemory
from numbers import Real
from pathlib import Path
from typing import (
    Any,
    Callable,
    Collection,
    ContextManager,
    Iterable,
    NamedTuple,
    Optional,
    TypeVar,
    Union,
)

import yaml

from .exception import RuntimeBaseException
from .messaging import Message, MessageError, MessageType, ParameterMap
from .sync import Mutex

__all__ = [
    'DeviceBufferError',
    'Parameter',
    'DeviceUID',
    'Buffer',
    'DeviceBuffer',
    'BufferManager',
]


class DeviceBufferError(RuntimeBaseException):
    """General buffer error."""


class Parameter(NamedTuple):
    """A description of a parameter."""

    name: str
    ctype: type
    index: int
    lower: Real = float('-inf')
    upper: Real = float('inf')
    readable: bool = True
    writeable: bool = False
    subscribed: bool = True

    @property
    def platform_type(self) -> type:
        """Return a ``ctype`` that has the correct width to hold this parameter's values.

        The type widths of Runtime's platform and the peripheral's platform may not match. This
        method performs the conversion to ensure the space allocated in the buffer is exactly the
        right size as the bytes emitted by the peripheral.
        """
        return ctypes.c_float if self.ctype is ctypes.c_double else self.ctype

    @staticmethod
    def parse_ctype(type_specifier: str) -> type:
        """Parse a type specifier into the corresponding C type.

        Example:
            >>> assert Parameter.parse_ctype('bool') is ctypes.c_bool
            >>> assert Parameter.parse_ctype('int32[64]') is ctypes.c_int32 * 64
            >>> assert Parameter.parse_ctype('uint64[8][8]') is ctypes.c_uint64 * 8 * 8
        """
        pattern, dimensions = re.compile(r'(\[(\d+)\])$'), []
        while match := pattern.search(type_specifier):
            suffix, dimension = match.groups()
            type_specifier = type_specifier.removesuffix(suffix)
            dimensions.append(int(dimension))
        ctype = getattr(ctypes, f'c_{type_specifier}')
        for dim in dimensions[::-1]:
            ctype *= dim
        return ctype

    def clamp(self, value: Real) -> Real:
        """Ensure a parameter value is between the parameter's lower and upper limits."""
        if value < self.lower:
            warnings.warn(f'{self.name} value exceeded lowerbound ({value} < {self.lower})')
        if value > self.upper:
            warnings.warn(f'{self.name} value exceeded upperbound ({value} > {self.upper})')
        return max(self.lower, min(self.upper, value))


WriteableBuffer = TypeVar('WriteableBuffer', memoryview, bytearray)


class BaseStructure(ctypes.LittleEndianStructure):
    """Ensure all buffers have the same endianness."""

    @classmethod
    def get_field_view(cls, base_view: WriteableBuffer, field_name: str) -> WriteableBuffer:
        """Get a memory view of a field from the structure's memory view."""
        field = getattr(cls, field_name)
        return base_view[field.offset : field.offset + field.size]


@functools.lru_cache(maxsize=64)
def make_bitmask(bits: int) -> int:
    """Construct a bitmask with the specified bitlength.

    Example:
        >>> make_bitmask(0)
        Traceback (most recent call last):
          ...
        ValueError: must provide a positive number of bits
        >>> bin(make_bitmask(1))
        '0b1'
        >>> bin(make_bitmask(5))
        '0b11111'
    """
    if bits <= 0:
        raise ValueError('must provide a positive number of bits')
    return (1 << bits) - 1


class DeviceUID(BaseStructure):
    """A unique device identifier.

    Examples:
        >>> assert int(DeviceUID(0xffff, 0xee, 0xc0debeef_deadbeef)) == 0xffff_ee_c0debeef_deadbeef
        >>> uid = DeviceUID.from_int(0xffff_ee_c0debeef_deadbeef)
        >>> hex(uid.device_id)
        '0xffff'
        >>> hex(uid.year)
        '0xee'
        >>> hex(uid.random)
        '0xc0debeefdeadbeef'
    """

    _fields_ = [
        ('device_id', ctypes.c_uint16),
        ('year', ctypes.c_uint8),
        ('random', ctypes.c_uint64),
    ]

    def __int__(self) -> int:
        """Serialize this UID as a 96-bit integer."""
        uid = self.device_id
        uid = (uid << 8 * type(self).year.size) | self.year
        uid = (uid << 8 * type(self).random.size) | self.random
        return uid

    @classmethod
    def from_int(cls, uid: int) -> 'DeviceUID':
        """Parse a device UID in integer format into its constituent fields."""
        random, uid = uid & make_bitmask(8 * cls.random.size), uid >> 8 * cls.random.size
        year, uid = uid & make_bitmask(8 * cls.year.size), uid >> 8 * cls.year.size
        device_id = uid & make_bitmask(8 * cls.device_id.size)
        return DeviceUID(device_id, year, random)


class DeviceMetricsBlock(BaseStructure):
    _counter_type = ctypes.c_uint64
    _fields_ = [
        ('send', _counter_type * Message.MAX_PARAMS),
        ('recv', _counter_type * Message.MAX_PARAMS),
    ]


class DeviceControlBlock(BaseStructure):
    """A special structure for Smart Device bookkeeping."""

    _param_map_type = ctypes.c_uint16
    _timestamp_type = ctypes.c_double
    _fields_ = [
        ('uid', DeviceUID),
        ('subscription', _param_map_type),
        ('interval', ctypes.c_uint16),
        ('read', _param_map_type),
        ('write', _param_map_type),
        ('update', _param_map_type),
        ('last_write', _timestamp_type),
        ('last_update', _timestamp_type),
    ]
    interval_spec: Parameter = Parameter('interval', ctypes.c_uint16, -1, lower=40, upper=250)


class ParameterBlock(BaseStructure):
    @classmethod
    def make_type(cls, name: str, params: list[Parameter]) -> type['ParameterBlock']:
        fields = [(param.name, param.platform_type) for param in params]
        return type(name, (cls,), {'_fields_': fields, 'params': params})


def with_transaction(wrapped):
    @functools.wraps(wrapped)
    def wrapper(self, /, *args, **kwargs):
        with self.transaction():
            return wrapped(self, *args, **kwargs)

    return wrapper


class Buffer(BaseStructure):
    """A structure for holding peripheral data.

    A buffer consists of two substructures: an _update_ block for holding current parameter values
    (as read from the peripheral), and a _write_ block for parameter values to be written to the
    peripheral.
    """

    mutex = contextlib.nullcontext()

    @classmethod
    def attach(cls, buf: Optional[WriteableBuffer] = None, /):
        if buf is None:
            buf = bytearray(ctypes.sizeof(cls))
        structure = cls.from_buffer(buf)
        structure.buf = buf
        return structure

    @classmethod
    def make_type(
        cls, name: str, params: list[Parameter], *extra_fields, **attrs
    ) -> type['Buffer']:
        normalized_name = name.title().replace('-', '')
        update_block_type = ParameterBlock.make_type(
            f'{normalized_name}UpdateBlock',
            [param for param in params if param.readable],
        )
        write_block_type = ParameterBlock.make_type(
            f'{normalized_name}WriteBlock',
            [param for param in params if param.writeable],
        )
        attrs |= {
            '_fields_': [
                ('valid_flag', ctypes.c_bool),
                ('update_block', update_block_type),
                ('write_block', write_block_type),
                *extra_fields,
            ],
            'params': {param.name: param for param in params},
        }
        return type(normalized_name, (cls,), attrs)

    @classmethod
    @contextlib.contextmanager
    def open(cls, name: str, /, *, create: bool = True) -> ContextManager['Buffer']:
        """Create a new buffer backed by shared memory.

        Arguments:
            name: The shared memory object's name.
            create: Whether to attempt to create a new shared memory object. If ``True`` but the
                object already exists, :meth:`open` silently attaches to the existing object.

        Returns:
            A context manager that automatically closes the shared memory object when the exit
            handler runs. The object is *not* unlinked, meaning other processes may still access
            the object. To finally destroy the object, you must call :meth:`Buffer.unlink` on this
            object's name.

        Raises:
            DeviceBufferError: If ``create=False`` but the shared memory object does not exist.

        Note:
            When two processes attempt to create this buffer simultaneously,
            there is a small chance that the buffer that loses out yields its
            view before the other process initializes the mutex. This behavior
            is OK, since attempting to acquire an uninitialized mutex should
            raise a ``SyncError`` with EINVAL.
        """
        size = Mutex.SIZE + ctypes.sizeof(cls)
        try:
            shm, create_success = SharedMemory(name, create=create, size=size), True
        except FileNotFoundError as exc:
            raise DeviceBufferError(
                'Cannot attach to nonexistent shared memory',
                name=name,
                create=create,
                type=cls.__name__,
            ) from exc
        except FileExistsError:
            shm, create_success = SharedMemory(name), False
        buffer = cls.attach(shm.buf[Mutex.SIZE :])
        buffer.mutex = Mutex(shm.buf[: Mutex.SIZE], shared=True, recursive=True)
        if create_success:
            buffer.mutex.initialize()
        if create:
            buffer.valid = True
        try:
            yield buffer
        finally:
            if create:
                buffer.valid = False
            buffer.buf.release()
            # pylint: disable=protected-access; there's not really a good solution without this
            if isinstance(buffer._objects, dict):  # pragma: no cover; if ``None``, nothing to do
                buffer._objects.clear()
            shm.close()

    @classmethod
    def unlink(cls, name: str):
        """Destroy a shared memory object.

        The exact behavior depends on the platform. See :meth:`SharedMemory.unlink` for details.
        """
        with contextlib.suppress(FileNotFoundError):
            shm = SharedMemory(name)
            shm.unlink()
            shm.close()

    @contextlib.contextmanager
    def transaction(self, /) -> ContextManager:
        """Acquire the buffer's mutex and check its valid bit.

        All methods already use this reentrant context manager to guarantee consistency, but this
        context manager may also be used to group transactions into a larger atomic transaction.
        This avoids acquiring and releasing the mutex repeatedly.
        """
        with self.mutex:
            if not self.valid_flag:
                raise DeviceBufferError('buffer is marked as invalid')
            yield

    @with_transaction
    def get(self, param: str, /):
        try:
            return getattr(self.update_block, param)
        except AttributeError as exc:
            raise DeviceBufferError('parameter is not readable', param=param) from exc

    @with_transaction
    def set(self, param: str, value: Any, /):
        self._set(self.update_block, param, value)

    @with_transaction
    def write(self, param: str, value: Any, /):
        self._set(self.write_block, param, value)

    def _set(self, block: ParameterBlock, param_name: str, value: Any, /):
        if not hasattr(block, param_name):
            raise DeviceBufferError('parameter is not writeable', param=param_name)
        param = self.params[param_name]
        if param.platform_type in (ctypes.c_float, ctypes.c_double):
            value = param.clamp(value)
        setattr(block, param_name, value)

    @property
    def valid(self, /) -> bool:
        """Whether this buffer represents a device actively sending and receiving data."""
        with self.mutex:
            return self.valid_flag

    @valid.setter
    def valid(self, flag: bool, /):
        with self.mutex:
            self.valid_flag = flag


class DeviceBuffer(Buffer):
    sub_interval: Real = 0.04
    write_interval: Real = 0.04
    heartbeat_interval: Real = 1

    @functools.cached_property
    def _update_param_map(self, /) -> ParameterMap:
        param_map = ParameterMap()
        param_map.update(self.update_block)
        return param_map

    @functools.cached_property
    def _write_param_map(self, /) -> ParameterMap:
        param_map = ParameterMap()
        param_map.update(self.write_block)
        return param_map

    @classmethod
    def make_type(
        cls, name: str, params: list[Parameter], *extra_fields, **attrs
    ) -> type['DeviceBuffer']:
        if len(params) > Message.MAX_PARAMS:
            raise ValueError(f'Smart Devices may only have up to {Message.MAX_PARAMS} params')
        return super().make_type(
            name,
            params,
            ('control', DeviceControlBlock),
            ('metrics', DeviceMetricsBlock),
            *extra_fields,
            **attrs,
        )

    @classmethod
    def _from_bitmap(cls, bitmap: int, /) -> frozenset[Parameter]:
        return frozenset(param for param in cls.params.values() if (bitmap >> param.index) & 0b1)

    @classmethod
    def _to_bitmap(cls, params: Collection[str], /) -> int:
        masks = (1 << cls.params[param].index for param in params)
        return functools.reduce(operator.or_, masks, Message.NO_PARAMS)

    @functools.cached_property
    def _read_mask(self, /) -> int:
        return self._to_bitmap([param.name for param in self.params.values() if param.readable])

    @with_transaction
    def set(self, param: str, value: Any, /):
        super().set(param, value)
        self.control.update |= 1 << self.params[param].index
        self.control.last_update = time.time()

    @with_transaction
    def write(self, param: str, value: Any, /):
        super().write(param, value)
        self.control.write |= 1 << self.params[param].index
        self.control.last_write = time.time()

    @with_transaction
    def read(self, /, params: Optional[Collection[str]] = None):
        if params is None:
            params = {param.name for param in self.params.values() if param.readable}
        self.control.read |= self._to_bitmap(params) & self._read_mask

    def _emit(
        self,
        make_msg: Callable[[int, ParameterMap], Message],
        bitmap: int,
        param_map: ParameterMap,
    ) -> Iterable[Message]:
        try:
            yield make_msg(bitmap, param_map)
        except MessageError:
            for param in self._from_bitmap(bitmap):
                yield make_msg(1 << param.index, param_map)

    @with_transaction
    def emit_dev_rw(self, /) -> Iterable[Message]:
        if self.control.write:
            yield from self._emit(
                Message.make_dev_write,
                self.control.write,
                self._write_param_map,
            )
            self.control.read &= Message.ALL_PARAMS ^ self.control.write
            self.control.write = Message.NO_PARAMS
        if self.control.read:
            yield Message.make_dev_read(self.control.read)
            self.control.read = Message.NO_PARAMS

    @with_transaction
    def emit_dev_data(self, /) -> Iterable[Message]:
        # Subscribed parameters will be read soon anyway. This optimization deduplicates updates.
        self.control.update &= Message.ALL_PARAMS ^ self.control.subscription
        if self.control.update:
            yield from self._emit(
                Message.make_dev_data,
                self.control.update,
                self._update_param_map,
            )
            self.control.update = Message.NO_PARAMS

    @with_transaction
    def emit_subscription(self, /) -> Iterable[Message]:
        yield from self._emit(
            Message.make_dev_data,
            self.control.subscription,
            self._update_param_map,
        )

    @with_transaction
    def make_sub_req(
        self,
        /,
        params: Optional[Collection[str]] = None,
        interval: Optional[Real] = None,
    ) -> Message:
        if params is None:
            params = {param.name for param in self.params.values() if param.subscribed}
        if interval is None:
            interval = self.sub_interval
        return Message.make_sub_req(self._to_bitmap(params), int(1000 * interval))

    @with_transaction
    def make_sub_res(self, /) -> Message:
        return Message.make_sub_res(
            self.control.subscription,
            self.control.interval,
            self.uid.device_id,
            self.uid.year,
            self.uid.random,
        )

    @with_transaction
    def get_read(self, /) -> frozenset[str]:
        params = frozenset(param.name for param in self._from_bitmap(self.control.read))
        self.control.read = Message.NO_PARAMS
        return params

    @with_transaction
    def get_write(self, /) -> dict[str, Any]:
        params = set(param for param in self._from_bitmap(self.control.write) if param.writeable)
        self.control.write = Message.NO_PARAMS
        return {param.name: getattr(self.write_block, param.name) for param in params}

    @with_transaction
    def get_update(self, /) -> dict[str, Any]:
        params = self._from_bitmap(self.control.update)
        self.control.update = Message.NO_PARAMS
        return {param.name: self.get(param.name) for param in params}

    @with_transaction
    def update(self, message: Message, /):
        if message.type is MessageType.DEV_DATA:
            self.control.update |= message.read_dev_data(self._update_param_map)
            self.control.last_update = time.time()
        elif message.type is MessageType.DEV_READ:
            self.control.read |= message.read_dev_read() & self._read_mask
        elif message.type is MessageType.DEV_WRITE:
            self.control.write |= message.read_dev_write(self._write_param_map)
            self.control.last_write = time.time()
        elif message.type is MessageType.SUB_REQ:
            subscription, self.control.interval = message.read_sub_req()
            self.control.subscription = subscription & self._read_mask
            if self.control.interval > 0:
                self.control.interval = self.control.interval_spec.clamp(self.control.interval)
        elif message.type is MessageType.SUB_RES:
            self.control.subscription, self.control.interval, uid = message.read_sub_res()
            self.control.uid = DeviceUID(*uid)

    @property
    @with_transaction
    def uid(self) -> DeviceUID:
        buf = self.get_field_view(self.buf, 'control')
        buf = self.control.get_field_view(buf, 'uid')
        return DeviceUID.from_buffer_copy(buf)

    @property
    @with_transaction
    def subscription(self) -> frozenset[str]:
        return frozenset(param.name for param in self._from_bitmap(self.control.subscription))

    @property
    @with_transaction
    def last_write(self) -> Real:
        return self.control.last_write

    @property
    @with_transaction
    def last_update(self) -> Real:
        return self.control.last_update

    @property
    @with_transaction
    def interval(self) -> Real:
        return self.control.interval / 1000


BufferKey = Union[tuple[str, int], int, DeviceUID]


@dataclasses.dataclass
class BufferManager(collections.abc.Mapping[BufferKey, Buffer]):
    """Manage the lifecycle of a collection of buffers."""

    buffers: dict[tuple[str, int], Buffer] = dataclasses.field(default_factory=dict)
    catalog: dict[str, type[Buffer]] = dataclasses.field(default_factory=dict)
    device_ids: dict[int, str] = dataclasses.field(default_factory=dict)
    stack: contextlib.ExitStack = dataclasses.field(default_factory=contextlib.ExitStack)
    shared: bool = True

    def __enter__(self, /):
        self.stack.__enter__()
        return self

    def __exit__(self, exc_type, exc, traceback, /):
        return self.stack.__exit__(exc_type, exc, traceback)

    def __getitem__(self, key: BufferKey, /) -> Buffer:
        return self.get_or_create(key, create=False)

    def __iter__(self, /) -> Iterable[BufferKey]:
        return iter(self.buffers)

    def __len__(self, /) -> int:
        return len(self.buffers)

    def _normalize_key(self, key: BufferKey, /) -> tuple[str, int]:
        if isinstance(key, int):
            key = DeviceUID.from_int(key)
        if isinstance(key, DeviceUID):
            try:
                key = self.device_ids[key.device_id], int(key)
            except KeyError as exc:
                raise DeviceBufferError('type not found', device_id=key.device_id) from exc
        return key

    def get_or_create(self, key: BufferKey, /, *, create: bool = True) -> Buffer:
        type_name, uid = key = self._normalize_key(key)
        buffer = self.buffers.get(key)
        if not buffer:
            buffer_type = self.catalog[type_name]
            if self.shared:
                buffer = buffer_type.open(f'rt-{type_name}-{uid}', create=create)
                buffer = self.stack.enter_context(buffer)
            else:
                if create:
                    buffer = buffer_type.attach()
                    buffer.valid = True
                else:
                    raise DeviceBufferError('local buffer not found', type=type_name, uid=uid)
            self.buffers[key] = buffer
            self.stack.callback(self.buffers.pop, key)
        return buffer

    def register_type(self, type_name: str, params: list[Parameter], **options):
        device_id = options.get('device_id')
        if device_id is None:
            buffer_type_factory = Buffer.make_type
        else:
            if device_id in self.device_ids:
                raise DeviceBufferError('duplicate Smart Device ID', device_id=device_id)
            self.device_ids[device_id] = type_name
            buffer_type_factory = DeviceBuffer.make_type
        self.catalog[type_name] = buffer_type_factory(type_name, params, **options)

    def load_catalog(self, stream: Union[Path, io.TextIOBase]):
        if isinstance(stream, Path):
            with open(stream) as file_handle:
                self.load_catalog(file_handle)
        else:
            catalog = yaml.load(stream, Loader=yaml.SafeLoader)
            for type_name, options in catalog.items():
                params = []
                for index, param in enumerate(options.pop('params', None) or []):
                    param.setdefault('index', index)
                    param['ctype'] = Parameter.parse_ctype(param.pop('type'))
                    params.append(Parameter(**param))
                self.register_type(type_name, params, **options)

    @staticmethod
    def unlink_all(shm_path: Path = Path('/dev/shm')):
        for path in shm_path.glob('rt-*'):
            Buffer.unlink(path.name)
