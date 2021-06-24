"""Remote (procedure) calls.

Much like :mod:`asyncio`'s transports and protocols, this module is divided into
low-level and high-level APIs:

* The low-level API, :class:`Node` and its implementations, deal with transporting
  discrete binary messages and managing the underlying transport.
* The high-level API, :class:`Endpoint` and its implementations, implement
  request/response semantics. Most consumers should use the high-level API.

This remote call message format is based on `MessagePack-RPC`_, except this module uses
:mod:`cbor2` for serialization.

Every application (process) typically creates a single :class:`Handler` bound to one or
more :class:`Service` instances. The handler encapsulates the application's business
logic and state, while each service exposes the handler's methods to a different
transport.

.. _MessagePack-RPC:
    https://github.com/msgpack-rpc/msgpack-rpc/blob/master/spec.md
"""

import abc
import asyncio
import contextlib
import enum
import functools
import inspect
import random
import socket
import types
import typing
from collections.abc import (
    AsyncIterator,
    Awaitable,
    Callable,
    Collection,
    Iterator,
    MutableMapping,
)
from dataclasses import dataclass, field
from typing import Any, Generic, NoReturn, Optional, Protocol, TypeVar, Union
from urllib.parse import urlsplit

import cbor2
import structlog
import zmq
import zmq.asyncio
import zmq.error

from .exception import RuntimeBaseException

__all__ = [
    'Client',
    'DatagramNode',
    'Endpoint',
    'Handler',
    'MessageType',
    'Node',
    'RemoteCallError',
    'RequestTracker',
    'Router',
    'Service',
    'SocketNode',
    'route',
]


class RemoteCallError(RuntimeBaseException):
    """Error produced by executing a remote call.

    Parameters:
        message: A human-readable description of the exception.
        context: Machine-readable data.
    """


class MessageType(enum.IntEnum):
    """The message type ID.

    Attributes:
        REQUEST: Denotes a request message sent by clients. Requires a response.
        RESPONSE: Denotes a response message sent by services.
        NOTIFICATION: Denotes a notification message sent by clients. Does not require a
            response. Unlike the synchronous request-response pattern, notifications may
            be pipelined (*i.e.*, multiple notifications in-flight simultaneously) for
            increased throughput.
    """

    REQUEST = 0
    RESPONSE = 1
    NOTIFICATION = 2


Segments = tuple[list[bytes], Any]
NodeType = TypeVar('NodeType', bound='Node')
EndpointType = TypeVar('EndpointType', bound='Endpoint')
SocketOptions = dict[int, Union[int, bytes]]


def get_logger(*factory_args: Any, **context: Any) -> structlog.stdlib.AsyncBoundLogger:
    """Get an unbound async-compatible logger."""
    logger = structlog.get_logger(
        *factory_args,
        **context,
        wrapper_class=structlog.stdlib.AsyncBoundLogger,
    )
    return typing.cast(structlog.stdlib.AsyncBoundLogger, logger)


