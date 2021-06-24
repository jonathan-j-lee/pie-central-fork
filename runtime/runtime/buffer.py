"""Peripheral data storage and sharing.

Buffers are the primary interprocess communication (IPC) mechanism within Runtime. Each
buffer is a C-style structure created with the :mod:`ctypes` foreign function library
and possibly backed by shared memory. Each buffer represents one Smart Device or other
peripheral and contains parameters that can be read or written to.

For extensibility reasons, this library contains no hardcoded information about specific
peripherals. Instead, this library parses each peripheral's parameter and memory layout
specifications from a config file and generates the buffer types dynamically.

Consumers should poll buffers for changes. There is no mechanism for event-based
notifications.

This library is synchronous. Since many operations acquire a mutex, buffer operations
should run in an executor, so as not to block the event loop.
"""

import collections.abc
import contextlib
import ctypes
import functools
import operator
import re
import time
import types
import typing
import warnings
from dataclasses import dataclass, field
from multiprocessing.shared_memory import SharedMemory
from pathlib import Path
from typing import (
    Any,
    Callable,
    Collection,
    ContextManager,
    Iterator,
    Mapping,
    MutableMapping,
    NamedTuple,
    Optional,
    TypeVar,
    Union,
)

from .exception import RuntimeBaseException
from .messaging import Message, MessageError, MessageType, ParameterMap
from .sync import Mutex

__all__ = [
    'Buffer',
    'BufferStore',
    'Catalog',
    'DeviceBuffer',
    'DeviceBufferError',
    'DeviceUID',
    'NullDevice',
    'Parameter',
]

# List: https://docs.python.org/3/library/ctypes.html#fundamental-data-types
_SIMPLE_TYPES: frozenset[type] = frozenset(
    {
        ctypes.c_bool,
        ctypes.c_char,
        ctypes.c_wchar,
        ctypes.c_ubyte,
        ctypes.c_byte,
        ctypes.c_short,
        ctypes.c_ushort,
        ctypes.c_int,
        ctypes.c_uint,
        ctypes.c_long,
        ctypes.c_ulong,
        ctypes.c_longlong,
        ctypes.c_ulonglong,
        ctypes.c_size_t,
        ctypes.c_ssize_t,
        ctypes.c_float,
        ctypes.c_double,
        ctypes.c_longdouble,
        ctypes.c_char_p,
        ctypes.c_wchar_p,
        ctypes.c_void_p,
    }
)


class DeviceBufferError(RuntimeBaseException):
    """Error when interfacing with a buffer."""


