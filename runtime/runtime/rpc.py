"""Remote Procedure Calls (RPC).

In this object-oriented context, RPC is synonymous with remote method invocation (RMI).

Much like :mod:`asyncio`'s transports and protocols, this module is divided into low-level and
high-level APIs:

    * The low-level API, :class:`Node` and its descendents, deal with transporting discrete binary
      messages and managing the underlying transport.
    * The high-level API, :class:`Endpoint` and its descendents, implement request/response
      semantics. Most consumers should use the high-level API.
"""

import abc
import asyncio
import contextlib
import dataclasses
import enum
import functools
import inspect
import random
import types
import typing
from typing import (
    Any,
    AsyncIterator,
    Awaitable,
    Callable,
    Collection,
    Generic,
    Iterator,
    NoReturn,
    Optional,
    Protocol,
    TypeVar,
    Union,
)
from urllib.parse import urlsplit

import cbor2
import structlog
import zmq
import zmq.asyncio

from .exception import RuntimeBaseException

__all__ = [
    'RuntimeRPCError',
    'MessageType',
    'DatagramNode',
    'SocketNode',
    'Client',
    'Service',
    'Router',
]


class RuntimeRPCError(RuntimeBaseException):
    """General RPC error."""


class MessageType(enum.IntEnum):
    """The message type ID. See the `MessagePack-RPC Specification`_.

    .. _MessagePack-RPC Specification:
        https://github.com/msgpack-rpc/msgpack-rpc/blob/master/spec.md
    """

    REQUEST = 0
    RESPONSE = 1
    NOTIFICATION = 2


Segments = tuple[list[bytes], Any]
NodeType = TypeVar('NodeType', bound='Node')
EndpointType = TypeVar('EndpointType', bound='Endpoint')
SocketOptions = dict[int, Union[int, bytes]]


def get_logger(*factory_args: Any, **context: Any) -> structlog.stdlib.AsyncBoundLogger:
    logger = structlog.get_logger(
        *factory_args,
        **context,
        wrapper_class=structlog.stdlib.AsyncBoundLogger,
    )
    return typing.cast(structlog.stdlib.AsyncBoundLogger, logger)


@dataclasses.dataclass  # type: ignore[misc]
class Node(abc.ABC):  # https://github.com/python/mypy/issues/5374
    """An abstraction for a transceiver of discrete binary messages.

    A node wraps an underlying transport, such as a UDP endpoint, that it can repeatedly open,
    close, and reopen. :class:`Node` supports the async context manager protocol (reentrant and
    reusable) for automatically managing the transport.

    When the transport is open, a node can send to and receive messages from one or more peers
    concurrently.

    State diagram::

        start [-> closed]? -> open
            [[-> close -> open]? [-> send]? [-> recv]? [-> closed?]]*
        -> close -> end

    Attributes:
        recv_queue: An async queue buffering incoming messages.
        send_count: The number of messages sent since the transport was opened.
        recv_count: The number of messages received since the transport was opened.
    """

    recv_queue: asyncio.Queue[Segments] = dataclasses.field(
        default_factory=lambda: asyncio.Queue(128),
    )
    send_count: int = 0
    recv_count: int = 0

    async def __aenter__(self: NodeType) -> NodeType:
        if self.closed:
            await self.open()
            self.send_count = self.recv_count = 0
        return self

    async def __aexit__(
        self,
        _exc_type: Optional[type[BaseException]],
        _exc: Optional[BaseException],
        _traceback: Optional[types.TracebackType],
    ) -> None:
        if not self.closed:
            self.close()

    @abc.abstractmethod
    async def send(self, parts: list[bytes], address: Optional[Any] = None) -> None:
        """Send a message.

        Arguments:
            parts: Zero or more data segments. The semantics of these segments are opaque.
            address: The destination's address. The type depends on the underlying transport.

        Raises:
            RuntimeRPCError: If the operation fails. May reopen the internal transport.
        """

    async def recv(self) -> Segments:
        """Receive a message.

        Returns:
            A list of zero or more data segments and an address, which is transport-dependent.

        Raises:
            ValueError: If the transport cannot receive messages.

        Note:
            Asking the transport directly for messages may be problematic if it is reopened or does
            not support concurrent waiters.
        """
        if not self.can_recv:
            raise ValueError('transport does not support recv')
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
    async def maybe_reopen(self, *exc_types: type[Exception]) -> AsyncIterator[None]:
        """An async context manager for reopening the transport when an error occurs.

        Arguments:
            *exc_types: Exception types to catch.

        Raises:
            RuntimeRPCError: If the transport is reopened.
        """
        if self.closed:
            raise RuntimeRPCError('transport is closed')
        exc_types = exc_types or (Exception,)
        try:
            yield
        except exc_types as exc:
            self.close()
            await self.open()
            raise RuntimeRPCError('node transport reopened') from exc