@dataclass  # type: ignore[misc]
class Node(abc.ABC):  # https://github.com/python/mypy/issues/5374
    """A transceiver of discrete binary messages.

    A node wraps an underlying transport, such as a UDP endpoint, that it can repeatedly
    open, close, and reopen. :class:`Node` supports the async context manager protocol
    (reusable) for automatically managing the transport.

    When the transport is open, a node can send to and receive messages from one or more
    peers concurrently.

    State Diagram::

        start [-> closed]? -> open
            [[-> close -> open]? [-> send]? [-> recv]? [-> closed?]]*
        -> close -> end

    The data segments and address a :class:`Node` sends and receives are opaque to the
    node. Their format and semantics depend on the transport and :class:`Endpoint` the
    node works with.

    Attributes:
        send_count: The number of messages sent since the transport was opened.
        recv_count: The number of messages received since the transport was opened.
    """

    recv_queue: asyncio.Queue[Segments] = field(
        default_factory=lambda: asyncio.Queue(128),
        init=False,
        repr=False,
    )
    send_count: int = field(default=0, init=False, repr=False)
    recv_count: int = field(default=0, init=False, repr=False)

    async def __aenter__(self: NodeType, /) -> NodeType:
        if self.closed:
            await self.open()
            self.send_count = self.recv_count = 0
        return self

    async def __aexit__(
        self,
        _exc_type: Optional[type[BaseException]],
        _exc: Optional[BaseException],
        _traceback: Optional[types.TracebackType],
        /,
    ) -> None:
        if not self.closed:
            self.close()

    @abc.abstractmethod
    async def send(
        self,
        parts: list[bytes],
        /,
        *,
        address: Optional[Any] = None,
    ) -> None:
        """Send a message.

        Parameters:
            parts: Zero or more data segments.
            address: The destination's address.

        Raises:
            RemoteCallError: If the transport cannot send the message. May reopen the
                internal transport.
        """

    async def recv(self, /) -> Segments:
        """Receive a message.

        Returns:
            Zero or more data segments and an address, which are transport-dependent.

        Raises:
            RemoteCallError: If the transport cannot receive a message.

        Note:
            Asking the transport directly for messages may be problematic if it is
            reopened or does not support concurrent waiters.
        """
        if not self.can_recv:
            raise RemoteCallError('transport does not support recv')
        item = await self.recv_queue.get()
        self.recv_count += 1
        return item

    @abc.abstractmethod
    async def open(self, /) -> None:
        """Open the internal transport."""

    @abc.abstractmethod
    def close(self, /) -> None:
        """Close the internal transport."""

    @property
    @abc.abstractmethod
    def closed(self, /) -> bool:
        """Whether the internal transport is closed."""

    @property
    @abc.abstractmethod
    def can_recv(self, /) -> bool:
        """Whether the transport can receive messages."""

    @contextlib.asynccontextmanager
    async def _maybe_reopen(
        self,
        /,
        *exc_types: type[Exception],
    ) -> AsyncIterator[None]:
        """An async context manager for reopening the transport when an error occurs.

        Parameters:
            exc_types: Exception types to catch. If none are given, defaults to
                :class:`Exception`.

        Raises:
            RemoteCallError: If the transport is reopened.
        """
        if self.closed:
            raise RemoteCallError('transport is closed')
        exc_types = exc_types or (Exception,)
        try:
            yield
        except exc_types as exc:
            self.close()
            await self.open()
            raise RemoteCallError('node transport reopened') from exc


SocketOptionType = tuple[int, int, Union[int, bytes]]


@dataclass
class DatagramNode(Node, asyncio.DatagramProtocol):
    """A wrapper around :mod:`asyncio`'s datagram support.

    Parameters:
        host: Hostname.
        port: Port number.
        bind: Whether to bind the socket to a local address or connect to a remote one.
        options: Socket options in the form `(level, option, value)` passed to
            :meth:`socket.socket.setsockopt`.
    """

    host: str = ''
    port: int = 8000
    bind: bool = True
    options: Collection[SocketOptionType] = frozenset()
    transport: Optional[asyncio.DatagramTransport] = field(
        default=None,
        init=False,
        repr=False,
    )

    def datagram_received(self, data: bytes, addr: Any, /) -> None:
        with contextlib.suppress(asyncio.QueueFull):
            self.recv_queue.put_nowait(([data], addr))

    def connection_lost(self, exc: Optional[Exception], /) -> None:
        self.close()

    async def send(
        self,
        parts: list[bytes],
        /,
        *,
        address: Optional[tuple[str, int]] = None,
    ) -> None:
        if not self.transport:
            raise RemoteCallError('transport is not yet open')
        async with self._maybe_reopen():
            for part in parts:
                self.transport.sendto(part, addr=address)
        self.send_count += 1

    async def open(self, /) -> None:
        loop = asyncio.get_running_loop()
        kwargs: dict[str, Any] = {
            ('local_addr' if self.bind else 'remote_addr'): (self.host, self.port),
            'reuse_port': True,
            'family': socket.AF_INET,
        }
        transport, _ = await loop.create_datagram_endpoint(lambda: self, **kwargs)
        self.transport = typing.cast(asyncio.DatagramTransport, transport)
        sock = self.transport.get_extra_info('socket')
        for level, option, value in self.options:
            sock.setsockopt(level, option, value)

    def close(self, /) -> None:
        if self.transport:
            self.transport.close()

    @property
    def closed(self, /) -> bool:
        return self.transport.is_closing() if self.transport else True

    @property
    def can_recv(self, /) -> bool:
        return True

    @classmethod
    def from_address(
        cls,
        /,
        address: str,
        *,
        bind: bool = True,
        options: Collection[SocketOptionType] = frozenset(),
    ) -> 'DatagramNode':
        """Build a datagram node from an address.

        Parameters:
            address: The address to parse, in the form ``udp://[hostname[:port]]``.
            bind: True if this is a local address (socket is bound). False for a remote
                address (socket connects).
            options: Socket options passed to :class:`DatagramNode`.

        Raises:
            ValueError: If the address is not a valid UDP address.
        """
        components = urlsplit(address)
        if components.scheme != 'udp' or not components.hostname or not components.port:
            raise ValueError('must provide a UDP address')
        return DatagramNode(
            host=components.hostname,
            port=components.port,
            bind=bind,
            options=options,
        )