class Parameter(NamedTuple):
    """A parameter descriptor.

    Parameters:
        name: The parameter name.
        ctype: A :mod:`ctypes` type.
        id: The parameter ID, a nonnegative integer.
        lower: This parameter's minimum valid value. For numeric parameters only.
        upper: This parameter's maximum valid value. For numeric parameters only.
        readable: Whether this parameter should be readable with :meth:`Buffer.get`.
        writeable: Whether this parameter should be writeable with :meth:`Buffer.write`.
        subscribed: Whether this parameter should be subscribed to, by default. Only
            applicable for Smart Devices.
    """

    name: str
    ctype: type
    id: int
    lower: float = float('-inf')
    upper: float = float('inf')
    readable: bool = True
    writeable: bool = False
    subscribed: bool = True

    @property
    def platform_type(self, /) -> type:
        """A C type that has the correct width to hold this parameter's values.

        The type widths of Runtime's platform and the peripheral's platform may not
        match. This method performs the necessary conversion to allocate the correct
        amount of buffer space.

        Returns:
            A type exactly as wide as the values (bytes) emitted by the peripheral.
        """
        return ctypes.c_float if self.ctype is ctypes.c_double else self.ctype

    @staticmethod
    def parse_ctype(type_specifier: str) -> type:
        """Parse a type specifier into the corresponding C type.

        Parameters:
            type_specifier: A description of the parameter's type. Can be a the name of
                any simple :mod:`ctypes` data type without the ``c_`` prefix. A vector
                type of `n` elements can also be specified by appending ``[<n>]`` to an
                existing type (resembling C array declaration syntax). Pointer types are
                not supported.

        Returns:
            A :mod:`ctypes`-compatible data type.

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
        return typing.cast(type, ctype)

    def clamp(self, value: float, /) -> float:
        """Ensure a real value is between this parameter's lower and upper limits.

        If the value is not within the bounds, this method will emit a warning.

        Parameters:
            value: Candidate value.

        Returns:
            A value between :attr:`Parameter.lower` and :attr:`Parameter.upper`. A value
            that exceeds the minimum or maximum will be clipped to that bound.

        Example:
            >>> param = Parameter('param', ctypes.c_double, 0, lower=-1, upper=1)
            >>> param.clamp(-1.1)
            -1
            >>> param.clamp(1.1)
            1
            >>> param.clamp(0)
            0
        """
        if value < self.lower:
            warnings.warn(f'{self.name} exceeded lowerbound ({value} < {self.lower})')
        if value > self.upper:
            warnings.warn(f'{self.name} exceeded upperbound ({value} > {self.upper})')
        return max(self.lower, min(self.upper, value))

    @property
    def default(self, /) -> Any:
        """The default value when initializing this parameter.

        Returns:
            The default value of :attr:`Parameter.platform_type`.

        Raises:
            DeviceBufferError: If this parameter is not a simple :mod:`ctype`.

        Example:
            >>> Parameter('param', ctypes.c_double, 0).default
            0.0
            >>> Parameter('param', ctypes.c_int8, 0).default
            0
            >>> Parameter('param', ctypes.c_bool, 0).default
            False
            >>> Parameter('param', ctypes.c_bool * 3, 0).default
            Traceback (most recent call last):
              ...
            runtime.buffer.DeviceBufferError: vector parameters have no default
        """
        ctype = self.platform_type
        if ctype not in _SIMPLE_TYPES:
            raise DeviceBufferError(
                'vector parameters have no default',
                name=self.name,
                index=self.id,
            )
        return ctype().value


WriteableBuffer = TypeVar('WriteableBuffer', memoryview, bytearray)


class BaseStructure(ctypes.LittleEndianStructure):
    """Base type for all structures.

    This type ensures all buffers have the same endianness. The endianness of this type
    should match that of the Smart Device platform.
    """

    @classmethod
    def get_view(cls, /, base: WriteableBuffer, field_name: str) -> memoryview:
        """Get a memory view of a field from the structure's buffer.

        Parameters:
            base: The buffer backing the structure.
            field_name: The name of the field view to extract.
        """
        field_desc = getattr(cls, field_name)
        view = memoryview(base)
        return view[field_desc.offset : field_desc.offset + field_desc.size]


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

    Attributes:
        device_id (int): The device's type ID. Consult the catalog for the full list.
        year (int): The year in which the device was created. ``0x00`` corresponds to
            the spring 2016 season, and increments for each season afterwards.
        random (int): The UID's random bits to distinguish otherwise identical devices.

    Examples:
        >>> uid = DeviceUID(0xffff, 0xee, 0xc0debeef_deadbeef)
        >>> assert int(uid) == 0xffff_ee_c0debeef_deadbeef
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

    def __int__(self, /) -> int:
        uid = int(self.device_id)
        uid = (uid << 8 * type(self).year.size) | self.year
        uid = (uid << 8 * type(self).random.size) | self.random
        return uid

    @classmethod
    def from_int(cls, /, uid: int) -> 'DeviceUID':
        """Parse a device UID in integer format into its constituent fields."""
        rand, uid = uid & make_bitmask(8 * cls.random.size), uid >> 8 * cls.random.size
        year, uid = uid & make_bitmask(8 * cls.year.size), uid >> 8 * cls.year.size
        device_id = uid & make_bitmask(8 * cls.device_id.size)
        return DeviceUID(device_id, year, rand)


class DeviceMetricsBlock(BaseStructure):
    """A special structure for storing Smart Device statistics."""

    _counter_type = ctypes.c_uint64
    _fields_ = [
        ('send', _counter_type * Message.MAX_PARAMS),
        ('recv', _counter_type * Message.MAX_PARAMS),
    ]


class DeviceControlBlock(BaseStructure):
    """A special structure for bookkeeping Smart Device control state."""

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
    interval_spec: Parameter = Parameter('interval', ctypes.c_uint16, -1, 40, 250)


class ParameterBlock(BaseStructure):
    """A structure for holding parameters."""

    @classmethod
    def make_type(cls, /, name: str, params: list[Parameter]) -> type['ParameterBlock']:
        """Make a structure with the given parameters as fields."""
        fields = [(param.name, param.platform_type) for param in params]
        return type(name, (cls,), {'_fields_': fields, 'params': params})


RT = TypeVar('RT')


def with_transaction(wrapped: Callable[..., RT]) -> Callable[..., RT]:
    """Decorator applied to :class:`Buffer` methods to begin a transaction."""

    @functools.wraps(wrapped)
    def wrapper(self: 'Buffer', /, *args: Any, **kwargs: Any) -> RT:
        with self.transaction():
            return wrapped(self, *args, **kwargs)

    return wrapper


BufferType = TypeVar('BufferType', bound='Buffer')
DeviceBufferType = TypeVar('DeviceBufferType', bound='DeviceBuffer')


class Buffer(BaseStructure):
    """A structure for storing peripheral data.

    A buffer consists of two substructures: an *update block* for storing current
    parameter values (as read from the peripheral), and a *write block* for parameter
    values to be written to the peripheral.

    Attributes:
        params: Maps param names to their descriptors.
    """

    params: Mapping[str, Parameter]
    mutex: ContextManager[None] = contextlib.nullcontext()

    @classmethod
    def attach(
        cls: type[BufferType],
        buf: Optional[WriteableBuffer] = None,
        /,
    ) -> BufferType:
        """Create a new buffer.

        Parameters:
            buf: A writeable Python buffer (not to be confused with :class:`Buffer`). If
                not provided, a :class:`bytearray` with the correct size is allocated.
        """
        if buf is None:
            return cls.attach(bytearray(ctypes.sizeof(cls)))
        structure = cls.from_buffer(buf)
        structure.buf = buf
        return structure

    @classmethod
    def make_type(
        cls: type[BufferType],
        /,
        name: str,
        params: list[Parameter],
        *extra_fields: tuple[str, type],
        **attrs: Any,
    ) -> type[BufferType]:
        """Create a new buffer type (subclass).

        Parameters:
            name: Type name prefix (preferably kebab case).
            params: Parameter list.
            extra_fields: Extra :mod:`ctypes` fields (name and types).
            attrs: Additional class attributes.
        """
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
    def open(cls, name: str, /, *, create: bool = True) -> Iterator['Buffer']:
        """Open a new buffer backed by shared memory.

        Parameters:
            name: The shared memory object's name.
            create: Whether to attempt to create a new shared memory object. If ``True``
                but the object already exists, :meth:`open` silently attaches to the
                existing object.

        Returns:
            A context manager that automatically closes the shared memory object when
            the exit handler runs. The object is *not* unlinked, meaning other processes
            may still access the object. To finally destroy the object, you must call
            :meth:`Buffer.unlink` on this object's name.

        Raises:
            DeviceBufferError: If ``create=False``, but the object does not exist.

        Note:
            When two processes attempt to create this buffer simultaneously, there is a
            small chance that the buffer that loses out yields its view before the other
            process initializes the mutex. This behavior is OK, since attempting to
            acquire an uninitialized mutex should raise a ``SyncError`` with EINVAL.
        """
        size = Mutex.SIZE + ctypes.sizeof(cls)
        try:
            shm, create_success = SharedMemory(name, create=create, size=size), True
        except FileNotFoundError as exc:
            raise DeviceBufferError(
                'cannot attach to nonexistent shared memory',
                name=name,
                create=create,
                type=cls.__name__,
            ) from exc
        except FileExistsError:
            shm, create_success = SharedMemory(name), False
        buffer = cls.attach(shm.buf[Mutex.SIZE :])
        mutex = Mutex(shm.buf[: Mutex.SIZE], shared=True, recursive=True)
        if create_success:
            mutex.initialize()
        buffer.mutex = mutex
        if create:
            buffer.valid = True
        try:
            yield buffer
        finally:
            if create:
                buffer.valid = False
            buffer.buf.release()
            # pylint: disable=protected-access; no good alternative solution
            if isinstance(buffer._objects, dict):  # pragma: no cover
                buffer._objects.clear()
            shm.close()

    @classmethod
    def unlink(cls, name: str) -> None:
        """Destroy a shared memory object.

        The exact behavior depends on the platform. See :meth:`SharedMemory.unlink`.
        """
        with contextlib.suppress(FileNotFoundError):
            shm = SharedMemory(name)
            shm.unlink()
            shm.close()

    @contextlib.contextmanager
    def transaction(self, /) -> Iterator[None]:
        """Acquire the buffer's mutex and check its valid bit.

        All methods already use this reentrant context manager to guarantee consistency,
        but this context manager may also be used to group transactions into a larger
        atomic transaction. This avoids acquiring and releasing the mutex repeatedly.
        """
        with self.mutex:
            if not self.valid_flag:
                raise DeviceBufferError('device does not exist (marked as invalid)')
            yield

    @with_transaction
    def get(self, param: str, /) -> Any:
        """Read a parameter from the update block.

        Parameters:
            param: The parameter name.

        Returns:
            The parameter value. Consult the catalog for each device's parameters and
            their types.

        Raises:
            DeviceBufferError: If the parameter does not exist or is not readable.
        """
        try:
            return getattr(self.update_block, param)
        except AttributeError as exc:
            raise DeviceBufferError(
                'parameter does not exist or is not readable',
                param=param,
            ) from exc

    @with_transaction
    def set(self, param: str, value: Any, /) -> None:
        """Set a parameter value in the update block.

        Parameters:
            param: The parameter name.
            value: The parameter value. Consult the catalog for each device's parameters
                and their types.

        Raises:
            DeviceBufferError: If the parameter does not exist or is not writeable.
            TypeError: If the value is not the correct type.
        """
        self._set(self.update_block, param, value)

    @with_transaction
    def write(self, param: str, value: Any, /) -> None:
        """Request writing a parameter to the device.

        Because the buffer is polled and the writes are batched during each cycle, it's
        possible to overwrite a pending parameter write. This is a feature to reduce
        excessive writes.

        Parameters:
            param: The parameter name.
            value: The parameter value. Consult the catalog for each device's parameters
                and their types.

        Raises:
            DeviceBufferError: If the parameter does not exist or is not writeable.
            TypeError: If the value is not the correct type.
        """
        self._set(self.write_block, param, value)

    def _set(self, block: ParameterBlock, param_name: str, value: Any, /) -> None:
        if not hasattr(block, param_name):
            raise DeviceBufferError(
                'parameter does not exist or is not writeable',
                param=param_name,
            )
        param = self.params[param_name]
        if param.platform_type in (ctypes.c_float, ctypes.c_double):
            value = param.clamp(value)
        setattr(block, param_name, value)

    @property
    def valid(self, /) -> bool:
        """Whether this buffer represents an active device."""
        with self.mutex:
            return self.valid_flag

    @valid.setter
    def valid(self, flag: bool, /) -> None:
        with self.mutex:
            self.valid_flag = flag


class DeviceBuffer(Buffer):
    """A special buffer representing a Smart Device.

    Attributes:
        sub_interval: The default subscription interval in seconds.
        write_interval: The duration in seconds between device writes.
        heartbeat_interval: The duration in seconds between heartbeat requests.
    """

    sub_interval: float = 0.04
    write_interval: float = 0.04
    heartbeat_interval: float = 1

    @staticmethod
    def _make_param_map(block: ParameterBlock, /) -> ParameterMap:
        param_map = ParameterMap()
        base, block_type = ctypes.addressof(block), type(block)
        for param in block.params:
            struct_field = getattr(block_type, param.name, None)
            if struct_field is not None:  # pragma: no cover; should always exist
                offset = base + struct_field.offset
                param_map.set_param(param.id, offset, struct_field.size)
        return param_map

    @functools.cached_property
    def _update_param_map(self, /) -> ParameterMap:
        return self._make_param_map(self.update_block)

    @functools.cached_property
    def _write_param_map(self, /) -> ParameterMap:
        return self._make_param_map(self.write_block)

    @classmethod
    def make_type(
        cls: type[DeviceBufferType],
        name: str,
        params: list[Parameter],
        *extra_fields: tuple[str, type],
        **attrs: Any,
    ) -> type[DeviceBufferType]:
        if len(params) > Message.MAX_PARAMS:
            raise ValueError(
                f'Smart Devices may only have up to {Message.MAX_PARAMS} params'
            )
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
        params = cls.params.values()
        return frozenset(param for param in params if (bitmap >> param.id) & 0b1)

    @classmethod
    def _to_bitmap(cls, params: Collection[str], /) -> int:
        masks = (1 << cls.params[param].id for param in params)
        return functools.reduce(operator.or_, masks, Message.NO_PARAMS)

    @functools.cached_property
    def _read_mask(self, /) -> int:
        params = self.params.values()
        return self._to_bitmap([param.name for param in params if param.readable])

    @with_transaction
    def set(self, param: str, value: Any, /) -> None:
        super().set(param, value)
        self.control.update |= 1 << self.params[param].id
        self.control.last_update = time.time()

    @with_transaction
    def write(self, param: str, value: Any, /) -> None:
        super().write(param, value)
        self.control.write |= 1 << self.params[param].id
        self.control.last_write = time.time()

    @with_transaction
    def read(self, /, params: Optional[Collection[str]] = None) -> None:
        """Request the device to return values for some parameters.

        Parameters:
            params: A list of parameter names to return values for. Passing ``None``
                specifies all parameters of this device type.

        Raises:
            KeyError: If an invalid parameter name is provided.
        """
        if params is None:
            params = {param.name for param in self.params.values() if param.readable}
        self.control.read |= self._to_bitmap(params) & self._read_mask

    def _emit(
        self,
        make_msg: Callable[[int, ParameterMap], Message],
        bitmap: int,
        param_map: ParameterMap,
    ) -> Iterator[Message]:
        try:
            yield make_msg(bitmap, param_map)
        except MessageError:
            for param in self._from_bitmap(bitmap):
                yield make_msg(1 << param.id, param_map)

    @with_transaction
    def emit_dev_rw(self, /) -> Iterator[Message]:
        """Make messages for reading and writing parameters.

        Calling this method will clear the pending parameter maps.

        Yields:
            runtime.messaging.Message: Zero or more messages, depending on how many
            parameters the consumer requested with :meth:`read` or :meth:`Buffer.write`.
            If no parameters have been requested, since the last read, this method may
            yield no messages.
        """
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
    def emit_dev_data(self, /) -> Iterator[Message]:
        """Make messages for containing device data for recently updated parameters.

        Calling this method will mark all parameters are not recently updated.

        Yields:
            runtime.messaging.Message: Zero or more messages containing device data.
        """
        # Subscribed parameters will be read soon anyway.
        # This optimization deduplicates updates.
        self.control.update &= Message.ALL_PARAMS ^ self.control.subscription
        if self.control.update:
            yield from self._emit(
                Message.make_dev_data,
                self.control.update,
                self._update_param_map,
            )
            self.control.update = Message.NO_PARAMS

    @with_transaction
    def emit_subscription(self, /) -> Iterator[Message]:
        """Make messages containing device data for subscribed parameters.

        Yields:
            runtime.messaging.Message: Zero or more messages containing device data.
        """
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
        interval: Optional[float] = None,
    ) -> Message:
        """Make a subscription request for some parameters.

        Parameters:
            params: A list of parameter names to subscribe to. Passing ``None``
                specifies all parameters of this device type.
            interval: The duration between updates in seconds.

        Returns:
            The subscription request message.
        """
        if params is None:
            params = {param.name for param in self.params.values() if param.subscribed}
        if interval is None:
            interval = self.sub_interval
        return Message.make_sub_req(self._to_bitmap(params), int(1000 * interval))

    @with_transaction
    def make_sub_res(self, /) -> Message:
        """Make a subscription response for the parameters subscribed to.

        Returns:
            The subscription response message.
        """
        return Message.make_sub_res(
            self.control.subscription,
            self.control.interval,
            self.control.uid.device_id,
            self.control.uid.year,
            self.control.uid.random,
        )

    @with_transaction
    def get_read(self, /) -> frozenset[str]:
        """Get the parameters that are to be read.

        Calling this method will clear the pending read map.

        Returns:
            A collection of parameter names.
        """
        params = frozenset(param.name for param in self._from_bitmap(self.control.read))
        self.control.read = Message.NO_PARAMS
        return params

    @with_transaction
    def get_write(self, /) -> dict[str, Any]:
        """Get the parameters that were written.

        Calling this method will clear the pending write map.

        Returns:
            A map of parameter names to their corresponding values.
        """
        params = self._from_bitmap(self.control.write)
        params = frozenset(param for param in params if param.writeable)
        self.control.write = Message.NO_PARAMS
        return {param.name: getattr(self.write_block, param.name) for param in params}

    @with_transaction
    def get_update(self, /) -> dict[str, Any]:
        """Get the parameters that were updated.

        Calling this method will clear the pending update map.

        Returns:
            A map of parameter names to their corresponding values.
        """
        params = self._from_bitmap(self.control.update)
        self.control.update = Message.NO_PARAMS
        return {param.name: self.get(param.name) for param in params}

    @with_transaction
    def update(self, message: Message, /) -> None:
        """Digest a Smart Device message and update this buffer's state accordingly.

        The message's bitmaps and parameter values are copied into this buffer.
        """
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
                interval = self.control.interval_spec.clamp(self.control.interval)
                self.control.interval = interval
        elif message.type is MessageType.SUB_RES:
            (
                self.control.subscription,
                self.control.interval,
                uid,
            ) = message.read_sub_res()
            self.control.uid = DeviceUID(*uid)

    @property
    def uid(self) -> int:
        """Smart Device unique identifier."""
        with self.transaction():
            return int(self.control.uid)

    @uid.setter
    def uid(self, uid: int, /) -> None:
        with self.transaction():
            uid_parts = DeviceUID.from_int(uid)
            self.control.uid.device_id = uid_parts.device_id
            self.control.uid.year = uid_parts.year
            self.control.uid.random = uid_parts.random

    @property
    def subscription(self) -> frozenset[str]:
        """The names of parameters subscribed to."""
        with self.transaction():
            params = self._from_bitmap(self.control.subscription)
            return frozenset(param.name for param in params)

    @property
    def last_write(self) -> float:
        """The timestamp given by :func:`time.time` of the last write."""
        with self.transaction():
            return float(self.control.last_write)

    @property
    def last_update(self) -> float:
        """The timestamp given by :func:`time.time` of the last update."""
        with self.transaction():
            return float(self.control.last_update)

    @property
    def interval(self) -> float:
        """The subscription interval in seconds."""
        with self.transaction():
            return float(self.control.interval) / 1000


NullDevice = DeviceBuffer.make_type('null-device', [])
"""A buffer type with no parameters.

