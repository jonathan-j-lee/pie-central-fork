"""
Runtime Remote Procedure Calls (RPC).

In this object-oriented context, RPC is synonymous with remote method invocation (RMI).
"""

import abc
import asyncio
import contextlib
import dataclasses
import enum
import functools
import inspect
import random
from numbers import Real
from typing import Any, Callable, Optional, Union

import msgpack
import structlog
import zmq
import zmq.asyncio

from .exception import RuntimeBaseException

__all__ = ['RuntimeRPCError', 'Client', 'Service', 'Router', 'ServiceProtocol']


class RuntimeRPCError(RuntimeBaseException):
    """Errors during a RPC."""


class MessageType(enum.IntEnum):
    """
    The type of MessagePack-RPC message. See the `MessagePack-RPC Specification`_.

    .. _MessagePack-RPC Specification:
        https://github.com/msgpack-rpc/msgpack-rpc/blob/master/spec.md
    """

    REQUEST = 0
    RESPONSE = 1
    NOTIFICATION = 2


@dataclasses.dataclass
class BaseSocket:
    """
    A wrapper around :class:`zmq.asyncio.Socket` for handling timeouts.

    When the underlying socket of a :class:`BaseSocket` times out, the socket is closed and rebuilt
    to reset socket's internal state. For example, a ``REQ`` socket may become stuck in the
    "listening" state indefinitely if the message it sent gets lost.

    A :class:`BaseSocket` supports the async context manager protocol (reentrant), which will
    automatically create and close the internal socket.

    .. _ZMQ Socket Options:
        http://api.zeromq.org/4-1:zmq-setsockopt
    """

    socket_type: int
    ctx: zmq.asyncio.Context = dataclasses.field(default_factory=zmq.asyncio.Context.instance)
    options: dict[int, Union[int, bytes]] = dataclasses.field(default_factory=dict)
    bindings: frozenset[str] = dataclasses.field(default_factory=frozenset)
    connections: frozenset[str] = dataclasses.field(default_factory=frozenset)
    subscriptions: set[str] = dataclasses.field(default_factory=set)
    socket: zmq.asyncio.Socket = dataclasses.field(init=False, repr=False)
    logger: structlog.BoundLogger = dataclasses.field(default_factory=structlog.get_logger)

    def __post_init__(self):
        for attr in ('bindings', 'connections', 'subscriptions'):
            value = getattr(self, attr)
            if isinstance(value, str):
                setattr(self, attr, {value})
        self.bindings, self.connections = frozenset(self.bindings), frozenset(self.connections)
        if self.socket_type == zmq.SUB and not self.subscriptions:
            self.subscriptions.add('')
        self.reset()

    async def __aenter__(self):
        if self.closed:
            self.reset()
        return self

    async def __aexit__(self, _exc_type, _exc, _traceback):
        self.close()

    def _check_type(self, *allowed_types: int):
        """Raise a :class:`RuntimeRPCError` if this socket type is not allowed."""
        if self.socket_type not in allowed_types:
            raise RuntimeRPCError(
                'socket type not allowed',
                socket_type=self.socket_type,
                allowed_types=allowed_types,
            )

    def reset(self):
        """Reset the internal socket."""
        self.socket = self.ctx.socket(self.socket_type)
        for name, value in self.options.items():
            self.socket.set(name, value)
        for address in self.bindings:
            self.socket.bind(address)
        for address in self.connections:
            self.socket.connect(address)
        if self.socket_type == zmq.SUB:
            for topic in self.subscriptions:
                self.socket.subscribe(topic)

    @property
    def closed(self) -> bool:
        """Whether this socket is closed (unusable)."""
        return self.socket.closed

    def close(self):
        """Close the internal socket."""
        self.socket.close(linger=0)

    def subscribe(self, topic: str = ''):
        """Subscribe to a topic (for ``SUB`` sockets only)."""
        if self.socket_type == zmq.SUB:
            self.socket.subscribe(topic)
            self.subscriptions.add(topic)

    def unsubscribe(self, topic: str = ''):
        """Unsubscribe from a topic (for ``SUB`` sockets only)."""
        if self.socket_type == zmq.SUB:
            self.socket.unsubscribe(topic)
            self.subscriptions.discard(topic)

    def set_option(self, option: int, value: Union[int, bytes]):
        """Set a socket option."""
        self.socket.set(option, value)
        self.options[option] = value

    @contextlib.asynccontextmanager
    async def _using_socket(self):
        """An async context manager for reconstructing the socket on timeout."""
        if self.closed:
            raise RuntimeRPCError('socket is closed')
        try:
            yield
        except zmq.error.Again as exc:
            self.close()
            self.reset()
            raise asyncio.TimeoutError('socket operation timed out') from exc

    async def send(self, *parts: bytes):
        """
        Send a multipart message.

        Arguments:
            *parts: Frames of a multipart message.

        Raises:
            RuntimeRPCError: If the socket is closed.
            asyncio.TimeoutError: If the operation times out.
        """
        async with self._using_socket():
            await self.socket.send_multipart(parts)

    async def recv(self) -> list[bytes]:
        """
        Receive a multipart message.

        Raises:
            RuntimeRPCError: If the socket is closed.
            asyncio.TimeoutError: If the operation times out.
        """
        async with self._using_socket():
            return await self.socket.recv_multipart()