@dataclass
class SocketNode(Node):
    """A wrapper around :class:`zmq.asyncio.Socket` for handling timeouts.

    When the underlying socket of a :class:`SocketNode` times out, the socket is closed
    and rebuilt to reset socket's internal state. For example, a ``REQ`` socket may
    become stuck in the "listening" state indefinitely if the message it sent gets lost.

    Parameters:
        socket_type: The socket type (a constant defined under :mod:`zmq`).
        subscriptions: A set of topics to subscribe to (for ``SUB`` sockets only).
        options: A mapping of `ZMQ socket option symbols
            <http://api.zeromq.org/4-3:zmq-setsockopt>`_ to their values.
        connections: A set of addresses to connect to.
        bindings: A set of addresses to bind to.
    """

    socket_type: int = zmq.DEALER
    options: SocketOptions = field(default_factory=dict)
    bindings: frozenset[str] = frozenset()
    connections: frozenset[str] = frozenset()
    subscriptions: set[str] = field(default_factory=set)
    socket: zmq.asyncio.Socket = field(init=False, repr=False)
    recv_task: asyncio.Future[NoReturn] = field(
        default_factory=lambda: asyncio.get_running_loop().create_future(),
        init=False,
        repr=False,
    )

    def __post_init__(self, /) -> None:
        # TODO: remove this type coercion
        for attr in ('bindings', 'connections', 'subscriptions'):
            value = getattr(self, attr)
            if isinstance(value, str):
                setattr(self, attr, {value})
        self.bindings = frozenset(self.bindings)
        self.connections = frozenset(self.connections)
        if self.socket_type == zmq.SUB and not self.subscriptions:
            self.subscriptions.add('')
        if self.socket_type == zmq.DEALER:
            self.options.setdefault(zmq.PROBE_ROUTER, 1)
        if self.socket_type == zmq.ROUTER:
            self.options.setdefault(zmq.ROUTER_HANDOVER, 1)

    @property
    def identity(self, /) -> bytes:
        """The ZMQ identity of this socket."""
        ident = self.options.get(zmq.IDENTITY)
        return ident if isinstance(ident, bytes) else b'(anonymous)'

    async def send(
        self,
        parts: list[bytes],
        /,
        *,
        address: Optional[bytes] = None,
    ) -> None:
        if not address:
            raise RemoteCallError('must provide an address')
        async with self._maybe_reopen(zmq.error.Again):
            await self.socket.send_multipart([address, *parts])
        self.send_count += 1

    async def _recv_forever(self, /) -> NoReturn:
        """Receive messages indefinitely and enqueue them."""
        while True:
            with contextlib.suppress(RemoteCallError):
                async with self._maybe_reopen(zmq.error.Again):
                    sender_id, *frames = await self.socket.recv_multipart()
                    if self.socket_type == zmq.SUB:
                        sender_id = b''
                    await self.recv_queue.put((list(frames), sender_id))

    async def open(self, /) -> None:
        ctx = zmq.asyncio.Context.instance()
        self.socket = ctx.socket(self.socket_type)
        for name, value in self.options.items():
            self.socket.set(name, value)
        for address in self.bindings:
            self.socket.bind(address)
        for address in self.connections:
            self.socket.connect(address)
        if self.socket_type == zmq.SUB:
            for topic in self.subscriptions:
                self.socket.subscribe(topic)
        if self.can_recv:
            self.recv_task = asyncio.create_task(self._recv_forever(), name='recv')

    def close(self, /) -> None:
        self.recv_task.cancel()
        self.socket.close()

    @property
    def closed(self, /) -> bool:
        return bool(self.socket.closed) if getattr(self, 'socket', None) else True

    @property
    def can_recv(self, /) -> bool:
        return self.socket_type != zmq.PUB

    def subscribe(self, /, topic: str = '') -> None:
        """Subscribe to a topic (for ``zmq.SUB`` sockets only).

        Parameters:
            topic: The topic to subscribe to.
        """
        if self.socket_type == zmq.SUB:
            self.socket.subscribe(topic)
            self.subscriptions.add(topic)

    def unsubscribe(self, /, topic: str = '') -> None:
        """Unsubscribe from a topic (for ``zmq.SUB`` sockets only).

        Parameters:
            topic: The topic to unsubscribe from.
        """
        if self.socket_type == zmq.SUB:
            self.socket.unsubscribe(topic)
            self.subscriptions.discard(topic)

    def set_option(self, option: int, value: Union[int, bytes], /) -> None:
        """Set a socket option.

        Parameters:
            option: A socket option symbol defined by :mod:`zmq`.
            value: The option value (the type/format depends on the option).
        """
        self.socket.set(option, value)
        self.options[option] = value


