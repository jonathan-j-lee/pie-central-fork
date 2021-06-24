Smart Devices
=============

Robots use Smart Devices to interact with the environment through sensing or actuation.
Currently, each Smart Device (SD) consists of an Arduino Micro mounted on a custom printed circuit board.
A `Raspberry Pi 4 Model B <https://www.raspberrypi.org/products/raspberry-pi-4-model-b/>`_, the kit's central single-board computer (SBC), communicates with the Arduinos over USB serial.

Historically, PiE manufactured custom cables and boards to support real-time communication and flexible configuration.
However, custom hardware hampered debugging and development, and the kit's SBC at the time, the Beaglebone Black (BBB), did not provide real-time guarantees anyway.
As a result, the kit shifted towards cheap commodity hardware like Arduino and USB, which are well-tested, enjoy widespread software support, and are relatively simple.

During the spring 2017 season, PiE considered using USB HID, used for peripherals like keyboards and mice, to circumvent the BBB's hardware limit on the number of USB CDC devices.
However, the HID abstraction proved too difficult to use.
A USB OTG hack for chaining USB hubs was required to raise the limit of six devices.

Protocol Specification
----------------------

The Smart Device Protocol is a duplex packet-based protocol layered on a reliable transport like USB serial for communication between an SBC running Runtime and a Smart Device.
PiE chose a packet-based protocol to support heterogenous and relatively low-frequency messages (for example, an update about every 50 ms).

Each Smart Device has between zero and 16 (inclusive) parameters:

* Each parameter has a unique unsigned 8-bit integer identifier, incrementing from zero.
  An ``N``-parameter device has parameters with IDs ``0, 1, 2, ..., N-1``.
* Each parameter has a unique human-readable name.
  There are no formal restrictions, but snake case names are preferred.
* Each parameter is either read-only, write-only, or readable and writeable.
* Each parameter has a data type.
  Similar to standard C types, the supported types are:

  .. hlist::
    :columns: 3

    * ``bool`` (1 byte)
    * ``uint8_t``
    * ``int8_t``
    * ``uint16_t``
    * ``int16_t``
    * ``uint32_t``
    * ``int32_t``
    * ``uint64_t``
    * ``int64_t``
    * ``float`` (4 bytes)
    * ``double`` (8 bytes)

  As implied by its name, an ``(u)intNN_t`` integral type is exactly ``NN/8`` bytes wide.
  The ``u`` prefix denotes an unsigned type.
  An integral type without the ``u`` prefix is signed.

.. Warning::

  For some boards, Arduino's ``double`` type is as wide as its ``float`` type: 4 bytes.
  Avoid adding parameters with the ``double`` type unless the Smart Device's microcontroller actually produces doubles eight bytes wide, as required.

Message Format
^^^^^^^^^^^^^^

Every message (packet) follows a basic format:

.. tikz:: Message Format
  :align: center

  [font=\ttfamily, scale=0.55, every node/.style={scale=0.55}]
  \fill[blue!20] (-1.5, 0.7) rectangle (8.5, -0.7);
  \node[align=center] at (0, 0) {Message ID \\ (8 bits)};
  \node[align=center] at (3.5, 0) {Payload Length \\ (8 bits)};
  \node[align=center] at (7, 0) {Payload \\ (variable)};
  \node[align=center] at (10, 0) {Checksum \\ (8 bits)};
  \draw[thick] (-1.5, 0.7) -- (11.5, 0.7) -- (11.5, -0.7) -- (-1.5, -0.7) -- cycle;
  \draw[thick] (1.5, 0.7) -- (1.5, -0.7);
  \draw[thick] (5.5, 0.7) -- (5.5, -0.7);
  \draw[thick] (8.5, 0.7) -- (8.5, -0.7);

* The message ID is an unsigned 8-bit integer, which specifies the message's type and determines the payload format.
* The payload length is an 8-bit unsigned integer specifying the number of bytes in the payload.
  The payload can be up to 255 bytes long (inclusive).