@dataclasses.dataclass
class Endpoint(BaseSocket, abc.ABC):
    """
    A source or destination of messages.

    An :class:`Endpoint` has a number of workers (instances of :class:`asyncio.Task`) that listen
    for and process incoming messages. This allows for request pipelining. Once all workers are
    busy processing messages, the underlying ZMQ socket buffers any additional messages.

    Endpoints also implement serialization, since they interface with the application layer.

    Attributes:
        concurrency: The number of workers.
        workers: The set of workers, which the context manager automatically creates and destroys.
    """

    concurrency: int = 1
    workers: set[asyncio.Task] = dataclasses.field(default_factory=set, init=False, repr=False)

    def __post_init__(self):
        if self.socket_type == zmq.PUB:  # PUB sockets cannot receive messages.
            self.concurrency = 0
        if self.concurrency < 0:
            raise ValueError('concurrency must be a positive integer')
        super().__post_init__()

    def reset(self):
        super().reset()
        for _ in range(self.concurrency):
            self.workers.add(asyncio.create_task(self.recv_forever(), name='recv'))

    def close(self):
        while self.workers:
            self.workers.pop().cancel()
        super().close()

    async def recv_forever(self):
        """Receive messages indefinitely and process them."""
        while True:
            try:
                sender_or_topic, payload = await self.recv()
                message_type, *message = await self.deserialize(payload)
                message_type = MessageType(message_type)
            except (ValueError, asyncio.TimeoutError, RuntimeRPCError) as exc:
                await self.logger.error('Endpoint failed to receive message', exc_info=exc)
                continue
            await self.logger.debug(
                'Endpoint received message',
                message_type=message_type.name,
                sender_or_topic=sender_or_topic.hex(),
            )
            sender_id = sender_or_topic if self.socket_type != zmq.SUB else b''
            try:
                await self.handle_message(sender_id, message_type, *message)
            except RuntimeRPCError as exc:
                await self.logger.error('Endpoint failed to process message', exc_info=exc)

    @abc.abstractmethod
    async def handle_message(self, sender_id: bytes, message_type: MessageType, *message: Any):
        """
        Process a message.

        Arguments:
            sender_id: The ZMQ identity of the message's sender. Useful for sending a response.
                For ``SUB`` sockets where the sender is unknown, this argument is empty.
            message_type: The message type.
            *message: Other message parts. The message type determines the parts' format.

        Raises:
            RuntimeRPCError: If the message was unable to be processed.
        """

    async def serialize(self, obj: Any) -> bytes:
        """
        Serialize an object as a MessagePack-encoded buffer in the default executor.

        Raises:
            RuntimeRPCError: If the serialization fails.
        """
        try:
            return await asyncio.to_thread(msgpack.packb, obj)
        except Exception as exc:
            raise RuntimeRPCError('unable to serialize object') from exc

    async def deserialize(self, buf: bytes) -> Any:
        """
        Deserialize a MessagePack-encoded buffer in the default executor.

        Raises:
            RuntimeRPCError: If the deserialization fails.
        """
        try:
            return await asyncio.to_thread(msgpack.unpackb, buf)
        except Exception as exc:
            raise RuntimeRPCError('unable to deserialize object') from exc