def _check_type(node: Node, /, *allowed_types: int) -> None:
    """Raise a :class:`RemoteCallError` if this socket type is not allowed."""
    if isinstance(node, SocketNode) and node.socket_type not in allowed_types:
        raise RemoteCallError(
            'socket type not allowed',
            socket_type=node.socket_type,
            allowed_types=allowed_types,
        )


async def _encode(obj: Any, /) -> bytes:
    """Encode an object as a CBOR-encoded buffer in the default executor.

    Raises:
        cbor2.CBOREncodeError: If the encoding fails.
    """
    return await asyncio.to_thread(cbor2.dumps, obj)


async def _decode(buf: bytes, /) -> Any:
    """Decode a CBOR-encoded buffer in the default executor.

    Raises:
        cbor2.CBORDecodeError: If the decoding fails.
    """
    return await asyncio.to_thread(cbor2.loads, buf)


Method = Callable[..., Any]


class RemoteMethod(Protocol):
    """A remotely callable method (any signature, any return value)."""

    __remote__: str

    def __call__(self, /, *args: Any, **kwargs: Any) -> Any:
        ...


@typing.overload
def route(method_or_name: str, /) -> Callable[[Method], RemoteMethod]:
    ...


@typing.overload
def route(method_or_name: Method, /) -> RemoteMethod:
    ...


def route(
    method_or_name: Union[str, Method],
    /,
) -> Union[RemoteMethod, Callable[[Method], RemoteMethod]]:
    """Decorator for marking a bound method as an RPC target.

    Parameters:
        method_or_name: Either the method to be registered or the name it should be
            registered under. If the former, the method name is exposed to the
            :class:`Handler`. The latter is useful for exposing a name that is not a
            valid Python identifier.

    Returns:
        Either an identity decorator (if a name was provided) or the method provided.
    """
    if isinstance(method_or_name, str):

        def decorator(method: Callable[..., Any]) -> RemoteMethod:
            remote_method = typing.cast(RemoteMethod, method)
            remote_method.__remote__ = typing.cast(str, method_or_name)
            return remote_method

        return decorator
    remote_method = typing.cast(RemoteMethod, method_or_name)
    remote_method.__remote__ = method_or_name.__name__
    return remote_method


