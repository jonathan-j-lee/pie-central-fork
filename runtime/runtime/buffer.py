"""Peripheral Data Storage and Sharing."""

import collections.abc
import contextlib
import ctypes
import dataclasses
import errno
import functools
import io
import re
import time
import warnings
from multiprocessing.shared_memory import SharedMemory
from numbers import Real
from pathlib import Path
from typing import Any, Callable, ClassVar, Iterable, NamedTuple, Optional, Union

import yaml

from .exception import RuntimeBaseException
from .messaging import Message, MessageError, ParameterMap
from .sync import Mutex, SyncError

__all__ = [
    'RuntimeBufferError',
    'Parameter',
    'DeviceUID',
    'Buffer',
    'DeviceBuffer',
    'BufferManager',
]


class RuntimeBufferError(RuntimeBaseException):
    """General buffer error."""


class Parameter(NamedTuple):
    """A description of a parameter."""

    name: str
    ctype: type
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


class BaseStructure(ctypes.LittleEndianStructure):
    @classmethod
    def get_field_view(cls, base_view: memoryview, field_name: str) -> memoryview:
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


class DeviceControlBlock(BaseStructure):
    _param_map_type = ctypes.c_uint16
    _fields_ = [
        ('uid', DeviceUID),
        ('subscription', _param_map_type),
        ('delay', ctypes.c_uint16),
        ('read', _param_map_type),
        ('write', _param_map_type),
        ('update', _param_map_type),
    ]
    RESET: int = 0x0000