* The checksum is the XOR of every other byte in the message (the portion shown in blue).

UID Format
^^^^^^^^^^

Each Smart Device is assigned a unique 88-bit identifier (UID) at compile time:

.. tikz:: UID Format
  :align: center

  [font=\ttfamily, scale=0.55, every node/.style={scale=0.55}]
  \node[align=center] at (0, 0) {Device ID \\ (16 bits)};
  \node[align=center] at (3, 0) {Year \\ (8 bits)};
  \node[align=center] at (6, 0) {Random \\ (64 bits)};
  \draw[thick] (-1.5, 0.7) -- (7.5, 0.7) -- (7.5, -0.7) -- (-1.5, -0.7) -- cycle;
  \draw[thick] (1.5, 0.7) -- (1.5, -0.7);
  \draw[thick] (4.5, 0.7) -- (4.5, -0.7);

* The device ID is an unsigned 8-bit integer, which specifies the device's type.
* The year is an unsigned 8-bit integer specifying what competition the device was manufactured for.
  Year ``0x00`` corresponds to the spring 2016 season, and each subsequent season increments the year ID.
  (Although PiE strives to hold a competition annually, the year ID would not increment in a year where PiE is unable to.)
* The random portion of the UID is randomly generated to ensure UID uniqueness.
  In any given year, the probability of a collision with 1000 of one type of device is roughly 0.05%.
  This is a generous upperbound on the actual collision likelihood, since PiE typically produces many times fewer of even the most common device, motor controllers.

Message Types
^^^^^^^^^^^^^

.. table:: Message Types
  :widths: 1 3 3 10
  :class: compact-table

  ========== ============ ============ ===========================================
  ID         Name         Direction    Description
  ========== ============ ============ ===========================================
  ``0x10``   Ping         SBC |->| SD  The SBC pings the SD for enumeration purposes.
                                       The SD responds with a subscription response.
  ``0x11``   Subscription SBC |->| SD  The SBC requests data to be returned asynchronously
             Request                   at a given constant interval (delay) for some parameters.
                                       The SD responds with a subscription response.

                                       * Only one subscription may exist at a time.
                                       * A requested delay of zero indicates the SBC does not wish
                                         to receive data, which disables any existing subscription.
                                       * However, subscribing to zero parameters with a nonzero
                                         delay will still cause the SD to send empty updates.
  ``0x12``   Subscription SBC |<-| SD  The SD acknowledges a subscription with its subscription
             Response                  status and `UID <#uid-format>`_.

                                       * The returned delay and parameter bitmap are how the SD
                                         will actually send updates, which may differ from what the
                                         SBC requested. For example, the SBC may incorrectly
                                         subscribe to nonexistent or write-only parameters.
                                       * The SD may break up updates across multiple device data packets,
                                         especially if the SBC subscribes to many wide parameters.
  ``0x13``   Device Read  SBC |->| SD  The SBC requests some values from the SD. The SD responds
                                       with zero or more device data packets with values for all
                                       readable parameters requested.
  ``0x14``   Device Write SBC |->| SD  The SBC attempts to write some values to the SD. The SD
                                       responds with zero or more device data packets describing
                                       all the readable parameters that were successfully written to.
                                       There is no acknowledgement for write-only parameters.
  ``0x15``   Device Data  SBC |<-| SD  The SD sends values of readable parameters to the SBC.
                                       This can occur in response to a device read/write or as
                                       part of a subscription update.
  ``0x16``   Device       SBC |->| SD  The SBC attempts to disable the SD, which ceases all
             Disable                   operation for safety reasons.
                                       The SD continues to respond to packets and may resume operation without power cycling.
  ``0x17``   Heartbeat    SBC |<->| SD Either the SBC or the SD requests the other endpoint to send
             Request                   a heartbeat response, which should be sent back immediately.
                                       The payload (ID) is currently unused, but may be used for
                                       tracking outstanding requests to measure latency.
  ``0x18``   Heartbeat    SBC |<->| SD The endpoint receiving a heartbeat request should send back
             Response                  a heartbeat response with the request's ID.
  ``0xFF``   Error        SBC |<-| SD  The SD indicates to the SBC an error has occurred.
  ========== ============ ============ ===========================================