@dataclass  # type: ignore[misc]
class Endpoint(abc.ABC):  # https://github.com/python/mypy/issues/5374
    """A source or destination of messages.

    An :class:`Endpoint` has a number of workers (instances of :class:`asyncio.Task`)
    that listen for and process incoming messages. This allows for request pipelining.
    Once all workers are busy processing messages, the node wrapped by the endpoint
    buffers any additional messages.

    Parameters:
        node: The message transceiver. Not all node/endpoint pairs are compatible.
        concurrency: The number of workers.
        logger: A logger instance.
    """

    node: Node
    concurrency: int = 1
    logger: structlog.stdlib.AsyncBoundLogger = field(default_factory=get_logger)
    stack: contextlib.AsyncExitStack = field(
        default_factory=contextlib.AsyncExitStack,
        init=False,
        repr=False,
    )

    def __post_init__(self, /) -> None:
        if self.concurrency < 0:
            raise ValueError('concurrency must be a positive integer')

    async def __aenter__(self: EndpointType, /) -> EndpointType:
        await self.stack.__aenter__()
        self.node = await self.stack.enter_async_context(self.node)
        for _ in range(self.concurrency):
            worker = asyncio.create_task(self._process_forever(), name='process-msg')
            self.stack.callback(worker.cancel)
        return self

    async def __aexit__(
        self,
        exc_type: Optional[type[BaseException]],
        exc: Optional[BaseException],
        traceback: Optional[types.TracebackType],
        /,
    ) -> Optional[bool]:
        return await self.stack.__aexit__(exc_type, exc, traceback)

    async def _process_forever(self, /, *, cooldown: float = 0.01) -> NoReturn:
        """Receive messages indefinitely and process them."""
        logger = self.logger.bind()
        while True:
            try:
                frames, address = await self.node.recv()
                payload, *_ = frames
                message_type, *message = await _decode(payload)
                message_type = MessageType(message_type)
                await logger.debug(
                    'Endpoint received message', message_type=message_type.name
                )
                await self.handle_message(address, message_type, *message)
            except (ValueError, cbor2.CBORDecodeError, RemoteCallError) as exc:
                await logger.error('Endpoint failed to process message', exc_info=exc)
                await asyncio.sleep(cooldown)

    @abc.abstractmethod
    async def handle_message(
        self, address: Any, message_type: MessageType, *message: Any
    ) -> None:
        """Process a message.

        Parameters:
            address: The address of the message's sender, if available. The semantics
                depend on the node. Pass this argument directly to :meth:`Node.send`.
            message_type: The message type.
            message: Other message parts. The message type determines the format.

        Raises:
            ValueError: If the endpoint could not unpack part of the message.
            RemoteCallError: If the endpoint could not otherwise process the message.
        """


ResponseType = TypeVar('ResponseType')


@dataclass
class RequestTracker(Generic[ResponseType]):
    """Track outstanding requests and their results.

    Every request is associated with a unique request ID (an integer, or an object
    serializable as an integer).

    Parameters:
        futures: A mapping from request IDs to futures representing responses.
        lower: Minimum valid request ID.
        upper: Maximum valid request ID.
    """

    futures: MutableMapping[int, asyncio.Future[ResponseType]] = field(
        default_factory=dict,
    )
    lower: int = 0
    upper: int = (1 << 32) - 1

    def _try_generate_id(self, /) -> int:
        """Attempt to generate a request ID.

        Unlike :meth:`generate_uid`, the candidate ID does not need to be unique.
        """
        return random.randint(self.lower, self.upper)

    def generate_uid(self, /, *, attempts: int = 10) -> int:
        """Generate a unique request ID.

        Parameters:
            attempts: The maximum number of times to try to generate an ID.

        Raises:
            ValueError: If the tracker could not generate a unique ID. If the ID space
                is sufficiently large, this error is exceedingly rare. Increasing the
                number of attempts or decreasing the number of in-flight requests should
                increase the probability of a unique ID.
        """
        for _ in range(attempts):
            request_id = self._try_generate_id()
            if request_id not in self.futures:
                return request_id
        raise ValueError('unable to generate a request ID')

    @contextlib.contextmanager
    def new_request(
        self,
        /,
        request_id: Optional[int] = None,
    ) -> Iterator[tuple[int, asyncio.Future[ResponseType]]]:
        """Register a new request.

        Parameters:
            request_id: A unique request identifier. If not provided, a request ID is
                randomly generated.

        Returns:
            The request ID and a future representing the outcome of the request.
        """
        if request_id is None:
            request_id = self.generate_uid()
        elif request_id in self.futures:
            raise ValueError('request ID already exists')
        self.futures[request_id] = asyncio.get_running_loop().create_future()
        try:
            yield request_id, self.futures[request_id]
        finally:
            self.futures.pop(request_id, None)

    def register_response(
        self,
        /,
        request_id: int,
        result: Union[BaseException, ResponseType],
    ) -> None:
        """Register a request's response.

        Parameters:
            request_id: The request identifier returned from :meth:`new_request`.
            result: The response or exception.
        """
        future = self.futures[request_id]
        if isinstance(result, BaseException):
            future.set_exception(result)
        else:
            future.set_result(result)


