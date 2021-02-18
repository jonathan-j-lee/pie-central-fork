Architecture
============

Control Stack
-------------

.. tikz:: Control Stack
   :align: center
   :xscale: 90

   [font=\ttfamily, thick]

   \tikzstyle{block} = [minimum width=2.6cm, minimum height=0.7cm];

   \fill[yellow!20] (-7.55, 2.4) rectangle (4.55, 3.6);
   \node[block, fill=green!20] (student) at (3, 5) {Student};
   \node[block, fill=green!20] (shepherd) at (-6, 3) {Shepherd};
   \node[block, fill=green!20] (simulator) at (-1.5, 3) {Simulator};
   \node[block, fill=green!20] (dawn) at (3, 3) {Dawn};
   \node at (-1.5, 3.9) {Clients};

   \fill[yellow!20] (-7.55, -2.6) rectangle (4.55, 1.1);
   \node[block, fill=blue!20] (server) at (-1.5, 0.5) {server};
   \foreach \x in {-3.3,-2.7,...,0.4}
     \node[fill=cyan!20, minimum width=0.4cm, minimum height=1.2cm] at (\x, -3.75) {};
   \node[minimum width=4cm, minimum height=1.2cm, align=center] (buffers) at (-1.5, -3.75) {Device Buffers \\ (Shared Memory)};
   \node[block, fill=blue!20] (device) at (-6, -2) {device};
   \node[block, fill=blue!20] (executor) at (-1.5, -2) {executor};
   \node[block, fill=blue!20] (challenge) at (3, -2) {challenge};
   \node[align=center] at (-6.3, 0.4) {Runtime \\ Processes};

   \fill[yellow!20] (-10.05, -6.6) rectangle (-1.95, -5.4);
   \node[block, fill=red!20, minimum width=1.6cm] (vsd) at (-9, -6) {VSD 1};
   \node[block, fill=red!20, minimum width=1.6cm] (sd1) at (-6, -6) {SD 1};
   \node[block, fill=red!20, minimum width=1.6cm] (sd2) at (-3, -6) {SD $N$};
   \node at (-7.5, -6) {$\cdots$};
   \node at (-4.5, -6) {$\cdots$};
   \node[align=center] at (-0.2, -6) {(Virtual) \\ Smart Devices};

   \draw[->] (student.south) -- node[right] {Gamepad} (dawn.north);
   \draw[<->] (simulator.west) -- node[above] {TCP/UDP} (shepherd.east);
   \draw[<->] (simulator.east) -- node[above] {TCP/UDP} (dawn.west);
   \draw[<->] (server.north) -- node[fill=white] (wifi) {TCP/UDP over WiFi} (simulator.south);
   \draw[->] (wifi) -- (3, 1.75) -- (dawn);
   \draw[->] (wifi) -- (-6, 1.75) -- (shepherd);
   %\draw[<->] (server.north west) -- (shepherd.south east);
   %\draw[<->] (server.north east) -- (dawn.south west);
   \draw[<->] (server.south) -- node[midway, fill=yellow!20] (sockets) {TCP/UNIX sockets} (executor.north);
   \draw[->] (sockets) -- (-6, -0.75) -- (device.north);
   \draw[->] (sockets) -- (3, -0.75) -- (challenge.north);
   \draw[->] (-6, -5) -- (-9, -5) -- (vsd.north);
   \draw[<->] (device.south) -- node[fill=white] {USB Serial} (sd1.north);
   \draw[->] (-6, -5) -- (-3, -5) -- (sd2.north);
   \draw[<->] (device.south east) -- (buffers.north west);
   \draw[<->] (executor.south) -- (buffers.north);
   \draw[<->] (challenge.south west) -- (buffers.north east);
   \draw[<->] (server) -- (5, 0.5) -- (5, -3.75) -- (buffers);

Clients
-------

The frontend for the PiE robotics kit, students use Dawn to write code in its text editor, view console output and SD data, and control their robots during teleop.
Dawn and Runtime are the minimal components needed to control a robot.

Shepherd is the field control application, which commands each robot to start/stop, monitors each robot's health, tallies up points scored in each match, and implements game mechanics like powerup selection and the match timer.
Shepherd's frontend is a progressive web app (PWA) with pages for the scoreboard, match schedule, staff-facing match administration dashboard, and game mechanic clients for each alliance.

The Simulator is essentially a physics engine that models robots interacting with each other and the field.
It connects to Runtime to send and receive synthetic data for VSDs.
The Simulator's frontend, another PWA, allows students to view the environment and customize their virtual robot's structure.
To closely approximate competition conditions, the Simulator delegates student code execution to Runtime instead of duplicating functionality.
Runtime's student API is agnostic to the underlying hardware, whether physical or virtual.