SocketOptionType = tuple[int, int, Union[int, bytes]]


@dataclasses.dataclass
class DatagramNode(Node, asyncio.DatagramProtocol):
    """A wrapper around asyncio's datagram .

    Attributes:
        host: Hostname.
        port: Port number.
        bind: Whether to bind the socket to a local address or connect to a remote one.
        options: Socket options.
        transport: The datagram transport created.
    """

    host: str = ''
    port: int = 8000
    bind: bool = True
    options: Collection[SocketOptionType] = frozenset()
    transport: Optional[asyncio.DatagramTransport] = None

    def datagram_received(self, data: bytes, addr: Any) -> None:
        with contextlib.suppress(asyncio.QueueFull):
            self.recv_queue.put_nowait(([data], addr))

    def connection_lost(self, exc: Optional[Exception]) -> None:
        self.close()

    async def send(self, parts: list[bytes], address: Optional[tuple[str, int]] = None) -> None:
        if not self.transport:
            raise RuntimeRPCError('transport is not yet open')
        async with self.maybe_reopen():
            for part in parts:
                self.transport.sendto(part, addr=address)
        self.send_count += 1

    async def open(self, /) -> None:
        loop = asyncio.get_running_loop()
        kwargs: dict[str, Any] = {
            ('local_addr' if self.bind else 'remote_addr'): (self.host, self.port),
            'reuse_port': True,
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

        Arguments:
            address: The address to parse, in the form "udp://[hostname[:port]]".
            bind: True if this is a local address (socket is bound). False for a remote address.
            options: Keyword options passed to
                :meth:`asyncio.AbstractEventLoop.create_datagram_endpoint`.

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


@dataclasses.dataclass
class SocketNode(Node):
    """A wrapper around :class:`zmq.asyncio.Socket` for handling timeouts.

    When the underlying socket of a :class:`BaseSocket` times out, the socket is closed and rebuilt
    to reset socket's internal state. For example, a ``REQ`` socket may become stuck in the
    "listening" state indefinitely if the message it sent gets lost.

    .. _ZMQ Socket Options:
        http://api.zeromq.org/4-1:zmq-setsockopt
    """

    socket_type: int = zmq.DEALER
    options: SocketOptions = dataclasses.field(default_factory=dict)
    bindings: frozenset[str] = frozenset()
    connections: frozenset[str] = frozenset()
    subscriptions: set[str] = dataclasses.field(default_factory=set)
    socket: zmq.asyncio.Socket = dataclasses.field(init=False, repr=False)
    recv_task: asyncio.Future[NoReturn] = dataclasses.field(
        default_factory=lambda: asyncio.get_running_loop().create_future(),
        init=False,
        repr=False,
    )

    def __post_init__(self) -> None:
        for attr in ('bindings', 'connections', 'subscriptions'):
            value = getattr(self, attr)
            if isinstance(value, str):
                setattr(self, attr, {value})
        self.bindings, self.connections = frozenset(self.bindings), frozenset(self.connections)
        if self.socket_type == zmq.SUB and not self.subscriptions:
            self.subscriptions.add('')
        if self.socket_type == zmq.DEALER:
            self.options.setdefault(zmq.PROBE_ROUTER, 1)
        if self.socket_type == zmq.ROUTER:
            self.options.setdefault(zmq.ROUTER_HANDOVER, 1)

    @property
    def identity(self, /) -> bytes:
        ident = self.options.get(zmq.IDENTITY)
        return ident if isinstance(ident, bytes) else b'(anonymous)'

    async def send(self, parts: list[bytes], address: Optional[bytes] = None) -> None:
        if not address:
            raise RuntimeRPCError('must provide an address')
        async with self.maybe_reopen(zmq.error.Again):
            await self.socket.send_multipart([address, *parts])
        self.send_count += 1

    async def _recv_forever(self) -> NoReturn:
        """Receive messages indefinitely and enqueue them."""
        while True:
            with contextlib.suppress(RuntimeRPCError):
                async with self.maybe_reopen(zmq.error.Again):
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

    def subscribe(self, topic: str = '') -> None:
        """Subscribe to a topic (for ``SUB`` sockets only)."""
        if self.socket_type == zmq.SUB:
            self.socket.subscribe(topic)
            self.subscriptions.add(topic)

    def unsubscribe(self, topic: str = '') -> None:
        """Unsubscribe from a topic (for ``SUB`` sockets only)."""
        if self.socket_type == zmq.SUB:
            self.socket.unsubscribe(topic)
            self.subscriptions.discard(topic)

    def set_option(self, option: int, value: Union[int, bytes]) -> None:
        """Set a socket option."""
        self.socket.set(option, value)
        self.options[option] = value


def _check_type(node: Node, *allowed_types: int) -> None:
    """Raise a :class:`RuntimeRPCError` if this socket type is not allowed."""
    if isinstance(node, SocketNode) and node.socket_type not in allowed_types:
        raise RuntimeRPCError(
            'socket type not allowed',
            socket_type=node.socket_type,
            allowed_types=allowed_types,
        )


async def encode(obj: Any) -> bytes:
    """Encode an object as a CBOR-encoded buffer in the default executor.

    Raises:
        cbor2.CBOREncodeError: If the encoding fails.
    """
    return await asyncio.to_thread(cbor2.dumps, obj)


async def decode(buf: bytes) -> Any:
    """Decode a CBOR-encoded buffer in the default executor.

    Raises:
        cbor2.CBORDecodeError: If the decoding fails.
    """
    return await asyncio.to_thread(cbor2.loads, buf)


Method = Callable[..., Any]


class RemoteMethod(Protocol):
    __rpc__: str

    def __call__(self, /, *args: Any, **kwargs: Any) -> Any:
        ...


@typing.overload
def route(method_or_name: str) -> Callable[[Method], RemoteMethod]:
    ...


@typing.overload
def route(method_or_name: Method) -> RemoteMethod:
    ...


def route(
    method_or_name: Union[str, Method],
) -> Union[RemoteMethod, Callable[[Method], RemoteMethod]]:
    """Decorator for marking a bound method as an RPC target.

    Arguments:
        method_or_name: Either the method to be registered or the name it should be registered
            under. If the former, registered name defaults to the method name.
        name: The name exposed to the RPC dispatcher. Useful for names that are not valid
            Python identifiers. Defaults to the method name.

    Returns:
        Either an identity decorator (if the method name was provided) or the method provided.
    """
    if isinstance(method_or_name, str):

        def decorator(method: Callable[..., Any]) -> RemoteMethod:
            remote_method = typing.cast(RemoteMethod, method)
            remote_method.__rpc__ = typing.cast(str, method_or_name)
            return remote_method

        return decorator
    remote_method = typing.cast(RemoteMethod, method_or_name)
    remote_method.__rpc__ = method_or_name.__name__
    return remote_method


@dataclasses.dataclass  # type: ignore[misc]
class Endpoint(abc.ABC):  # https://github.com/python/mypy/issues/5374
    """A source or destination of messages.

    An :class:`Endpoint` has a number of workers (instances of :class:`asyncio.Task`) that listen
    for and process incoming messages. This allows for request pipelining. Once all workers are
    busy processing messages, the underlying ZMQ socket buffers any additional messages.

    Attributes:
        node: The message transceiver. Not all node/endpoint configurations are compatible.
        concurrency: The number of workers.
        logger: A logger instance.
        stack: An async exit stack for automatically cancelling workers and closing the node.
    """

    node: Node
    concurrency: int = 1
    stack: contextlib.AsyncExitStack = dataclasses.field(default_factory=contextlib.AsyncExitStack)
    logger: structlog.stdlib.AsyncBoundLogger = dataclasses.field(default_factory=get_logger)

    def __post_init__(self) -> None:
        if self.concurrency < 0:
            raise ValueError('concurrency must be a positive integer')

    async def __aenter__(self: EndpointType) -> EndpointType:
        await self.stack.__aenter__()
        self.node = await self.stack.enter_async_context(self.node)
        for _ in range(self.concurrency):
            worker = asyncio.create_task(self.process_messages_forever(), name='process-msg')
            self.stack.callback(worker.cancel)
        return self

    async def __aexit__(
        self,
        exc_type: Optional[type[BaseException]],
        exc: Optional[BaseException],
        traceback: Optional[types.TracebackType],
    ) -> Optional[bool]:
        return await self.stack.__aexit__(exc_type, exc, traceback)

    async def process_messages_forever(self, /, *, cooldown: float = 0.01) -> NoReturn:
        """Receive messages indefinitely and process them."""
        logger = self.logger.bind()
        while True:
            try:
                frames, address = await self.node.recv()
                payload, *_ = frames
                message_type, *message = await decode(payload)
                message_type = MessageType(message_type)
                await logger.debug('Endpoint received message', message_type=message_type.name)
                await self.handle_message(address, message_type, *message)
            except (ValueError, cbor2.CBORDecodeError, RuntimeRPCError) as exc:
                await logger.error('Endpoint failed to process message', exc_info=exc)
                await asyncio.sleep(cooldown)

    @abc.abstractmethod
    async def handle_message(self, address: Any, message_type: MessageType, *message: Any) -> None:
        """Process a message.

        Arguments:
            address: The address of the message's sender, if available. The semantics depend on the
                node. Pass this argument directly to :meth:`Node.send`.
            message_type: The message type.
            *message: Other message parts. The message type determines the parts' format.

        Raises:
            ValueError: If the endpoint could not unpack part of the message.
            RuntimeRPCError: If the endpoint was otherwise unable to process the message.
        """


ResponseType = TypeVar('ResponseType')


@dataclasses.dataclass
class RequestTracker(Generic[ResponseType]):
    futures: dict[int, asyncio.Future[ResponseType]] = dataclasses.field(default_factory=dict)
    lower: int = 0
    upper: int = 1 << 32

    def generate_id(self) -> int:
        return random.randrange(self.lower, self.upper)

    def generate_uid(self, attempts: int = 10) -> int:
        """Generate a unique request ID.

        Arguments:
            attempts: The maximum number of times to try to generate an ID.

        Raises:
            ValueError: If the tracker could not generate a unique ID. If the ID space is
                sufficiently large, this error is exceedingly rare. Increasing the number of
                attempts or decreasing the number of in-flight requests should increase the
                probability of a unique ID.
        """
        for _ in range(attempts):
            request_id = self.generate_id()
            if request_id not in self.futures:
                return request_id
        raise ValueError('unable to generate a request ID')

    @contextlib.contextmanager
    def new_request(
        self,
        request_id: Optional[int] = None,
    ) -> Iterator[tuple[int, asyncio.Future[ResponseType]]]:
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
        request_id: int,
        result: Union[BaseException, ResponseType],
    ) -> None:
        future = self.futures[request_id]
        if isinstance(result, BaseException):
            future.set_exception(result)
        else:
            future.set_result(result)