class Buffer(BaseStructure):
    @classmethod
    def _make_block_type(cls, name: str, params: list[Parameter]):
        fields = [('timestamp', ctypes.c_double)]
        fields.extend((param.name, param.platform_type) for param in params)
        return type(name, (BaseStructure,), {'_fields_': fields})

    @classmethod
    def make_type(cls, name: str, params: list[Parameter], *extra_fields, **options) -> type:
        normalized_name = name.title().replace('-', '')
        readable_params = [param for param in params if param.readable]
        read_block_type = cls._make_block_type(f'{normalized_name}ReadBlock', readable_params)
        writeable_params = [param for param in params if param.writeable]
        write_block_type = cls._make_block_type(f'{normalized_name}WriteBlock', writeable_params)
        attrs = {
            '_fields_': [
                ('valid', ctypes.c_bool),
                ('read', read_block_type),
                ('write', write_block_type),
                *extra_fields,
            ],
            'params': params,
            'param_indices': {param.name: i for i, param in enumerate(params)},
        }
        return type(normalized_name, (cls,), options | attrs)

    @classmethod
    @contextlib.contextmanager
    def open(cls, name: str, *, create: bool = True):
        """
        Note::
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
            raise RuntimeBufferError(
                'Cannot attach to nonexistent shared memory',
                name=name,
                create=create,
                type=cls.__name__,
            ) from exc
        except FileExistsError:
            shm, create_success = SharedMemory(name), False
        buffer = cls.from_buffer(shm.buf[Mutex.SIZE :])
        buffer.shm = shm
        buffer.mutex = Mutex(shm.buf[: Mutex.SIZE], shared=True)
        if create_success:
            buffer.mutex.initialize()
        if create:
            buffer.set_valid()
        try:
            yield buffer
        finally:
            if create:
                buffer.set_valid(valid=False)
            # pylint: disable=protected-access; there's not really a good solution without this.
            if isinstance(buffer._objects, dict):  # pragma: no cover
                buffer._objects.clear()
            shm.close()

    @classmethod
    def unlink(cls, name: str):
        with contextlib.suppress(FileNotFoundError):
            shm = SharedMemory(name)
            shm.unlink()
            shm.close()

    @contextlib.contextmanager
    def operation(self):
        try:
            with SyncError.suppress(errno.EDEADLK):
                self.mutex.acquire()
            if not self.valid:
                raise RuntimeBufferError('buffer is marked as invalid')
            yield
        finally:
            with SyncError.suppress(errno.EPERM):
                self.mutex.release()

    def get_value(self, param: str, /, *, read_block: bool = True):
        with self.operation():
            try:
                block = self.read if read_block else self.write
                return getattr(block, param)
            except AttributeError as exc:
                raise RuntimeBufferError('parameter is not readable', param=param) from exc

    @staticmethod
    def _clamp_within_limits(param: Parameter, value: Real) -> Real:
        if value < param.lower:
            warnings.warn(f'{param.name} value exceeded lowerbound ({value} < {param.lower})')
        if value > param.upper:
            warnings.warn(f'{param.name} value exceeded upperbound ({value} > {param.upper})')
        return max(param.lower, min(param.upper, value))

    def set_value(self, param: str, value: Any, /, *, write_block: bool = True):
        with self.operation():
            block = self.write if write_block else self.read
            if not hasattr(block, param):
                raise RuntimeBufferError('parameter is not writeable', param=param)
            param_desc = self.params[self.param_indices[param]]
            if param_desc.platform_type in (ctypes.c_float, ctypes.c_double):
                value = self._clamp_within_limits(param_desc, value)
            setattr(block, param, value)
            block.timestamp = time.time()

    def set_valid(self, valid: bool = True):
        with self.mutex:
            # pylint: disable=attribute-defined-outside-init; special ``ctypes`` magic.
            self.valid = valid


class DeviceBuffer(Buffer):
    subscription_interval: Real = 0.08
    write_interval: Real = 0.08
    heartbeat_interval: Real = 1

    def make_param_map(self, view: memoryview, param_block_name: str):
        param_block = getattr(self, param_block_name)
        param_block_view = self.get_field_view(view, param_block_name)
        param_map = ParameterMap()
        # pylint: disable=protected-access; ``_fields_`` is a documented member of the API.
        for name, _ in param_block._fields_:
            index = self.param_indices.get(name)
            if index is not None:
                field_view = param_block.get_field_view(param_block_view, name)
                param_map.set_param(index, field_view)
        return param_map

    @classmethod
    @contextlib.contextmanager
    def open(cls, name: str, *, create: bool = True):
        with super().open(name, create=create) as buffer:
            buffer.read_param_map = buffer.make_param_map(buffer.shm.buf[Mutex.SIZE :], 'read')
            buffer.write_param_map = buffer.make_param_map(buffer.shm.buf[Mutex.SIZE :], 'write')
            yield buffer

    @classmethod
    def make_type(cls, name: str, params: list[Parameter], *extra_fields, **options) -> type:
        if len(params) > Message.MAX_PARAMS:
            raise ValueError(f'Smart Devices may only have up to {Message.MAX_PARAMS} params')
        return super().make_type(
            name,
            params,
            ('control', DeviceControlBlock),
            *extra_fields,
            **options,
        )

    @classmethod
    def from_bitmap(cls, bitmap: int) -> Iterable[tuple[int, Parameter]]:
        for i in range(Message.MAX_PARAMS):
            if (bitmap >> i) & 0b1:
                yield i, cls.params[i]

    @classmethod
    def to_bitmap(
        cls,
        params: list[str],
        predicate: Callable[[Parameter], bool] = lambda _: True,
    ) -> int:
        bitmap = DeviceControlBlock.RESET
        for param in params:
            index = cls.param_indices[param]
            if predicate(cls.params[index]):
                bitmap |= 1 << index
        return bitmap

    def set_value(self, param: str, value: Any, /, *, write_block: bool = True):
        with self.operation():
            super().set_value(param, value, write_block=write_block)
            mask = 1 << self.param_indices[param]
            if write_block:
                self.control.write |= mask
            else:
                self.control.update |= mask

    def set_read(self, params: list[str]):
        with self.operation():
            self.control.read |= self.to_bitmap(params, predicate=lambda param: param.readable)

    def get_read(self) -> Optional[Message]:
        with self.operation():
            if self.control.read:
                message = Message.make_dev_read(self.control.read)
                self.control.read = DeviceControlBlock.RESET
                return message
            return None

    def get_write(self) -> Iterable[Message]:
        with self.operation():
            if self.control.write:
                try:
                    yield Message.make_dev_write(self.control.write, self.write_param_map)
                except MessageError:
                    for i, _ in self.from_bitmap(self.control.write):
                        yield Message.make_dev_write(1 << i, self.write_param_map)
                self.control.write = DeviceControlBlock.RESET

    def get_update(self) -> dict[str, Any]:
        with self.operation():
            params = self.from_bitmap(self.control.update)
            update = {param.name: self.get_value(param.name) for _, param in params}
            self.control.update = DeviceControlBlock.RESET
            return update

    def update_data(self, message: Message):
        with self.operation():
            bitmap = message.read_dev_data(self.read_param_map)
            self.control.update |= bitmap
            if bitmap:
                self.read.timestamp = time.time()

    def set_subscription(self, message: Message):
        with self.operation():
            self.control.subscription, self.control.delay, uid = message.read_sub_res()
            self.control.uid = DeviceUID(*uid)

    @property
    def last_update(self) -> float:
        with self.operation():
            return self.read.timestamp

    @property
    def last_write(self) -> float:
        with self.operation():
            return self.write.timestamp

    @property
    def uid(self) -> DeviceUID:
        with self.operation():
            return self.control.uid

    @property
    def subscription(self) -> list[str]:
        with self.operation():
            return [param.name for _, param in self.from_bitmap(self.control.subscription)]

    @property
    def delay(self) -> Real:
        return self.control.delay / 1000


BufferKey = Union[tuple[str, int], int, DeviceUID]


@dataclasses.dataclass
class BufferManager(collections.abc.Mapping[BufferKey, Buffer]):
    buffers: dict[tuple[str, int], Buffer] = dataclasses.field(default_factory=dict)
    catalog: dict[str, type] = dataclasses.field(default_factory=dict)
    stack: contextlib.ExitStack = dataclasses.field(default_factory=contextlib.ExitStack)

    SHM_PATH: ClassVar[Path] = Path('/dev/shm')

    def __enter__(self):
        self.stack.__enter__()
        return self

    def __exit__(self, exc_type, exc, traceback):
        return self.stack.__exit__(exc_type, exc, traceback)

    def __getitem__(self, key: BufferKey) -> Buffer:
        return self.get_or_create(key, create=False)

    def __iter__(self):
        return iter(self.buffers)

    def __len__(self):
        return len(self.buffers)

    def _normalize_key(self, key: BufferKey) -> tuple[str, int]:
        if isinstance(key, int):
            key = DeviceUID.from_int(key)
        if isinstance(key, DeviceUID):
            key = self.find_device_type(key.device_id), int(key)
        return key

    def get_or_create(self, key: BufferKey, create: bool = True) -> Buffer:
        type_name, uid = key = self._normalize_key(key)
        buffer = self.buffers.get(key)
        if not buffer:
            buffer_type = self.catalog[type_name]
            buffer = buffer_type.open(f'{type_name}-{uid}', create=create)
            buffer = self.buffers[key] = self.stack.enter_context(buffer)
            self.stack.callback(self.buffers.pop, key)
        if create:
            buffer.set_valid()
        return buffer

    def find_device_type(self, device_id: int) -> str:
        for type_name, buffer_type in self.catalog.items():
            if getattr(buffer_type, 'device_id', None) == device_id:
                return type_name
        raise RuntimeBufferError('device not found', device_id=device_id)

    def register_type(self, type_name: str, params: list[Parameter], **options):
        device_id = options.get('device_id')
        if device_id is None:
            buffer_type_factory = Buffer.make_type
        else:
            try:
                self.find_device_type(device_id)
            except RuntimeBufferError:
                pass
            else:
                raise RuntimeBufferError('duplicate Smart Device ID', device_id=device_id)
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
                for param in options.pop('params', None) or []:
                    param['ctype'] = Parameter.parse_ctype(param.pop('type'))
                    params.append(Parameter(**param))
                self.register_type(type_name, params, **options)

    @classmethod
    def unlink_all(cls):
        for path in cls.SHM_PATH.iterdir():
            Buffer.unlink(path.name)