Useful for creating a non-null placeholder where a buffer is required.
"""

BufferKey = Union[int, tuple[str, int]]
Catalog = Mapping[str, type[Buffer]]


@dataclass
class BufferStore(collections.abc.Mapping[BufferKey, Buffer]):
    """Manage the lifecycle of a collection of buffers.

    Every device type has a unique name and every device has an integer identifier
    (UID) unique among its type. A type name and UID pair uniquely identifies a device
    globally. For Smart Devices, the UID encodes the type, so its UID alone specifies
    a buffer.

    A :class:`BufferStore` maps type name and UID pairs to buffer instances. The store
    implements the context manager protocol for automatically closing all open buffers.

    Parameters:
        catalog: A device catalog mapping unique type names to buffer types. The
            buffer types should be generated with the :meth:`Buffer.make_type` factory.
        buffers: A mapping from type name and UID pairs to buffer instances.
        stack: An exit stack for closing buffers.
        shared: Whether buffers should be created shared memory.
    """

    catalog: Catalog
    buffers: MutableMapping[tuple[str, int], Buffer] = field(default_factory=dict)
    stack: contextlib.ExitStack = field(default_factory=contextlib.ExitStack)
    shared: bool = True
    device_ids: Mapping[int, str] = field(init=False, repr=False)

    def __post_init__(self, /) -> None:
        self.device_ids = self._make_device_ids()

    def _make_device_ids(self, /) -> Mapping[int, str]:
        device_ids = {}
        for type_name, buf_type in self.catalog.items():
            device_id = getattr(buf_type, 'device_id', None)
            if device_id is not None:
                if device_id in device_ids:
                    raise DeviceBufferError(
                        'duplicate Smart Device ID',
                        device_id=device_id,
                    )
                device_ids[device_id] = type_name
        return device_ids

    def __enter__(self, /) -> 'BufferStore':
        self.stack.__enter__()
        return self

    def __exit__(
        self,
        exc_type: Optional[type[BaseException]],
        exc: Optional[BaseException],
        traceback: Optional[types.TracebackType],
        /,
    ) -> Optional[bool]:
        return self.stack.__exit__(exc_type, exc, traceback)

    def __getitem__(self, key: BufferKey, /) -> Buffer:
        return self.get_or_open(key, create=False)

    def __iter__(self, /) -> Iterator[BufferKey]:
        return iter(self.buffers)

    def __len__(self, /) -> int:
        return len(self.buffers)

    def normalize_key(self, key: BufferKey, /) -> tuple[str, int]:
        """Convert a Smart Device UID into the type name and UID format.

        Returns:
            The type name and UID pair.
        """
        if isinstance(key, int):
            uid = DeviceUID.from_int(key)
            return self.device_ids[uid.device_id], key
        return key

    @typing.overload
    def get_or_open(self, key: int, /, *, create: bool = ...) -> DeviceBuffer:
        ...

    @typing.overload
    def get_or_open(self, key: tuple[str, int], /, *, create: bool = ...) -> Buffer:
        ...

    def get_or_open(self, key: BufferKey, /, *, create: bool = True) -> Buffer:
        """Get a buffer, opening a new one if necessary.

        Parameters:
            key: A buffer identifier.
            create: Whether to create a new buffer if one does not already exist.

        Raises:
            KeyError: The device ID or type name does not exist.
            DeviceBufferError: If ``create=False``, but the buffer does not exist.
        """
        type_name, uid = key = self.normalize_key(key)
        buffer = self.buffers.get(key)
        if not buffer:
            buf_type = self.catalog[type_name]
            if self.shared:
                name = f'rt-{type_name}-{uid}'
                buffer = self.stack.enter_context(buf_type.open(name, create=create))
            else:
                if not create:
                    raise DeviceBufferError(
                        'local buffer not found',
                        type=type_name,
                        uid=str(uid),
                    )
                buffer = buf_type.attach()
                buffer.valid = True
            self.buffers[key] = buffer
            self.stack.callback(self.buffers.pop, key)
        return buffer

    @staticmethod
    def unlink_all(shm_path: Path = Path('/dev/shm')) -> None:
        """Unlink all shared buffers owned by Runtime."""
        for path in shm_path.glob('rt-*'):
            Buffer.unlink(path.name)

    @staticmethod
    def _make_params(attrs: dict[str, Any]) -> Iterator[Parameter]:
        for index, param in enumerate(attrs.pop('params', [])):
            param.setdefault('id', index)
            param['ctype'] = Parameter.parse_ctype(param.pop('type'))
            yield Parameter(**param)

    @classmethod
    def make_catalog(cls, catalog: dict[str, dict[str, Any]]) -> Catalog:
        """Generate buffer types from the raw peripheral specification.

        The raw peripheral specification follows this form::

            {
                "device_id": <int>,             # For Smart Devices only
                "sub_interval": <float>,          # Optional
                "write_interval": <float>,        # Optional
                "heartbeat_interval": <float>,    # Optional
                "params": [
                    # Keyword arguments of ``Parameter``
                    {"name": <str>, "type": <str>}
                ]
            }
        """
        catalog_types = {}
        for type_name, attrs in catalog.items():
            params = list(cls._make_params(attrs))
            base_type = DeviceBuffer if 'device_id' in attrs else Buffer
            catalog_types[type_name] = base_type.make_type(type_name, params, **attrs)
        return catalog_types