.. Note::
  To avoid chatter, subscriptions are generally preferred over device reads (polling) for regular updates.
  The delay between updates is also likely to be more consistent.

The payload format of each message type is shown below.
The endianness of each multi-byte segment is determined by the endianness of the particular board.
Arduino Micros are little-endian (least significant byte first).

.. tikz:: Payload Formats
  :align: center

  [font=\ttfamily, scale=0.55, every node/.style={scale=0.55}]
  \node[align=center] at (-1, 0) {Ping};
  \node[align=center] at (3, 0) {Empty \\ (0 bits)};
  \draw[thick] (1.5, 0.7) -- (4.5, 0.7) -- (4.5, -0.7) -- (1.5, -0.7) -- cycle;
  \node[align=center] at (-1, -2) {Subscription \\ Request};
  \node[align=center] at (3, -2) {Params \\ (16 bits)};
  \node[align=center] at (6, -2) {Delay \\ (16 bits)};
  \draw[thick] (1.5, -1.3) -- (7.5, -1.3) -- (7.5, -2.7) -- (1.5, -2.7) -- cycle;
  \draw[thick] (4.5, -1.3) -- (4.5, -2.7);
  \node[align=center] at (-1, -4) {Subscription \\ Response};
  \node[align=center] at (3, -4) {Params \\ (16 bits)};
  \node[align=center] at (6, -4) {Delay \\ (16 bits)};
  \node[align=center] at (9, -4) {UID \\ (88 bits)};
  \draw[thick] (1.5, -3.3) -- (10.5, -3.3) -- (10.5, -4.7) -- (1.5, -4.7) -- cycle;
  \draw[thick] (4.5, -3.3) -- (4.5, -4.7);
  \draw[thick] (7.5, -3.3) -- (7.5, -4.7);
  \node[align=center] at (-1, -6) {Device \\ Read};
  \node[align=center] at (3, -6) {Params \\ (16 bits)};
  \draw[thick] (1.5, -5.3) -- (4.5, -5.3) -- (4.5, -6.7) -- (1.5, -6.7) -- cycle;
  \node[align=center] at (-1, -8) {Device \\ Write};
  \node[align=center] at (3, -8) {Params \\ (16 bits)};
  \node[align=center] at (6, -8) {Value 0 \\ (var., opt.)};
  \node[align=center] at (11, -8) {Value 15 \\ (var., opt.)};
  \draw[thick] (8, -7.3) -- (1.5, -7.3) -- (1.5, -8.7) -- (8, -8.7);
  \draw[thick] (4.5, -7.3) -- (4.5, -8.7);
  \draw[thick] (7.5, -7.3) -- (7.5, -8.7);
  \draw[thick, dashed] (8, -7.3) -- (9, -7.3);
  \draw[thick, dashed] (8, -8.7) -- (9, -8.7);
  \draw[thick] (9.5, -7.3) -- (9.5, -8.7);
  \draw[thick] (9, -7.3) -- (12.5, -7.3) -- (12.5, -8.7) -- (9, -8.7);
  \node[align=center] at (-1, -10) {Device \\ Data};
  \node[align=center] at (3, -10) {Params \\ (16 bits)};
  \node[align=center] at (6, -10) {Value 0 \\ (var., opt.)};
  \node[align=center] at (11, -10) {Value 15 \\ (var., opt.)};
  \draw[thick] (8, -9.3) -- (1.5, -9.3) -- (1.5, -10.7) -- (8, -10.7);
  \draw[thick] (4.5, -9.3) -- (4.5, -10.7);
  \draw[thick] (7.5, -9.3) -- (7.5, -10.7);
  \draw[thick, dashed] (8, -9.3) -- (9, -9.3);
  \draw[thick, dashed] (8, -10.7) -- (9, -10.7);
  \draw[thick] (9.5, -9.3) -- (9.5, -10.7);
  \draw[thick] (9, -9.3) -- (12.5, -9.3) -- (12.5, -10.7) -- (9, -10.7);
  \node[align=center] at (-1, -12) {Heartbeat \\ Request};
  \node[align=center] at (3, -12) {ID \\ (8 bits)};
  \draw[thick] (1.5, -11.3) -- (4.5, -11.3) -- (4.5, -12.7) -- (1.5, -12.7) -- cycle;
  \node[align=center] at (-1, -14) {Heartbeat \\ Response};
  \node[align=center] at (3, -14) {ID \\ (8 bits)};
  \draw[thick] (1.5, -13.3) -- (4.5, -13.3) -- (4.5, -14.7) -- (1.5, -14.7) -- cycle;
  \node[align=center] at (-1, -16) {Error};
  \node[align=center] at (3, -16) {Error Code \\ (8 bits)};
  \draw[thick] (1.5, -15.3) -- (4.5, -15.3) -- (4.5, -16.7) -- (1.5, -16.7) -- cycle;