Call = Callable[..., Awaitable[Any]]


@dataclass
class CallFactory:
    """
    A wrapper class around the call factory.

    This wrapper uses currying to partially complete the argument list to
    :meth:`Client.issue_call`.
    """

    issue_call: Call
    cached_partial: Callable[[str], Call] = field(init=False, repr=False)

    def __post_init__(self) -> None:
        make_cached = functools.lru_cache(maxsize=128)
        self.cached_partial: Callable[[str], Call] = make_cached(self._partial)

    def _partial(self, method: str) -> Call:
        return functools.partial(self.issue_call, method)

    def __getitem__(self, method: str) -> Call:
        return self.cached_partial(method)

    def __getattr__(self, method: str) -> Call:
        return self.cached_partial(method)


@dataclass
class Client(Endpoint):
    """An endpoint for issuing remote calls.

    A request is matched to its response with a message ID, a 32-bit integer unique
    among in-flight requests at any given time.

    Parameters:
        requests: Stores in-flight message IDs to futures. Each future represents the
            outcome of a call (a result or an exception).
        node: A node for transporting messages.
        concurrency: The number of workers for processing responses.
    """

    requests: RequestTracker[Any] = field(default_factory=RequestTracker)

    def __post_init__(self, /) -> None:
        _check_type(self.node, zmq.PUB, zmq.DEALER)
        if not self.node.can_recv:
            self.concurrency = 0
        super().__post_init__()

    async def handle_message(
        self,
        address: Any,
        message_type: MessageType,
        /,
        *message: Any,
    ) -> None:
        if message_type is not MessageType.RESPONSE:
            raise RemoteCallError(
                'client only receives RESPONSE messages',
                message_type=message_type,
                message_parts=message,
            )
        message_id, error, result = message
        if isinstance(error, list):
            error_message, context = error
            result = RemoteCallError(error_message, **context)
        try:
            self.requests.register_response(message_id, result)
        except KeyError as exc:
            raise RemoteCallError(
                'client received unexpected response',
                message_id=message_id,
            ) from exc

    async def issue_call(
        self,
        method: str,
        /,
        *args: Any,
        address: Optional[Any] = None,
        notification: bool = False,
        timeout: float = 5,
    ) -> Any:
        """Issue a remote procedure call and possibly wait for the result.

        Parameters:
            method: Method name.
            args: Method arguments.
            address: A transport-dependent address.
            notification: False iff this call requires a response. Has no effect for
                nodes that cannot receive data, which can *only* send notifications.
            timeout: Maximum duration (in seconds) to wait for a response.

        Raises:
            asyncio.TimeoutError: The request was successfully sent, but the response
                never arrived in time.
            ValueError: If the request tracker could not generate a unique message ID.
            RemoteCallError: If the service returned an error.
            cbor2.CBOREncodeError: If the arguments were not serializable.

        Note:
            Notification calls will not raise an exception client-side if the server
            fails, even if the node supports duplex communication.
        """
        if not self.node.can_recv:
            notification = True
        if isinstance(self.node, SocketNode) and self.node.socket_type == zmq.PUB:
            address = address or method.encode()
        await self.logger.debug(
            'Issuing remote procedure call',
            method=method,
            notification=notification,
        )
        if notification:
            request = [MessageType.NOTIFICATION.value, method, args]
            await self.node.send([await _encode(request)], address=address)
        else:
            with self.requests.new_request() as (message_id, result):
                request = [MessageType.REQUEST.value, message_id, method, args]
                await self.node.send([await _encode(request)], address=address)
                return await asyncio.wait_for(result, timeout)

    @functools.cached_property
    def call(self, /) -> CallFactory:
        """Syntactic sugar for issuing remote procedure calls.

        Instead of::

            await client.issue_call('add', 1, 2)

        Replace with either of::

            await client.call.add(1, 2)
            await client.call['add'](1, 2)
        """
        return CallFactory(self.issue_call)