Process Model
-------------

Runtime is structured as a distributed multiprocess application.
The processes communicate with each other either over shared memory buffers or over TCP/UDP/UNIX sockets.
Some sockets use ZeroMQ (ZMQ), a messaging library that extends plain BSD sockets.
Each process is a microservice that responds to RPC requests.

``server``
  * Routes remote procedure calls (RPC).
  * Publishes aggregated log data collected from each process.
  * Manages Runtime's resources, such as other processes.
  * Publishes Smart Device data.
  * Receives gamepad inputs.

  ``server`` essentially acts as a broker between other Runtime processes and Runtime's clients.
  This process is the "fixed" component of the architecture by binding to well-known addresses that all other processes/clients connect to.

``device``
  * Detects hotplugged devices in a helper thread.
  * Opens serial connections to each device.
  * Decode inbound Smart Device packets and writes updates into buffers.
  * Read buffers and encode outbound packets.

``executor``, ``challenge``
  * Executes synchronous student code in the main thread, using alarms to time out execution.
  * Executes asynchronous student code in a helper thread.

  ``executor`` runs autonomous and teleop code and ``challenge`` runs coding challenges, but are otherwise identical.

Network Topology
----------------

.. Note::
  This guide will only detail IPC at the transport layer.
  For information on IPC formats and semantics, see `IPC at the application layer <ipc.html>`_.

All bound sockets are shown in the following table:

.. table:: Runtime Sockets
  :class: compact-table
  :widths: 1 1 1 1 5

  +-----------+----------------------+-----------------+------------+-----------------------------+
  | Transport | Port/Path            | Binding Process | ZMQ Type   | Description                 |
  +===========+======================+=================+============+=============================+
  | TCP       | 6000                 | ``server``      | ``ROUTER`` | Clients issue synchronous   |
  |           +----------------------+                 |            | RPC requests to the TCP     |
  |           | ``/tmp/rt-rpc.sock`` |                 |            | frontend, which the backend |
  +-----------+----------------------+-----------------+------------+ routes. Sockets connecting  |
  | UNIX      | ``/tmp/rt-srv.sock`` | ``server``      | ``ROUTER`` | to either end should have   |
  |           |                      |                 |            | the ``REQ`` type.           |
  +-----------+----------------------+-----------------+------------+-----------------------------+
  | TCP       | 6001                 | ``server``      | ``PUB``    | The ``PUB`` frontend        |
  +-----------+----------------------+-----------------+------------+ publishes log records       |
  | UNIX      | ``/tmp/rt-log.sock`` | ``server``      | ``SUB``    | collected on the ``SUB``    |
  |           |                      |                 |            | backend.                    |
  +-----------+----------------------+-----------------+------------+-----------------------------+
  | UDP       | 6002                 | ``server``      | None       | Clients send gamepad        |
  |           |                      |                 |            | inputs.                     |
  +-----------+----------------------+-----------------+------------+-----------------------------+
  | UDP       | 6003                 | Client          | None       | ``server`` publishes Smart  |
  |           |                      |                 |            | Device data over IP         |
  |           |                      |                 |            | multicast.                  |
  +-----------+----------------------+-----------------+------------+-----------------------------+
  | TCP       | 6005                 | ``device``      | None       | A plain TCP connection for  |
  |           |                      |                 |            | virtual Smart Devices.      |
  |           |                      |                 |            | Drop-in replacement for     |
  |           |                      |                 |            | serial.                     |
  +-----------+----------------------+-----------------+------------+-----------------------------+

The connections opened by each process are shown in the following diagram for one client:

