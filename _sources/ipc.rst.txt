IPC
===

Socket Messages
---------------

Sockets are used for event-driven communication.

Formats
^^^^^^^

Except for the VSD socket, all sockets send messages that are `MessagePack <https://msgpack.org/>`_-encoded objects.
MessagePack is easy to use, flexible like JSON, pretty fast, and doesn't take up that much space on the wire.
Most Runtime messages are small and simple, so a serialization framework like `Protobuf <https://developers.google.com/protocol-buffers>`_ requiring a strongly-typed schema would be overkill.

RPC
  Follows the `MessagePack-RPC specification <https://github.com/msgpack-rpc/msgpack-rpc/blob/master/spec.md>`_.

  Request object:

  .. code-block:: js

    [0, <request id: int>, <procedure: String>, [<arg1>, <arg2>, ...]]

  Response object:

  .. code-block:: js

    [1, <request id: int>, <error: null or Object>, <result>]

  See the service documentation for the full list of procedures.

Log Message
  .. code-block:: js

    {
      "event": <message: String>,         /* The message that was logged */
      "logger": <module: String>,         /* For example: runtime.<submod1>.<submod2> */
      "level": <level: String>,           /* One of: debug, info, warning, error, critical */
      "timestamp": <timestamp: String>,   /* ISO format */
      "extra": {                          /* More contextual data. */
        ...
      }
    }

Gamepad Input
  .. code-block:: js

    {
      "gamepads": {
        <gamepad index: String>: {
          "lx": <float>,
          "ly": <float>,
          "rx": <float>,
          "ry": <float>,
          "btn": <int>
        },
        ...
      }
    }

  The ``[lr][xy]`` parameters denote joystick positions, where ``l`` and ``r`` stand for the left and right joysticks, respectively, and ``x`` and ``y`` are Cartesian coordinates.
  The origin (0, 0) corresponds to the joystick in the resting position.
  Each joystick's positon is constrained within the unit circle.

  ``btn`` is a bitmask where a 1 bit indicates the corresponding button is pressed.
  See the `DOM Gamepad specification <https://w3c.github.io/gamepad/#dom-gamepad>`_ for the list of buttons.
  The first button in the ``Gamepad.buttons`` attribute corresponds to the least-significant bit of the bitmask.

Smart Device Update
  .. code-block:: js

    {
      "sd": {
        <uid: String>: {
          <param name: String>: <param value>,
          ...
        },
        ...
      },
      "aliases": {
        <uid: String>: <alias: String>,
        ...
      }
    }

  Each Smart Device UID is formatted as an integer.
  To reduce the message's size, parameters that have not changed since the last update may not be sent.
  All device UIDs will always be sent.

  Each device UID may have an alias, an alternative human-readable name.

Buffers
-------

Buffers backed by shared memory store and communicate peripheral data between processes.
In this context, peripherals include not only `Smart Devices <smart-devices.html>`_ (SDs), but also gamepads, commodity sensors like cameras, and even queues of messages sent by other robots.
Each peripheral is allocated a buffer, a shared memory object under ``/dev/shm`` on Linux, formatted as a `C-style structure <https://docs.python.org/3/library/ctypes.html>`_.

Every peripheral has an owner: the process responsible for communicating with the peripheral.
For example, the ``device`` is the owner of SDs and ``server`` is the owner of gamepads.
Consumers are processes that open views of the buffer.

Buffers do not explicitly notify consumers when an update occurs, as a condition variable can do.
Instead, consumers should either access the buffer on-demand (as student code does) or poll the buffer at a fixed interval.
Batching updates in this way is less noisy.

Catalog
^^^^^^^

The peripheral catalog is a YAML config file detailing all available peripherals and their parameters.
Some peripherals are Smart Devices with special catalog fields.

.. code-block:: yaml

  "<peripheral-name>":
    # Provided if this peripheral is a Smart Device.
    device_id: <int>
    # The delay (in ms) between subscription updates. Omit for no subscription.
    # Ignored for non-Smart Device peripherals.
    delay: <float>
    params:
      - # Required (any legal Python identifier)
        name: "<name>"
        # Type name (legal types are suffixes to ``ctypes.c_*``). You may
        # specify a length-n array by adding "[n]" as a suffix.
        type: "<type>"
        # Minimum and maximum limits used for validation. Defaults to -inf to
        # inf. If the validation check fails, the value is clamped within the
        # range and a warning is emitted. Ignored for non-numeric parameters.
        lower: <real>
        upper: <real>
        # Whether the parameter is readable or writeable by student code, which
        # emits a warning if the access constraint is violated.
        readable: <bool>
        writeable: <bool>
        # Whether this parameter should be subscribed to. Ignored for non-Smart
        # Device peripherals.
        subscribed: <bool>
      ...
  ...

SDs may have up to 16 parameters, per the specification.
Non-SD peripherals have no such restriction.

Format
^^^^^^