class Handler:
    """An object whose bound methods are exposed to remote callers.

    Define a handler by subclassing :class:`Handler` and applying the :func:`route`
    decorator:

    >>> class CustomHandler(Handler):
    ...     @route
    ...     async def method1(self, arg: int) -> int:
    ...         ...
    ...     @route('non-python-identifier')
    ...     def method2(self):
    ...         ...
    """

    @functools.cached_property
    def _method_table(self) -> dict[str, types.MethodType]:
        """A mapping of method names to (possibly coroutine) bound methods."""
        # Need to use the class to avoid calling `getattr(...)` on this property.
        # Accessing bound methods directly can lead to infinite recursion.
        funcs = inspect.getmembers(self.__class__, inspect.isfunction)
        funcs = [(attr, func) for attr, func in funcs if hasattr(func, '__remote__')]
        return {func.__remote__: getattr(self, attr) for attr, func in funcs}

    async def dispatch(self, method: str, *args: Any, timeout: float = 30) -> Any:
        """Dispatch a remote procedure call.

        If the method is synchronous (possibly blocking), the default executor performs
        the call.

        Parameters:
            method: The procedure name.
            args: Positional arguments for the procedure.

        Returns:
            The procedure's result, which must be CBOR-serializable.

        Raises:
            RemoteCallError: The procedure call does not exist, timed out, or raised an
                exception.
        """
        func = self._method_table.get(method)
        if not func:
            raise RemoteCallError('no such method exists', method=method)
        try:
            if inspect.iscoroutinefunction(func):
                call = func(*args)
            else:
                call = asyncio.to_thread(func, *args)
            return await asyncio.wait_for(call, timeout)
        except asyncio.TimeoutError as exc:
            raise RemoteCallError('method timed out', timeout=timeout) from exc
        except Exception as exc:
            raise RemoteCallError('method produced an error') from exc


@dataclass
class Service(Endpoint):
    """Responds to RPC requests.

    Parameters:
        handler: The object whose bound methods this service will call.
        timeout: Maximum duration (in seconds) to execute methods for.
    """

    handler: Handler = field(default_factory=Handler)
    timeout: float = 30

    def __post_init__(self) -> None:
        _check_type(self.node, zmq.SUB, zmq.DEALER)

    async def handle_message(
        self, address: Any, message_type: MessageType, *message: Any
    ) -> None:
        if message_type is MessageType.REQUEST:
            message_id, method, args = message
        elif message_type is MessageType.NOTIFICATION:
            message_id, (method, args) = None, message
        else:
            await self.logger.warn(
                'Service does not support message',
                message_type=message_type.name,
            )
            return
        try:
            result = await self.handler.dispatch(method, *args, timeout=self.timeout)
            error = None
        except RemoteCallError as exc:
            result, error = None, [str(exc), exc.context]
            await self.logger.error(
                'Service was unable to execute call',
                message_type=message_type.name,
                message_id=message_id,
                exc_info=exc,
            )
        if message_type is MessageType.REQUEST:
            response = [MessageType.RESPONSE.value, message_id, error, result]
            await self.node.send([await _encode(response)], address=address)


def _render_id(identity: bytes) -> str:
    with contextlib.suppress(UnicodeDecodeError):
        decoded = identity.decode()
        if decoded.isprintable():
            return decoded
    return identity.hex()