@dataclasses.dataclass
class Client(Endpoint):
    """
    Issue RPC requests.

    A request is matched to its response with a message ID, a 32-bit integer unique among in-flight
    requests at any given time.

    Attributes:
        requests: A mapping of in-flight message IDs to futures. Each future represents the outcome
            of a call.
    """

    requests: dict[int, asyncio.Future] = dataclasses.field(default_factory=dict)

    def __post_init__(self, *args, **kwargs):
        self._check_type(zmq.PUB, zmq.DEALER)
        super().__post_init__(*args, **kwargs)

    def generate_message_id(self, attempts: int = 10) -> int:
        """
        Generate a unique message ID.

        Arguments:
            attempts: The maximum number of times to try to generate an ID.

        Raises:
            RuntimeRPCError: If the attempts were exhausted. Because the ID space is sufficiently
                large, this error is exceedingly rare. Increasing the number of attempts or
                decreasing the number of in-flight requests should increase the probability of a
                unique ID.
        """
        for _ in range(attempts):
            message_id = random.randrange(1 << 32)
            if message_id not in self.requests:
                return message_id
        raise RuntimeRPCError('unable to generate a message ID', attempts=attempts)

    async def handle_message(self, sender_id: bytes, message_type: MessageType, *message: Any):
        if message_type is not MessageType.RESPONSE:
            raise RuntimeRPCError(
                'client only receives RESPONSE messages',
                message_type=message_type,
                message_parts=message,
            )
        message_id, error, result = message
        future = self.requests.get(message_id)
        if not future:
            raise RuntimeRPCError('client received unexpected response', message_id=message_id)
        if isinstance(error, dict):
            error_message = error.get('message', 'service returned an error')
            context = error.get('context') or {}
            future.set_exception(RuntimeRPCError(error_message, **context))
        else:
            future.set_result(result)

    async def issue_call(
        self,
        method: str,
        *args: Any,
        service_or_topic: bytes = b'',
        notification: bool = False,
        timeout: Real = 5,
    ):
        """
        Issue a remote procedure call and possibly wait for the result.

        Arguments:
            method: Method name.
            *args: Method arguments.
            service_or_topic: The first frame, which is either the ZMQ identity of the destination
                service (for ``DEALER`` sockets) or a ZMQ topic (for ``PUB`` sockets). If the topic
                is not provided, it defaults to the method name. The service identity is required.
            notification: False iff this call requires a response. Has no effect for ``PUB``
                sockets, which can *only* send notifications.
            timeout: Maximum duration (in seconds) to wait for a response.

        Note:
            Notification calls will not raise an exception client-side if the server fails.

        Raises:
            ValueError: If the socket ID was not provided.
            asyncio.TimeoutError: Either the socket send operation timed out or the request was
                successfully sent, but the response never arrived in time.
            RuntimeRPCError: If the service returned an error.
        """
        if self.socket_type == zmq.PUB:
            notification = True
            service_or_topic = service_or_topic or method.encode()
        elif not service_or_topic:
            raise ValueError('call requires service ID')
        await self.logger.debug(
            'Issuing remote procedure call',
            method=method,
            service_or_topic=service_or_topic.hex(),
            notification=notification,
        )
        if notification:
            message = [MessageType.NOTIFICATION.value, method, args]
            await self.send(service_or_topic, await self.serialize(message))
        else:
            message_id = self.generate_message_id()
            message = [MessageType.REQUEST.value, message_id, method, args]
            future = self.requests[message_id] = asyncio.Future()
            try:
                await self.send(service_or_topic, await self.serialize(message))
                await asyncio.wait_for(future, timeout)
                return future.result()
            finally:
                self.requests.pop(message_id)

    @functools.cached_property
    def call(self):
        """
        Syntactic sugar for issuing remote procedure calls.

        Instead of:
            await client.issue_call('add', 1, 2)

        Replace with either of:
            await client.call.add(1, 2)
            await client.call['add'](1, 2)
        """
        # pylint: disable=no-self-use
        @functools.lru_cache(maxsize=64)
        def call_factory(method: str):
            return functools.partial(self.issue_call, method)

        class CallFactoryWrapper:
            """
            A wrapper class around the call factory.

            This wrapper uses currying to partially complete the argument list to
            :meth:`Client.issue_call`.
            """

            def __getitem__(self, method: str):
                return call_factory(method)

            def __getattr__(self, method: str):
                return call_factory(method)

        return CallFactoryWrapper()