.. tikz:: Buffer Format
  :align: center

  [font=\ttfamily, thick, align=center, scale=0.5, every node/.style={scale=0.5}]

  \node at (0, 3) {Timestamp \\ (64 bits)};
  \node at (3, 3) {Param. 1 \\ (var.)};
  \node at (8, 3) {Param. N \\ (var.)};
  \node at (0, 0) {UID \\ (88 bits)};
  \node at (3, 0) {Subscription \\ (16 bits)};
  \node at (6, 0) {Delay \\ (16 bits)};
  \node at (9, 0) {Read \\ (16 bits)};
  \node at (12, 0) {Write \\ (16 bits)};
  \node at (15, 0) {Update \\ (16 bits)};
  \node at (0, -3) {Mutex \\ (var.)};
  \node at (3, -3) {Valid \\ (1 bit)};
  \node at (6, -3) {Dev. Ctrl. \\ (opt., 21B)};
  \node at (9, -3) {Read Block \\ (opt., var.)};
  \node at (12, -3) {Write Block \\ (opt., var.)};
  \node at (0.25, 4.1) {Read/Write Block};
  \node at (0.65, 1.1) {Device Control Block};
  \node at (0.3, -1.9) {Peripheral Buffer};

  \draw (5, 2.3) -- (-1.5, 2.3) -- (-1.5, 3.7) -- (5, 3.7);
  \draw[dashed] (5, 3.7) -- (6, 3.7);
  \draw (6, 3.7) -- (9.5, 3.7) -- (9.5, 2.3) -- (6, 2.3);
  \draw[dashed] (6, 2.3) -- (5, 2.3);
  \draw (1.5, 3.7) -- (1.5, 2.3);
  \draw (4.5, 3.7) -- (4.5, 2.3);
  \draw (6.5, 3.7) -- (6.5, 2.3);
  \draw (-1.5, 0.7) -- (16.5, 0.7) -- (16.5, -0.7) -- (-1.5, -0.7) -- cycle;
  \draw (1.5, 0.7) -- (1.5, -0.7);
  \draw (4.5, 0.7) -- (4.5, -0.7);
  \draw (7.5, 0.7) -- (7.5, -0.7);
  \draw (10.5, 0.7) -- (10.5, -0.7);
  \draw (13.5, 0.7) -- (13.5, -0.7);
  \draw (-1.5, -2.3) -- (13.5, -2.3) -- (13.5, -3.7) -- (-1.5, -3.7) -- cycle;
  \draw (1.5, -2.3) -- (1.5, -3.7);
  \draw (4.5, -2.3) -- (4.5, -3.7);
  \draw (7.5, -2.3) -- (7.5, -3.7);
  \draw (10.5, -2.3) -- (10.5, -3.7);

As shown, each buffer consists of up to three substructures: a read block, write block, and possibly a device control block.
The actual sizes of these blocks may vary, depending on how ``ctypes`` chooses to align each structure's fields.

A ``pthread`` `mutex <https://man7.org/linux/man-pages/man3/pthread_mutex_lock.3p.html>`_ protects access to the entire buffer.
A RW lock is not useful since most `buffer operations <#operations>`_ involves both reading and writing.
The valid bit indicates whether this buffer is active (see notes on the `buffer lifecycle <#lifecycle>`_ for details).

The read and write blocks are where student code reads from and writes into, respectively.
Read block parameters are currently sensed values while write block parameters are desired values.
The read block contains a parameter iff that parameter is readable, according to the catalog.
(Likewise for writeable parameters in the write block.)
The ``Timestamp`` field is a double representing the seconds since the epoch, possibly fractional, when any parameter in that block was last written to.

The device control block contains special SD-only fields.
The ``device`` process polls each SD's buffer at a fixed frequency and may send messages to the SD on each cycle.

.. table:: Device Control Block Fields
  :class: compact-table
  :align: center

  +------------------+----------------------------------------+
  | Field            | Description                            |
  +==================+========================================+
  | ``UID``          | Describes the current state of the SD  |
  +------------------+ subscription.                          |
  | ``Subscription`` |                                        |
  +------------------+                                        |
  | ``Delay``        |                                        |
  +------------------+----------------------------------------+
  | ``Read``         | A bitmap identifying parameters the    |
  |                  | ``device`` process should read on the  |
  |                  | next cycle. If at least one bit is     |
  |                  | set, ``device`` emits a ``DEV_READ``   |
  |                  | message and clears the bitmap.         |
  +------------------+----------------------------------------+
  | ``Write``        | Similar to ``Read``, but ``device``    |
  |                  | emits a ``DEV_WRITE`` message with     |
  |                  | data copied from the write block.      |
  |                  | Essentially, dirty bits.               |
  +------------------+----------------------------------------+
  | ``Update``       | A bitmap identifying parameters        |
  |                  | changed since the last SD update.      |
  |                  | The bits are set when a ``DEV_DATA``   |
  |                  | message arrives and its parameters are |
  |                  | copied into the read block. ``server`` |
  |                  | should clear the bitmap after it sends |
  |                  | an update.                             |
  +------------------+----------------------------------------+