.. tikz:: Socket Diagram
  :align: center

  [font=\ttfamily, thick]

  \tikzstyle{block} = [minimum width=1.6cm, minimum height=0.7cm];

  \fill[cyan!20] (-2.2, -2.3) rectangle (2.2, 0.6);

  \node[block, fill=blue!20] (rpc-frontend) at (-0.8, 0) {ROUTER};
  \node[block, fill=blue!20] (rpc-backend) at (-0.8, -1.7) {ROUTER};
  \node[block, fill=green!20] (log-frontend) at (0.8, 0) {PUB};
  \node[block, fill=green!20] (log-backend) at (0.8, -1.7) {SUB};

  \node[block, fill=red!20] (vsd-client) at (-2.4, 3.5) {TCP};
  \node[block, fill=blue!20] (client-req) at (-0.8, 3.5) {REQ};
  \node[block, fill=green!20] (client-sub) at (0.8, 3.5) {SUB};
  \node[block, fill=yellow!20] (client-udp) at (2.4, 3.5) {UDP};

  \node[block, fill=red!20] (vsd-server) at (-7.6, -5.7) {TCP};
  \node[block, fill=blue!20] (dev-server) at (-6, -5.7) {REQ};
  \node[block, fill=green!20] (dev-log) at (-4.4, -5.7) {PUB};
  \node[block, fill=blue!20] (dev-client) at (-2.8, -5.7) {REQ};
  \node[block, fill=blue!20] (exec-server) at (-0.8, -5.7) {REQ};
  \node[block, fill=green!20] (exec-log) at (0.8, -5.7) {PUB};
  \node[block, fill=blue!20] (exec-client) at (2.4, -5.7) {REQ};
  \node[block, fill=blue!20] (control-server) at (4.4, -5.7) {REQ};
  \node[block, fill=green!20] (control-log) at (6, -5.7) {PUB};
  \node[block, fill=blue!20] (control-client) at (7.6, -5.7) {REQ};
  \node[block, fill=yellow!20] (control-udp) at (9.2, -5.7) {UDP};

  \draw[<->] (rpc-frontend) -- node[left] {Queue} (rpc-backend);
  \draw[<->] (log-frontend) -- node[right] {Queue} (log-backend);
  \draw[->] (rpc-backend.south) -- (-0.8, -3.7) -- (-6, -3.7) -- (dev-server);
  \draw[->] (-0.8, -3.7) -- (exec-server);
  \draw[->] (-0.8, -3.7) -- (4.4, -3.7) -- (control-server);
  \fill[white] (-0.9, -4.8) rectangle (-0.7, -4.6);
  \fill[white] (4.3, -4.8) rectangle (4.5, -4.6);
  \draw[->] (dev-log) -- (-4.4, -4.7) -- (0.8, -4.7) -- (log-backend);
  \draw (exec-log) -- (0.8, -4.7);
  \draw (control-log) -- (6, -4.7) -- (0.8, -4.7);
  \fill[white] (-2.9, -4.8) rectangle (-2.7, -4.6);
  \fill[white] (2.3, -4.8) rectangle (2.5, -4.6);
  \fill[white] (-2.9, -3.8) rectangle (-2.7, -3.6);
  \fill[white] (2.3, -3.8) rectangle (2.5, -3.6);
  \draw[->] (dev-client) -- (-2.8, 2) -- (-0.8, 2) -- (rpc-frontend);
  \draw (exec-client) -- (2.4, 2) -- (-0.8, 2);
  \draw (control-client) -- (7.6, 2) -- (2.4, 2);
  \fill[white] (0.7, 1.9) rectangle (0.9, 2.1);
  \draw (client-req) -- (-0.8, 2);
  \draw[->] (log-frontend) -- (client-sub);
  \draw[<->] (vsd-client) -- (-7.6, 3.5) -- (vsd-server);
  \draw[<->] (control-udp) -- (9.2, 3.5) -- (client-udp);

  \node at (-5.2, -6.4) {device};
  \node at (0.8, -6.4) {executor/challenge};
  \node at (6.8, -6.4) {server};
  \node at (0, 4.2) {Client};
  \node[fill=white] at (-7.6, -4.7) {bind};
  \node[fill=white] at (-0.8, -2.7) {bind};
  \node[fill=white] at (0.8, -2.7) {bind};
  \node[fill=white] at (-0.8, 1) {bind};
  \node[fill=white] at (0.8, 1) {bind};
  \node[fill=white] at (4.3, 3.5) {bind};
  \node[fill=white] at (9.2, -4.7) {bind};

* The two pairs of sockets in the center are `ZMQ devices <https://pyzmq.readthedocs.io/en/latest/devices.html>`_ that have a frontend that clients connect to and a backend that services connect to.
  These devices may run in helper threads in the ``server`` process, meaning the ``server`` process may communicate with itself.
* The ``ROUTER``-``ROUTER`` device routes an incoming RPC request to the appropriate service and returns the response to the client.
  For ZMQ to route a message, the sender prefixes the message with the destination socket's identity, a globally unique binary string.
  For that reason, the RPC request and response must include the client's identity.
* Surprisingly, each socket connected to the backend has the ``REQ``, not ``REP`` type, and the backend socket is not a ``DEALER``.
  Each service must send the first message to the backend to inform the device of its ZMQ identity, which is the process name.
  This design is based on a `load-balancing pattern <https://zguide.zeromq.org/docs/chapter3/#A-Load-Balancing-Message-Broker>`_ from the ZMQ guide.