@dataclasses.dataclass
class Service(Endpoint):
    """
    Responds to RPC requests.

    Define a service by subclassing :class:`Service` and applying the :meth:`Service.route`
    decorator:

        >>> class CustomService(Service):
        ...     @Service.route('alt-name')
        ...     def method(self, arg1: int, arg2: str) -> int:
        ...         ...

    Attributes:
        timeout: Maximum duration (in seconds) to execute methods for.
    """

    timeout: Real = 30
    client: Optional[Client] = None

    def __post_init__(self, *args, **kwargs):
        self._check_type(zmq.SUB, zmq.DEALER)
        super().__post_init__(*args, **kwargs)
        if self.socket_type == zmq.DEALER:
            self.set_option(zmq.PROBE_ROUTER, 1)

    async def __aenter__(self):
        if self.client:
            client = await self.client.__aenter__()
        return await super().__aenter__()

    async def __aexit__(self, exc_type, exc, traceback):
        if self.client:
            await self.client.__aexit__(exc_type, exc, traceback)
        return await super().__aexit__(exc_type, exc, traceback)

    @classmethod
    def route(cls, name: str = ''):
        """
        Decorator for marking a bound method as an RPC target.

        Arguments:
            name: The name exposed to the RPC dispatcher. Useful for names that are not valid
                Python identifiers. Defaults to the method name.
        """

        def decorator(method: Callable) -> Callable:
            method.__rpc__ = name or method.__name__
            return method

        return decorator

    @functools.cached_property
    def method_table(self) -> dict[str, Callable]:
        """A mapping of method names to (possibly coroutine) bound methods."""
        # Need to use the class to avoid calling `getattr(...)` on this property, which can lead
        # to infinite recursion.
        funcs = inspect.getmembers(self.__class__, inspect.isfunction)
        funcs = [(attr, func) for attr, func in funcs if hasattr(func, '__rpc__')]
        return {func.__rpc__: getattr(self, attr) for attr, func in funcs}

    async def dispatch(self, method: str, *args: Any) -> Any:
        """
        Dispatch a remote procedure call.

        If the method is synchronous (possibly blocking), the default executor performs the call.

        Arguments:
            method: The procedure name.
            *args: Positional arguments for the procedure.

        Returns:
            The procedure's result, which must be MessagePack-serializable.

        Raises:
            RuntimeRPCError: The procedure call does not exist, timed out, or raised an exception.
        """
        func = self.method_table.get(method)
        if not func:
            raise RuntimeRPCError('no such method exists', method=method)
        if inspect.iscoroutinefunction(func):
            call = func(*args)
        else:
            call = asyncio.to_thread(func, *args)
        try:
            return await asyncio.wait_for(call, self.timeout)
        except asyncio.TimeoutError as exc:
            raise RuntimeRPCError('method timed out', timeout=self.timeout) from exc
        except Exception as exc:
            raise RuntimeRPCError('method produced an error') from exc

    async def handle_message(self, sender_id: bytes, message_type: MessageType, *message: Any):
        if message_type is MessageType.REQUEST:
            message_id, method, args = message
            result = error = None
            try:
                result = await self.dispatch(method, *args)
            except RuntimeRPCError as exc:
                error = {'message': str(exc), **exc.context}
                await self.logger.error('Service was unable to execute call', exc_info=exc)
            payload = await self.serialize([MessageType.RESPONSE.value, message_id, error, result])
            await self.send(sender_id, payload)
        elif message_type is MessageType.NOTIFICATION:
            method, args = message
            await self.dispatch(method, *args)
        else:
            await self.logger.warn(
                'Service does not support message',
                message_type=message_type.name,
            )