Call = Callable[..., Awaitable[Any]]


@dataclasses.dataclass
class CallFactory:
    """
    A wrapper class around the call factory.

    This wrapper uses currying to partially complete the argument list to
    :meth:`Client.issue_call`.
    """

    issue_call: Call
    cached_partial: Callable[[str], Call] = dataclasses.field(init=False, repr=False)

    def __post_init__(self) -> None:
        self.cached_partial: Callable[[str], Call] = functools.lru_cache(maxsize=128)(self._partial)

    def _partial(self, method: str) -> Call:
        return functools.partial(self.issue_call, method)

    def __getitem__(self, method: str) -> Call:
        return self.cached_partial(method)

    def __getattr__(self, method: str) -> Call:
        return self.cached_partial(method)


@dataclasses.dataclass
class Client(Endpoint):
    """Issue RPC requests.

    A request is matched to its response with a message ID, a 32-bit integer unique among in-flight
    requests at any given time.

    Attributes:
        requests: A mapping of in-flight message IDs to futures. Each future represents the outcome
            of a call.
    """

    requests: RequestTracker[Any] = dataclasses.field(default_factory=RequestTracker)

    def __post_init__(self) -> None:
        _check_type(self.node, zmq.PUB, zmq.DEALER)
        if not self.node.can_recv:
            self.concurrency = 0
        super().__post_init__()

    async def handle_message(self, address: Any, message_type: MessageType, *message: Any) -> None:
        if message_type is not MessageType.RESPONSE:
            raise RuntimeRPCError(
                'client only receives RESPONSE messages',
                message_type=message_type,
                message_parts=message,
            )
        message_id, error, result = message
        if isinstance(error, list):
            error_message, context = error
            result = RuntimeRPCError(error_message, **context)
        try:
            self.requests.register_response(message_id, result)
        except KeyError as exc:
            raise RuntimeRPCError(
                'client received unexpected response',
                message_id=message_id,
            ) from exc

    async def issue_call(
        self,
        method: str,
        *args: Any,
        address: Optional[Any] = None,
        notification: bool = False,
        timeout: float = 5,
    ) -> Any:
        """Issue a remote procedure call and possibly wait for the result.

        Arguments:
            method: Method name.
            *args: Method arguments.
            address: A transport-dependent address.
            notification: False iff this call requires a response. Has no effect for nodes that
                cannot receive data, which can *only* send notifications.
            timeout: Maximum duration (in seconds) to wait for a response.

        Note:
            Notification calls will not raise an exception client-side if the server fails, even
            if the node supports duplex communication.

        Raises:
            asyncio.TimeoutError: The request was successfully sent, but the response never arrived
                in time.
            ValueError: If the request tracker could not generate a unique message ID.
            RuntimeRPCError: If the service returned an error.
            cbor2.CBOREncodeError: If the arguments were not serializable.
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
            message = [MessageType.NOTIFICATION.value, method, args]
            await self.node.send([await encode(message)], address=address)
        else:
            with self.requests.new_request() as (message_id, result):
                message = [MessageType.REQUEST.value, message_id, method, args]
                await self.node.send([await encode(message)], address=address)
                return await asyncio.wait_for(result, timeout)

    @functools.cached_property
    def call(self, /) -> CallFactory:
        """Syntactic sugar for issuing remote procedure calls.

        Instead of:
            await client.issue_call('add', 1, 2)

        Replace with either of:
            await client.call.add(1, 2)
            await client.call['add'](1, 2)
        """
        return CallFactory(self.issue_call)


class Handler:
    """Define a handler by subclassing :class:`Handler` and applying the :func:`route` decorator:

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
        # Need to use the class to avoid calling `getattr(...)` on this property, which can lead
        # to infinite recursion.
        funcs = inspect.getmembers(self.__class__, inspect.isfunction)
        funcs = [(attr, func) for attr, func in funcs if hasattr(func, '__rpc__')]
        return {func.__rpc__: getattr(self, attr) for attr, func in funcs}

    async def dispatch(self, method: str, *args: Any, timeout: float = 30) -> Any:
        """Dispatch a remote procedure call.

        If the method is synchronous (possibly blocking), the default executor performs the call.

        Arguments:
            method: The procedure name.
            *args: Positional arguments for the procedure.

        Returns:
            The procedure's result, which must be CBOR-serializable.

        Raises:
            RuntimeRPCError: The procedure call does not exist, timed out, or raised an exception.
        """
        func = self._method_table.get(method)
        if not func:
            raise RuntimeRPCError('no such method exists', method=method)
        try:
            if inspect.iscoroutinefunction(func):
                call = func(*args)
            else:
                call = asyncio.to_thread(func, *args)
            return await asyncio.wait_for(call, timeout)
        except asyncio.TimeoutError as exc:
            raise RuntimeRPCError('method timed out', timeout=timeout) from exc
        except Exception as exc:
            raise RuntimeRPCError('method produced an error') from exc


