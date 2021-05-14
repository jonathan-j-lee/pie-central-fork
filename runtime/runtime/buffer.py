import contextlib
import ctypes
import errno
import time
import warnings
from multiprocessing.shared_memory import SharedMemory
from numbers import Real
from typing import Any, Callable, Iterable, NamedTuple, Optional

from .exception import RuntimeBaseException
from .messaging import Message, MessageError, ParameterMap
from .sync import Mutex, SyncError

__all__ = ['RuntimeBufferError', 'Parameter', 'DeviceUID', 'Buffer', 'DeviceBuffer']


class RuntimeBufferError(RuntimeBaseException):
    pass


class Parameter(NamedTuple):
    name: str
    ctype: type
    lower: Real = float('-inf')
    upper: Real = float('inf')
    readable: bool = True
    writeable: bool = False
    subscribed: bool = False

    @property
    def platform_type(self) -> type:
        return ctypes.c_float if self.ctype is ctypes.c_double else self.ctype


class BaseStructure(ctypes.LittleEndianStructure):
    def __repr__(self) -> str:
        fields = ', '.join(f'{name}={getattr(self, name)!r}' for name, _ in self._fields_)
        return f'{self.__class__.__name__}({fields})'

    @classmethod
    def get_field_view(cls, base_view: memoryview, field_name: str) -> memoryview:
        field = getattr(cls, field_name)
        return base_view[field.offset : field.offset + field.size]


class DeviceUID(BaseStructure):
    _fields_ = [
        ('device_id', ctypes.c_uint16),
        ('year', ctypes.c_uint8),
        ('random', ctypes.c_uint64),
    ]

    def __int__(self) -> int:
        """Serialize this UID as a 96-bit integer."""
        uid = self.device_id
        uid = (uid << 8 * self.__class__.year.size) | self.year
        uid = (uid << 8 * self.__class__.random.size) | self.random
        return uid


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
        fields = [('_timestamp', ctypes.c_double)]
        fields.extend((param.name, param.platform_type) for param in params)
        return type(name, (BaseStructure,), {'_fields_': fields})

    @classmethod
    def make_type(cls, name: str, params: list[Parameter], *extra_fields) -> type:
        readable_params = [param for param in params if param.readable]
        read_block_type = cls._make_block_type(f'{name}ReadBlock', readable_params)
        writeable_params = [param for param in params if param.writeable]
        write_block_type = cls._make_block_type(f'{name}WriteBlock', writeable_params)
        attrs = {
            '_fields_': [
                ('valid', ctypes.c_bool),
                ('read', read_block_type),
                ('write', write_block_type),
                *extra_fields,
            ],
            '_params': params,
            '_param_indices': {param.name: i for i, param in enumerate(params)},
        }
        return type(name, (cls,), attrs)

    def _make_param_map(self, view: memoryview, param_block_name: str):
        param_block = getattr(self, param_block_name)
        param_block_view = self.get_field_view(view, param_block_name)
        param_map = ParameterMap()
        for name, _ in param_block._fields_:
            index = self._param_indices.get(name)
            if index is not None:
                field_view = param_block.get_field_view(param_block_view, name)
                param_map.set_param(index, field_view)
        return param_map

    @classmethod
    @contextlib.contextmanager
    def open(cls, name: str, create: bool = True):
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
        buffer.mutex = Mutex(shm.buf[: Mutex.SIZE], shared=True)
        buffer.read_param_map = buffer._make_param_map(shm.buf[Mutex.SIZE :], 'read')
        buffer.write_param_map = buffer._make_param_map(shm.buf[Mutex.SIZE :], 'write')
        if create_success:
            buffer.mutex.initialize()
        if create:
            buffer.set_valid()
        try:
            yield buffer
        finally:
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

    def get_value(self, param: str):
        with self.operation():
            try:
                return getattr(self.read, param)
            except AttributeError as exc:
                raise RuntimeBufferError('parameter is not readable', param=param) from exc

    def _clamp_within_limits(self, param: Parameter, value: Real) -> Real:
        if value < param.lower:
            warnings.warn(f'{param.name} value exceeded lowerbound ({value} < {param.lower})')
        if value > param.upper:
            warnings.warn(f'{param.name} value exceeded upperbound ({value} > {param.upper})')
        return max(param.lower, min(param.upper, value))

    def set_value(self, name: str, value):
        with self.operation():
            if not hasattr(self.write, name):
                raise RuntimeBufferError('parameter is not writeable', param=name)
            param = self._params[self._param_indices[name]]
            if param.platform_type in (ctypes.c_float, ctypes.c_double):
                value = self._clamp_within_limits(param, value)
            setattr(self.write, name, value)
            self.write._timestamp = time.time()

    def set_valid(self, valid: bool = True):
        with self.mutex:
            self.valid = valid


class DeviceBuffer(Buffer):
    @classmethod
    def make_type(cls, name: str, params: list[Parameter], *extra_fields) -> type:
        return super().make_type(name, params, ('control', DeviceControlBlock), *extra_fields)

    @classmethod
    def from_bitmap(cls, bitmap: int) -> Iterable[tuple[int, Parameter]]:
        for i in range(Message.MAX_PARAMS):
            if (bitmap >> i) & 0b1:
                yield i, cls._params[i]

    @classmethod
    def to_bitmap(cls, params: list[str], predicate: Callable[[Parameter], bool] = None) -> int:
        bitmap = DeviceControlBlock.RESET
        for param in params:
            index = cls._param_indices[param]
            if predicate is None or predicate(cls._params[index]):
                bitmap |= 1 << index
        return bitmap

    def set_value(self, param: str, value):
        with self.operation():
            super().set_value(param, value)
            self.control.write |= 1 << self._param_indices[param]

    def set_read(self, params: list[str]):
        with self.operation():
            self.control.read |= self.to_bitmap(params, predicate=lambda param: param.readable)

    def get_read(self) -> Optional[Message]:
        with self.operation():
            if self.control.read:
                message = Message.make_dev_read(self.control.read)
                self.control.read = DeviceControlBlock.RESET
                return message

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
                self.read._timestamp = time.time()

    def set_subscription(self, uid: DeviceUID, subscription: list[str]):
        with self.operation():
            self.control.uid, self.control.subscription = uid, self.to_bitmap(subscription)

    @property
    def last_update(self) -> float:
        with self.operation():
            return self.read._timestamp

    @property
    def last_write(self) -> float:
        with self.operation():
            return self.write._timestamp

    @property
    def uid(self) -> DeviceUID:
        with self.operation():
            return self.control.uid

    @property
    def subscription(self) -> list[str]:
        with self.operation():
            return [param.name for _, param in self.from_bitmap(self.control.subscription)]