Operations
^^^^^^^^^^

A list of atomic buffer operations are listed in the table below.
All operations must begin by acquiring the mutex, checking the valid bit and, if the bit is not set, aborting the operation.

.. table:: Buffer Operations
  :align: center
  :class: compact-table

  ============== ===========
  Operation      Description
  ============== ===========
  ``get_value``  ``executor`` gets the value of a single parameter in the read block.
  ``set_value``  ``executor`` sets the value of a single parameter in the write block, sets the corresponding bit in the ``Write`` bitmap, and updates the write block's ``Timestamp``.
  ``get_read``   ``device`` retrieves, then clears, the ``Read`` bitmap.
  ``set_read``   ``device`` sets the ``Read`` bitmap.
  ``get_write``  ``device`` retrieves the ``Write`` bitmap and the corresponding values in the write block, then clears the bitmap.
  ``get_update`` ``server`` retrieves the ``Update`` bitmap and the corresponding values in the read block, then clears the bitmap.
  ``set_data``   The peripheral owner updates parameters in the read block, sets the corresponding bits in the ``Update`` block, and updates the read block's ``Timestamp``.
  ``set_valid``  The peripheral owner sets the valid bit.
  ``set_sub``    ``device`` sets the subscription state in the device control block.
  ============== ===========

Lifecycle
^^^^^^^^^

Allocating and freeing shared memory is difficult because all consumers must coordinate to achieve consensus.
Otherwise, Runtime risks accessing invalid memory or trying to close a buffer that still has outstanding references.

From the Python `documentation <https://docs.python.org/3/library/multiprocessing.shared_memory.html#multiprocessing.shared_memory.SharedMemory.unlink>`_:

  Requests that the underlying shared memory block be destroyed.
  In order to ensure proper cleanup of resources, ``unlink()`` should be called once (and only once) across all processes which have need for the shared memory block.
  After requesting its destruction, a shared memory block may or may not be immediately destroyed and this behavior may differ across platforms.
  Attempts to access data inside the shared memory block after ``unlink()`` has been called may result in memory access errors.
  Note: the last process relinquishing its hold on a shared memory block may call ``unlink()`` and ``close()`` in either order.

Runtime takes a lazy approach to shared memory management, meaning consumers do not use a background task to proactively open or close views of shared memory.

When a peripheral connects for the first time, the peripheral owner creates the shared memory block and sets the buffer's valid bit.
Subsequent disconnects and reconnects involve toggling the valid bit, but the underlying buffer remains valid memory.
In fact, Runtime delays closing shared memory blocks until it exits because delayed cleanup eliminates the need for out-of-band acknowledgements from consumers that they have closed their views of a block about to be unlinked.
Blocks are allocated on a per-device basis, and there is a bounded number of devices, so running out of shared memory is highly unlikely.

.. Note::
  Delayed cleanup also avoids data races when a connection is transient (*i.e.*, a device rapidly disconnects, then reconnects).
  Poor contact in a loose USB port can cause a transient connection, especially if the robot is colliding with other objects.

Consumers may acquire a list of available buffers from the children of ``/dev/shm``.
Invalid blocks should be treated as if the shared memory does not exist on the filesystem.
A consumer should never die while holding a buffer's mutex if the consumer uses Python's context manager pattern to run an exit handler releasing the mutex.
``pthread`` also has a `robust mutex <https://man7.org/linux/man-pages/man3/pthread_mutexattr_setrobust.3.html>`_ option to deal with a dead owner.

Rejected alternative implementations that proactively clean up shared memory:

* ``server`` is the sole owner of all shared memory blocks.
  Consumers poll ``server`` for a list of active blocks and request allocation/deallocation.
  This design is quite noisy and ``server`` must guess when there are no more outstanding views of a shared memory block before it unlinks the block.
* Add a reference count to every block and unlink the block when the number of views reaches zero.
  A service can die suddenly and leave the reference count too high.
  This design also suffers from the aforementioned transient connection issue.
* Use a special shared memory block as a *directory* of all active blocks, their open/close states, and reference counts.
  This introduces more shared state with a bad single point of failure.
* Use ``inotify`` to alert consumers when a new buffer is available or unavailable.
  When the peripheral disconnects, the peripheral owner unlinks the shared memory immediately, which triggers ``inotify`` to prompt consumers to close their views.

  Although this is an elegant event-driven solution, it relies on the ``multiprocessing.shared_memory`` module's handling of what it calls "memory access errors".
  It's unclear whether these errors entail exceptions or segfaults; the latter would be very bad.
  `POSIX shared memory <https://man7.org/linux/man-pages/man3/shm_unlink.3.html>`_, which Python's ``multiprocessing.shared_memory`` module wraps, allows ``unlink()`` to precede all ``close()`` calls.
  The block remains usable, but invisible on the filesystem, after ``unlink()``.
  In any case, relying on platform-specific behavior and an API like ``inotify`` is not portable.