@dataclasses.dataclass
class Service(Endpoint):
    """Responds to RPC requests.

    Attributes:
        handler: The object whose bound methods this service will call.
        timeout: Maximum duration (in seconds) to execute methods for.
    """

    handler: Handler = dataclasses.field(default_factory=Handler)
    timeout: float = 30

    def __post_init__(self) -> None:
        _check_type(self.node, zmq.SUB, zmq.DEALER)

    async def handle_message(self, address: Any, message_type: MessageType, *message: Any) -> None:
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
        except RuntimeRPCError as exc:
            result, error = None, [str(exc), exc.context]
            await self.logger.error(
                'Service was unable to execute call',
                message_type=message_type.name,
                message_id=message_id,
                exc_info=exc,
            )
        if message_type is MessageType.REQUEST:
            payload = await encode([MessageType.RESPONSE.value, message_id, error, result])
            await self.node.send([payload], address=address)


def _render_id(identity: bytes) -> str:
    decoded = identity.decode()
    return decoded if decoded.isprintable() else identity.hex()


@dataclasses.dataclass
class Router:
    """Routes messages between :class:`Client`s and :class:`Service`s that use ZMQ sockets.

    Routers are stateless, duplex, and symmetric (*i.e.*, require the same format and exhibit the
    same behavior on both ends).

    Routers have no error handling and may silently drop messages if the destination is
    unreachable. Clients must rely on timeouts to determine when to consider a request failed.

    The payloads themselves are opaque to the router and are not deserialized.

    Attributes:
        frontend: A ``ROUTER`` socket clients connect to.
        backend: A ``ROUTER`` socket services connect to.
        route_task: The background task performing the routing. :class:`Router` implements the
            async context manager protocol, which automatically schedules and cancels this task.
    """

    frontend: SocketNode
    backend: SocketNode
    route_task: asyncio.Future[tuple[NoReturn, NoReturn]] = dataclasses.field(
        default_factory=lambda: asyncio.get_running_loop().create_future(),
        init=False,
        repr=False,
    )

    def __post_init__(self) -> None:
        _check_type(self.frontend, zmq.ROUTER)
        _check_type(self.backend, zmq.ROUTER)

    async def __aenter__(self) -> 'Router':
        await self.frontend.__aenter__()
        await self.backend.__aenter__()
        self.route_task = asyncio.gather(
            asyncio.create_task(self.route(self.frontend, self.backend), name='route-requests'),
            asyncio.create_task(self.route(self.backend, self.frontend), name='route-responses'),
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
        """Construct a :class:`Router` whose ends are bound to the provided addresses."""
        # pylint: disable=unexpected-keyword-arg; pylint does not recognize dataclass.
        frontend_options, backend_options = frontend_options or {}, backend_options or {}
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

    async def route(self, recv_socket: SocketNode, send_socket: SocketNode) -> NoReturn:
        """Route messages in one direction.

        A :class:`Router` is duplex, but the frame format and implementation for each direction
        are identical.

        Arguments:
            recv_socket: The receiving socket, which indefinitely reads five-frame messages
                consisting of the sender's ZMQ identity, the recipient's identity, and the payload,
                with empty delimeter frames sandwiched between them.
            send_socket: The sending socket, which simply transposes the sender/recipient ID frames.
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
                    await logger.warn('Loopback not allowed', sender_id=_render_id(sender_id))
                    continue
                await send_socket.send([sender_id, payload], address=recipient_id)
            except (ValueError, RuntimeRPCError) as exc:
                await logger.error('Router failed to route message', exc_info=exc)