* Some payloads begin with a ``Params`` bitmap to reference a subset of the device's parameters.
  The parameter with ID ``i`` is included if and only if bit ``i`` is one, with the bitmap's least significant bit defined as the 0th bit.
* The ``Delay`` field of subscription request/response packets is an unsigned 8-bit integer specifying the number of milliseconds between updates.
* Device write and device data packets order values by ascending parameter ID.
  The sum of the widths of the included parameters' types must equal the length of the values segment.
* The Smart Device Protocol is asynchronous, meaning messages may be interspersed in whatever order either endpoint chooses.
  For example, it is valid for an endpoint to have two in-flight heartbeat requests.
  The endpoint need not block sending the second heartbeat request until the first heartbeat response returns.
* A Smart Device may disable itself for safety reasons if it does not receive a valid packet from the SBC after some time.

.. table:: Error Codes
  :align: center

  ========== ===========================
  Error Code Description
  ========== ===========================
  ``0xFD``   Unexpected packet delimiter
  ``0xFE``   Checksum error
  ``0xFF``   Generic error
  ========== ===========================

Transport
^^^^^^^^^

When the Smart Device Protocol is layered on a bytestream-based transport like USB serial, the communication endpoints must delimit packet boundaries with a null byte (``0x00``) and encode each packet with `Consistent Overhead Byte Stuffing (COBS) <https://en.wikipedia.org/wiki/Consistent_Overhead_Byte_Stuffing>`_ before placement on the wire.
At the cost of slightly expanding each message (proportional to the message's length), COBS ensures encoded messages are free of the null byte.
This encoding allows the bytestream to transport variable-length messages without requiring endpoints to maintain packet length state.

Device List
-----------

``LimitSwitch`` (ID: ``0x00``)
  Detects whether three switches are open or closed.
  The switches are open, by default.

  .. list-table:: Limit Switch Board and Switches
    :align: center
    :widths: 4 5

    * - .. figure:: _static/img/smart-devices/limit-switch.png
      - .. figure:: _static/img/smart-devices/switches.png

  .. table:: Parameter Information
    :align: center
    :class: compact-table

    +---------+-------------+----------+-------+--------+--------------------+
    | ID      | Name        | Type     | Read? | Write? | Notes              |
    +=========+=============+==========+=======+========+====================+
    | ``0x0`` | ``switch0`` | ``bool`` | Yes   | No     | True when a switch |
    +---------+-------------+----------+-------+--------+ is closed.         |
    | ``0x1`` | ``switch1`` | ``bool`` | Yes   | No     |                    |
    +---------+-------------+----------+-------+--------+                    |
    | ``0x2`` | ``switch2`` | ``bool`` | Yes   | No     |                    |
    +---------+-------------+----------+-------+--------+--------------------+

``LineFollower`` (ID: ``0x01``)
  Three colinear brightness sensors used to detect and follow reflective tape on the floor.
  The line follower works best when the sensors are as close to the ground as possible.

  .. list-table:: Line Follower Board and Head
    :align: center
    :widths: 2 3

    * - .. figure:: _static/img/smart-devices/line-follower.png
      - .. figure:: _static/img/smart-devices/line-follower-head.png

  .. table:: Parameter Information
    :align: center
    :class: compact-table

    +---------+------------+-----------+-------+--------+------------------------------------+
    | ID      | Name       | Type      | Read? | Write? | Notes                              |
    +=========+============+===========+=======+========+====================================+
    | ``0x0`` | ``left``   | ``float`` | Yes   | No     | Intensities are between 0 and 1,   |
    +---------+------------+-----------+-------+--------+ where 0 denotes complete darkness  |
    | ``0x1`` | ``center`` | ``float`` | Yes   | No     | and 1 denotes complete reflection. |
    +---------+------------+-----------+-------+--------+                                    |
    | ``0x2`` | ``right``  | ``float`` | Yes   | No     |                                    |
    +---------+------------+-----------+-------+--------+------------------------------------+

``Potentiometer`` (ID: ``0x02``)
  Detects the angle of three rotating dials.
  The track spans only a circular sector, not the full disk.

  .. table:: Parameter Information
    :align: center
    :class: compact-table

    +---------+----------+-----------+-------+--------+-------------------------------+
    | ID      | Name     | Type      | Read? | Write? | Notes                         |
    +=========+==========+===========+=======+========+===============================+
    | ``0x0`` | ``pot0`` | ``float`` | Yes   | No     | Rotations are between 0 and   |
    +---------+----------+-----------+-------+--------+ 1, which correspond to the    |
    | ``0x1`` | ``pot1`` | ``float`` | Yes   | No     | two ends of the sector.       |
    +---------+----------+-----------+-------+--------+                               |
    | ``0x2`` | ``pot2`` | ``float`` | Yes   | No     |                               |
    +---------+----------+-----------+-------+--------+-------------------------------+

``Encoder`` (ID: ``0x03``)
  Detects angular position like the potentiometer, but for a continuously rotating joint.

  .. table:: Parameter Information
    :align: center
    :class: compact-table

    +---------+--------------+-----------+-------+--------+------------------------------+
    | ID      | Name         | Type      | Read? | Write? | Notes                        |
    +=========+==============+===========+=======+========+==============================+
    | ``0x0`` | ``rotation`` | ``float`` | Yes   | No     | A position in encoder ticks  |
    |         |              |           |       |        | (4400 per revolution).       |
    +---------+--------------+-----------+-------+--------+------------------------------+

``BatteryBuzzer`` (ID: ``0x04``)
  Monitors battery voltages and cell balances.
  The power distribution board (PDB) is shown below (left):

  * Closing the circuitbreaker's yellow switch in the center switches on the PDB.
    Pressing the circuitbreaker's red button opens the switch.
  * Horizontal Anderson connectors, which power motors, populate the PDB's right side.
    Following convention, the black connectors stand for ground, the red for power.
    The motors use vertically stacked Andersons that can only be plugged into a motor controller, not directly into the PDB, to discourage such an accident.
  * ATX connectors, which power servos and the Raspberry Pi, populate the PDB's left side.
  * The buzzer in the bottom left corner beeps once when switched on under normal operation, and beeps continuously when the battery condition is unsafe.
  * The ATX connectors above the buzzer connect to the battery.
  * The seven-segment display in the bottom right corner shows the battery's voltage.
  * The Arduino is optional.
    The buzzer works even without the Arduino.

  The LIPO battery (shown below, right) contains three separate cells with their own voltages that are connected in parallel.
  Using a battery under unsafe conditions may permanently damage the battery and pose an electrical or fire risk.
  Generally, an acceptable battery voltage ranges from about 10.5V to 12V.
  Avoid overcharging batteries by leaving them unsupervised for more than several hours.

  .. list-table:: Power Distribution Board and Battery
    :align: center
    :widths: 2 3

    * - .. figure:: _static/img/smart-devices/pdb.png
      - .. figure:: _static/img/smart-devices/battery.png

  .. table:: Parameter Information
    :align: center
    :class: compact-table

    +---------+----------------+-----------+-------+--------+--------------------------------+
    | ID      | Name           | Type      | Read? | Write? | Notes                          |
    +=========+================+===========+=======+========+================================+
    | ``0x0`` | ``is_unsafe``  | ``bool``  | Yes   | No     | True when the battery voltage  |
    |         |                |           |       |        | is too low or the cells are    |
    |         |                |           |       |        | too imbalanced for safe use.   |
    +---------+----------------+-----------+-------+--------+--------------------------------+
    | ``0x1`` | ``calibrated`` | ``bool``  | Yes   | No     | True if the battery has been   |
    |         |                |           |       |        | calibrated (calibration        |
    |         |                |           |       |        | voltage is stored in EEPROM).  |
    +---------+----------------+-----------+-------+--------+--------------------------------+
    | ``0x2`` | ``v_cell1``    | ``float`` | Yes   | No     | Voltages (in Volts) of each    |
    +---------+----------------+-----------+-------+--------+ of the three cells.            |
    | ``0x3`` | ``v_cell2``    | ``float`` | Yes   | No     |                                |
    +---------+----------------+-----------+-------+--------+                                |
    | ``0x4`` | ``v_cell3``    | ``float`` | Yes   | No     |                                |
    +---------+----------------+-----------+-------+--------+--------------------------------+
    | ``0x5`` | ``v_batt``     | ``float`` | Yes   | No     | The overall battery voltage    |
    |         |                |           |       |        | (in Volts). Alias for          |
    |         |                |           |       |        | ``v_cell3``.                   |
    +---------+----------------+-----------+-------+--------+--------------------------------+
    | ``0x6`` | ``dv_cell2``   | ``float`` | Yes   | No     | ``v_cell2`` minus ``v_cell1``. |
    +---------+----------------+-----------+-------+--------+--------------------------------+
    | ``0x7`` | ``dv_cell3``   | ``float`` | Yes   | No     | ``v_cell3`` minus ``v_cell2``. |
    +---------+----------------+-----------+-------+--------+--------------------------------+

``TeamFlag`` (ID: ``0x05``)
  Powers colored LEDs to indicate the robot's team.

  .. list-table:: Team Flag
    :align: center

    * - .. figure:: _static/img/smart-devices/team-flag.png
          :align: center
          :figwidth: 30%

  .. table:: Parameter Information
    :align: center
    :class: compact-table

    +---------+------------+----------+-------+--------+--------------------------------------+
    | ID      | Name       | Type     | Read? | Write? | Notes                                |
    +=========+============+==========+=======+========+======================================+
    | ``0x0`` | ``mode``   | ``bool`` | Yes   | Yes    | True if all LEDs are enabled (not    |
    |         |            |          |       |        | necessarily on).                     |
    +---------+------------+----------+-------+--------+--------------------------------------+
    | ``0x1`` | ``blue``   | ``bool`` | Yes   | Yes    | True if the LED color is enabeld.    |
    +---------+------------+----------+-------+--------+ Technically, these flags allow both  |
    | ``0x2`` | ``yellow`` | ``bool`` | Yes   | Yes    | colors to be enabled simultaneously. |
    +---------+------------+----------+-------+--------+--------------------------------------+
    | ``0x3`` | ``led1``   | ``bool`` | Yes   | Yes    | Each color can light up to four      |
    +---------+------------+----------+-------+--------+ individual LEDs to allow for varying |
    | ``0x4`` | ``led2``   | ``bool`` | Yes   | Yes    | degrees of brightness. These         |
    +---------+------------+----------+-------+--------+ parameters are true if the           |
    | ``0x5`` | ``led3``   | ``bool`` | Yes   | Yes    | corresponding LEDs are active.       |
    +---------+------------+----------+-------+--------+                                      |
    | ``0x6`` | ``led4``   | ``bool`` | Yes   | Yes    |                                      |
    +---------+------------+----------+-------+--------+--------------------------------------+

``Grizzly`` (ID: ``0x06``)
  The discontinued Grizzly Bear motor controller.
  No parameters are specified, but the device ID is reserved for future use.

``ServoControl`` (ID: ``0x07``)
  Controls a pair of servo motors, which do not spin continuously and are best used for joints.

  .. list-table:: Servo Controller and Servo Motor
    :align: center
    :widths: 2 3

    * - .. figure:: _static/img/smart-devices/servo-controller.png
      - .. figure:: _static/img/smart-devices/servo.png

  .. table:: Parameter Information
    :align: center
    :class: compact-table

    +---------+------------+-----------+-------+--------+---------------------+
    | ID      | Name       | Type      | Read? | Write? | Notes               |
    +=========+============+===========+=======+========+=====================+
    | ``0x0`` | ``servo0`` | ``float`` | Yes   | Yes    | A position between  |
    +---------+------------+-----------+-------+--------+ -1 and 1.           |
    | ``0x1`` | ``servo1`` | ``float`` | Yes   | Yes    |                     |
    +---------+------------+-----------+-------+--------+---------------------+

``LinearActuator`` (ID: ``0x08``)
  An extensible joint creating translational motion.
  No such device exists yet, but the device ID is reserved for future use.

``ColorSensor`` (ID: ``0x09``)
  Color sensor.
  No such device exists yet, but the device ID is reserved for future use.

``YogiBear`` (ID: ``0x0A``)
  A discontinued COTS motor controller.
  It has the same behavior and parameters as the ``PolarBear`` (see below).

``RFID`` (ID: ``0x0B``)
  Detects radio-frequency identifiers.
  Because of hardware quirks, this sensor can sometimes be slow or report false negatives.
  The RFID sensor also works best at very close range (0.5 inches is about the maximum range).

  .. list-table:: RFID Reader
    :align: center

    * - .. figure:: _static/img/smart-devices/rfid.png
          :align: center
          :figwidth: 50%

  .. table:: Parameter Information
    :align: center
    :class: compact-table

    +---------+----------------------+--------------+-------+--------+----------------------------------------+
    | ID      | Name                 | Type         | Read? | Write? | Notes                                  |
    +=========+======================+==============+=======+========+========================================+
    | ``0x0`` | ``id``               | ``uint32_t`` | Yes   | No     | The identifier. If ``detect_tag``      |
    |         |                      |              |       |        | is false, this parameter is undefined. |
    +---------+----------------------+--------------+-------+--------+----------------------------------------+
    | ``0x1`` | ``detect_tag``       | ``bool``     | Yes   | No     | True if a tag is detected.             |
    +---------+----------------------+--------------+-------+--------+----------------------------------------+

``PolarBear`` (ID: ``0x0C``)
  The COTS motor controller that succeeded the Yogi Bear.
  If equipped with a position encoder, the Polar Bear can supposedly perform PID to track position and velocity setpoints.
  It has a unique safety feature: it disables itself if Runtime does not respond to the Polar Bear's heartbeat requests.

  .. list-table:: Polar Bear and DC Motor
    :align: center
    :widths: 1 1

    * - .. figure:: _static/img/smart-devices/polar-bear.png
      - .. figure:: _static/img/smart-devices/motor.png

  .. table:: Parameter Information
    :align: center
    :class: compact-table

    +---------+----------------------+-----------+-------+--------+-------------------------------+
    | ID      | Name                 | Type      | Read? | Write? | Notes                         |
    +=========+======================+===========+=======+========+===============================+
    | ``0x0`` | ``duty_cycle``       | ``float`` | Yes   | Yes    | Between -1 and 1. The sign    |
    |         |                      |           |       |        | indicates the direction the   |
    |         |                      |           |       |        | motor should run in, and a    |
    |         |                      |           |       |        | greater duty cycle magnitude  |
    |         |                      |           |       |        | corresponds to a faster speed |
    |         |                      |           |       |        | (more current).               |
    +---------+----------------------+-----------+-------+--------+-------------------------------+
    | ``0x1`` | ``pid_pos_setpoint`` | ``float`` | No    | Yes    | A position in encoder ticks.  |
    |         |                      |           |       |        | There are 4400 ticks per      |
    |         |                      |           |       |        | revolution, and the sensor    |
    |         |                      |           |       |        | has a resolution of a 100     |
    |         |                      |           |       |        | ticks. That is, the motor can |
    |         |                      |           |       |        | rotate by up to 100 ticks per |
    |         |                      |           |       |        | read cycle.                   |
    +---------+----------------------+-----------+-------+--------+-------------------------------+
    | ``0x2`` | ``pid_pos_kp``       | ``float`` | No    | Yes    | The PID coefficients for      |
    +---------+----------------------+-----------+-------+--------+ position tracking. Defaults   |
    | ``0x3`` | ``pid_pos_ki``       | ``float`` | No    | Yes    | to 1 for the proportional     |
    +---------+----------------------+-----------+-------+--------+ term and 0 for the others.    |
    | ``0x4`` | ``pid_pos_kd``       | ``float`` | No    | Yes    |                               |
    +---------+----------------------+-----------+-------+--------+-------------------------------+
    | ``0x5`` | ``pid_vel_setpoint`` | ``float`` | No    | Yes    | A velocity (encoder ticks     |
    |         |                      |           |       |        | per second).                  |
    +---------+----------------------+-----------+-------+--------+-------------------------------+
    | ``0x6`` | ``pid_vel_kp``       | ``float`` | No    | Yes    | The PID coefficients for      |
    +---------+----------------------+-----------+-------+--------+ velocity tracking. Defaults   |
    | ``0x7`` | ``pid_vel_ki``       | ``float`` | No    | Yes    | to 1 for the proportional     |
    +---------+----------------------+-----------+-------+--------+ term and 0 for the others.    |
    | ``0x8`` | ``pid_vel_kd``       | ``float`` | No    | Yes    |                               |
    +---------+----------------------+-----------+-------+--------+-------------------------------+
    | ``0x9`` | ``current_thresh``   | ``float`` | No    | Yes    | Current threshold in Amperes. |
    |         |                      |           |       |        | The hardware also enforces a  |
    |         |                      |           |       |        | current limit.                |
    +---------+----------------------+-----------+-------+--------+-------------------------------+
    | ``0xA`` | ``enc_pos``          | ``float`` | Yes   | Yes    | Encoder position in ticks.    |
    +---------+----------------------+-----------+-------+--------+-------------------------------+
    | ``0xB`` | ``enc_vel``          | ``float`` | Yes   | No     | Encoder velocity in ticks per |
    |         |                      |           |       |        | second.                       |
    +---------+----------------------+-----------+-------+--------+-------------------------------+
    | ``0xC`` | ``motor_current``    | ``float`` | Yes   | No     | Motor current usage in        |
    |         |                      |           |       |        | Amperes.                      |
    +---------+----------------------+-----------+-------+--------+-------------------------------+
    | ``0xD`` | ``deadband``         | ``float`` | Yes   | Yes    | Deadband between 0 and 1.     |
    |         |                      |           |       |        | Duty cycles with a magnitude  |
    |         |                      |           |       |        | less than the deadband will   |
    |         |                      |           |       |        | not activate the motor.       |
    +---------+----------------------+-----------+-------+--------+-------------------------------+

``DistanceSensor`` (ID: ``0x10``)
  Detects distance using a technology like LIDAR or ultrasound.
  No such device exists yet, but the device ID is reserved for future use.

``MetalDetector`` (ID: ``0x11``)
  Detects the metals.
  No such device exists yet, but the device ID is reserved for future use.

.. |<-| unicode:: 0x2190 .. leftwards arrow
.. |->| unicode:: 0x2192 .. rightwards arrow
.. |<->| unicode:: 0x2194 .. leftright arrow