* Each process also has a second ``REQ`` socket connected to the frontend, allowing every service to call every other service without requiring point-to-point connections.
  The routing device should prevent requests from cycling indefinitely.
* Following a fan-in, fan-out pattern, the ``PUB``-``SUB`` device simply forwards log records collected on the backend to any number of clients subscribed to the frontend.
* Unlike most connections, clients connect directly to the ``device`` service to simulate a VSD.
  (The sockets are shown in red.)
* To subscribe to Smart Device updates, the client binds to multicast group ``224.1.1.1``, which Runtime connects to.

.. Warning::
  * ``REQ`` and ``REP`` sockets are stateful and will raise an exception if they do not strictly follow an alternating send/receive I/O pattern.
    ``REQ`` must start with send, ``REP`` must start with receive.
    If a service fails while processing a request and restarts, the client will wait for a response that will never arrive and lock itself in the mute state.
    The solution is to timeout the client's receive operation.
  * When the transport allows it (*i.e.*, is duplex), a ZMQ subscriber will notify `its publishers <https://github.com/zeromq/libzmq/issues/3611>`_ which topics the publishers should filter preemptively to cut down on network traffic.
  * A publisher overwhelming a slow subscriber will back up the publisher's send queue.

FAQ
---

Why use multiple processes instead of multiple threads?
  * Some Python implementations, including CPython, use a global interpreter lock (GIL), which prevents multiple OS threads from running in parallel even when multiple physical cores are available.
    This behavior is essentially time-multiplexing.

    Although multiprocessing complicates data sharing and incurs a heavier context switching performance penalty, each process has its own interpreter and avoids GIL contention.
    Extension modules that do not access Python objects may also release the GIL.
    With shared memory, the IPC latency for Smart Device data is essentially nonexistent.
  * A microservice architecture provides increased resilience, scalability, and modularity.
    Processes can be tested and restarted in isolation.
  * Messaging over sockets instead of an in-memory data structure shared among threads (like a queue) allows other tools to intergrate with Runtime.

Why is true parallelism necessary at all? Runtime is heavily I/O-bound anyway.
  This is true, but having all of Runtime's functionality sharing the CPU time of a single core is still undesirable.
  First, a slow operation like reading a large packet can block the event loop slightly, increasing the latency of all other tasks.
  Obviously, compute-bound tasks should be delegated to a thread pool, but a delayed event loop is still a possible single point of failure.
  Second, Runtime should treat student code as possibly very inefficient in the worst case, and therefore, compute-bound.

Why not delegate blocking tasks to a process pool?
  Process pools are best suited for compute-heavy jobs where fine-grained control over workers is not needed.
  This precludes student code execution, since jobs cannot be canceled by the parent process or interrupted by an alarm in a worker process's main thread.

Why prefer ZMQ over plain sockets?
  * ZMQ exposes an interface based on multipart messages instead of TCP's bytestreams, which frees us from dealing with low-level framing.
  * High-level messaging patterns, like publish-subscribe, and identity-based routing make it easy to build scalable network topologies that are agnostic to the underlying transports.
  * Limited persistence and asynchronous delivery guarantee requests go through even if a peer is temporarily disconnected.
    For example, if a peer is temporarily down, ZMQ can retry a connection attempt instead of reporting "connection refused" as TCP does.
    As its name implies, ZMQ provides the benefits of a message queue without a broker, a possible central point of failure.

Why use so many separate TCP connections?
  TCP is ubiquitous and works well with ZMQ.
  Because each connection is long-lived, TCP handshakes rarely occur and the only long-term overhead is keep-alive packet traffic.
  Rejected alternatives:

    * Multiplexed TCP: Not supported by ZMQ, and suffers from head-of-line blocking.
      One blocked channel with dropped or out-of-order packets will unnecessarily block all other channels.
    * SCTP: Supports multiple streams and is message-based.
      However, some OSs lack native implementations and poorly built network middleware may block SCTP traffic.
    * QUIC: QUIC supports multiple streams using UDP but, like SCTP, is not yet a mature, stable protocol.
    * UDP-only: Reliable transmission is required for some functionality.
      For example, student-logged messages must appear in Dawn's console.
    * Consolidate the log socket pair with the RPC pair: Runtime would need to explicitly publish logs to all of its peers, which is an antipattern.
      The correct model for unidirectional asynchronous data flow is publish-subscribe.