async def _route(recv_socket: SocketNode, send_socket: SocketNode) -> NoReturn:
    """Route messages in one direction.

    A :class:`Router` is duplex, but the frame format and implementation for each
    direction are identical.

    Parameters:
        recv_socket: The receiving socket, which indefinitely reads five-frame
            messages consisting of the sender's ZMQ identity, the recipient's
            identity, and the payload, with empty delimeter frames sandwiched
            between them.
        send_socket: The sending socket, which simply transposes the
            sender/recipient ID frames.
    """
    logger = get_logger().bind(
        recv_socket=_render_id(recv_socket.identity),
        send_socket=_render_id(send_socket.identity),
    )
    await logger.info('Router started')
    while True:
        try:
            frames, sender_id = await recv_socket.recv()
            if frames == [b'']:
                await logger.info(
                    'Router connected to endpoint',
                    sender_id=_render_id(sender_id),
                )
                continue
            recipient_id, payload = frames
            await logger.debug(
                'Router received message',
                sender_id=_render_id(sender_id),
                recipient_id=_render_id(recipient_id),
            )
            if sender_id == recipient_id:
                await logger.warn(
                    'Loopback not allowed',
                    sender_id=_render_id(sender_id),
                )
                continue
            await send_socket.send([sender_id, payload], address=recipient_id)
        except (ValueError, RemoteCallError) as exc:
            await logger.error('Router failed to route message', exc_info=exc)


@dataclass
class Router:
    """Routes messages between :class:`Client`s and :class:`Service`s that use sockets.

    Routers are stateless, duplex, and symmetric (*i.e.*, require the same format and
    exhibit the same behavior on both ends).

    Routers have no error handling and may silently drop messages if the destination is
    unreachable. Clients must rely on timeouts to determine when to consider a request
    failed.

    The payloads themselves are opaque to the router and are not deserialized.

    Parameters:
        frontend: A ``ROUTER`` socket clients connect to.
        backend: A ``ROUTER`` socket services connect to.
        route_task: The background task performing the routing. :class:`Router`
            implements the async context manager protocol, which automatically schedules
            and cancels this task.
    """

    frontend: SocketNode
    backend: SocketNode
    route_task: asyncio.Future[tuple[NoReturn, NoReturn]] = field(
        default_factory=lambda: asyncio.get_running_loop().create_future(),
        init=False,
        repr=False,
    )

    def __post_init__(self, /) -> None:
        _check_type(self.frontend, zmq.ROUTER)
        _check_type(self.backend, zmq.ROUTER)

    async def __aenter__(self, /) -> 'Router':
        await self.frontend.__aenter__()
        await self.backend.__aenter__()
        self.route_task = asyncio.gather(
            asyncio.create_task(_route(self.frontend, self.backend), name='route-req'),
            asyncio.create_task(_route(self.backend, self.frontend), name='route-res'),
        )
        return self

    async def __aexit__(
        self,
        exc_type: Optional[type[BaseException]],
        exc: Optional[BaseException],
        traceback: Optional[types.TracebackType],
    ) -> None:
        self.route_task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await self.route_task
        await self.frontend.__aexit__(exc_type, exc, traceback)
        await self.backend.__aexit__(exc_type, exc, traceback)

    @classmethod
    def bind(
        cls,
        frontend: Collection[str],
        backend: Collection[str],
        frontend_options: Optional[SocketOptions] = None,
        backend_options: Optional[SocketOptions] = None,
    ) -> 'Router':
        """Construct a :class:`Router` bound to the provided addresses."""
        # pylint: disable=unexpected-keyword-arg; dataclass not recognized
        frontend_options = frontend_options or {}
        backend_options = backend_options or {}
        frontend_options.setdefault(zmq.IDENTITY, b'router-frontend')
        backend_options.setdefault(zmq.IDENTITY, b'router-backend')
        return Router(
            SocketNode(
                socket_type=zmq.ROUTER,
                bindings=frozenset(frontend),
                options=frontend_options,
            ),
            SocketNode(
                socket_type=zmq.ROUTER,
                bindings=frozenset(backend),
                options=backend_options,
            ),
        )