@dataclasses.dataclass
class Router:
    """
    Routes messages between :class:`Client`s and :class:`Service`s.

    Routers are stateless, duplex, and symmetric (*i.e.*, require the same format and exhibit the
    same behavior on both ends).

    Routers have no error handling and may silently drop messages if the destination is
    unreachable. Clients must rely on timeouts to determine when to consider a request as failed.

    The payloads themselves are opaque to the router and are not deserialized.

    Attributes:
        frontend: A ``ROUTER`` socket clients connect to.
        backend: A ``ROUTER`` socket services connect to.
        route_task: The background task performing the routing. :class:`Router` implements the
            async context manager protocol, which automatically schedules and cancels this task.
    """

    frontend: BaseSocket
    backend: BaseSocket
    route_task: Optional[asyncio.Task] = dataclasses.field(init=False, repr=False)

    def __post_init__(self):
        # pylint: disable=protected-access
        self.frontend._check_type(zmq.ROUTER)
        self.backend._check_type(zmq.ROUTER)

    async def __aenter__(self):
        self.route_task = asyncio.gather(
            self.route(self.frontend, self.backend),
            self.route(self.backend, self.frontend),
        )
        await self.frontend.__aenter__()
        await self.backend.__aenter__()
        return self

    async def __aexit__(self, exc_type, exc, traceback):
        self.route_task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await self.route_task
        await self.frontend.__aexit__(exc_type, exc, traceback)
        await self.backend.__aexit__(exc_type, exc, traceback)

    @classmethod
    def bind(
        cls,
        frontend: Union[str, set[str]],
        backend: Union[str, set[str]],
        frontend_options: Optional[dict] = None,
        backend_options: Optional[dict] = None,
    ) -> 'Router':
        """Construct a :class:`Router` whose ends are bound to the provided addresses."""
        default = {'options': {zmq.ROUTER_HANDOVER: 1}}
        frontend_options = default | (frontend_options or {})
        backend_options = default | (backend_options or {})
        return Router(
            BaseSocket(zmq.ROUTER, bindings=frontend, **frontend_options),
            BaseSocket(zmq.ROUTER, bindings=backend, **backend_options),
        )

    @staticmethod
    async def route(recv_socket: BaseSocket, send_socket: BaseSocket):
        """
        Route messages in one direction.

        A :class:`Router` is duplex, but the frame format and implementation for each direction
        are identical.

        Arguments:
            recv_socket: The receiving socket, which indefinitely reads five-frame messages
                consisting of the sender's ZMQ identity, the recipient's identity, and the payload,
                with empty delimeter frames sandwiched between them.
            send_socket: The sending socket, which simply transposes the sender/recipient ID frames.
        """
        while True:
            try:
                sender_id, *frames = await recv_socket.recv()
                if frames == (b'',):
                    await recv_socket.logger.debug(
                        'Router connected to service',
                        sender_id=sender_id.hex(),
                    )
                    continue
                recipient_id, payload = frames
                await recv_socket.logger.debug(
                    'Router received message',
                    sender_id=sender_id.hex(),
                    recipient_id=recipient_id.hex(),
                )
                if sender_id == recipient_id:
                    await send_socket.logger.warn('Loopback not allowed', sender_id=sender_id.hex())
                    continue
                await send_socket.send(recipient_id, sender_id, payload)
            except (ValueError, RuntimeRPCError) as exc:
                await send_socket.logger.error('Router failed to route message', exc_info=exc)


class ServiceProtocol(asyncio.DatagramProtocol):
    """
    A bridge between asyncio's UDP support and Runtime's ZMQ-based RPC framework.
    """

    def __init__(self, service: Service):
        self.service, self.transport = service, None

    def connection_made(self, transport: asyncio.DatagramTransport):
        self.transport = transport

    def datagram_received(self, data: bytes, addr):
        pass

    def error_received(self, exc: Optional[Exception]):
        pass
