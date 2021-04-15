#ifndef SMART_DEVICE_H_
#define SMART_DEVICE_H_

#include "cobs.h"
#include "message.hpp"

#define ms_to_us(x) (((uint64_t) x)*1000)

#define ADD_ARDUINO_SETUP_AND_LOOP(x)   \
    void setup(void) {                  \
        (x).setup();                    \
    }                                   \
    void loop(void) {                   \
        (x).loop();                     \
    }                                   \

/**
 *  A wrapper around Arduino's `Serial` to implement COBS encoding and error
 *  handling for Smart Device messages.
 */
class SerialHandler {
    /* Buffer for storing COBS-encoded messages as received/transmitted on the
       wire. The buffer should be large enough to never run into a overflow. */
    byte serial_buf[ENCODING_MAX_SIZE];
    cobs_encode_result encode_result;
    cobs_decode_result decode_result;
    static const uint64_t BAUD_RATE = 115200;

public:
    /* Set up the serial connection. */
    void setup(void);
    /* Read an incoming Smart Device message. Return true iff the handler
       received a valid message. If decoding fails, the serial handler may
       transmit an error message. */
    bool recv(Message *);
    /* Write an outgoing Smart Device message. Return true iff the handler
       succeeded. If encoding fails, the handler will transmit a generic
       error. */
    bool send(Message *);
};

/**
 *  Because the Arduino is a single-threaded real-time platform, we have to use
 *  hardware interrupts to context switch. Tasks bookkeep the scheduling
 *  information needed to implement concurrency.
 *
 *  Absolute timestamps are retrieved from Arduino's `millis` function.
 */
class Task {
    /* A flag set when the task is ready to be run. Tasks do not call
       callbacks directly. */
    bool ready;
    /* The absolute timestamp (in ms) of when the task last ran. */
    unsigned long last;
    /* The time delta (in ms) between task executions. */
    interval_t interval;
    /* The absolute timestamp (in ms) of when the task should next be run. */
    unsigned long next(void);
    /* The maximum interval duration (in ms). */
    static const interval_t MAX_INTERVAL = 1000;

public:
    Task(interval_t);
    interval_t get_interval(void);
    void set_interval(interval_t);
    /* Return whether the task is ready to execute, then clear the ready flag. */
    bool clear_ready(void);
    /* Set the ready flag of tasks ready to execute. Return the absolute
       timestamp (in ms) until the next earliest task must execute. Update the
       `last` execution timestamp of any ready tasks to the current time. */
    static unsigned long select(size_t, Task **);
};

/* Consumers of the `SmartDevice` library should extend the `SmartDevice`
   class. Each function should execute fairly quickly, since reading/writing a
   parameter most likely involves reading/writing a voltage or memory. Slow
   reads/writes may block the Smart Device's main loop and make the device seem
   unresponsive. */
class SmartDevice {
public:
    /* Set up hardware used by this Smart Device. */
    virtual void setup(void);
    /* Get the addresses and sizes of the parameters. Return the number of
       parameters. */
    virtual size_t get_parameters(Parameter *) = 0;
    /* Read the device parameters specified by the given map. Return the actual
       parameters read. */
    virtual param_map_t read(param_map_t) = 0;
    /* Write the device parameters specified by the given map. Return the actual
       parameters written. */
    virtual param_map_t write(param_map_t);
    /* Disable all parameters. */
    virtual void disable(void);
};

/**
 *  A Smart Device is a sensor or actuator that has readable and writeable
 *  parameters.
 */
class SmartDeviceLoop {
    SmartDevice *sd;
    SerialHandler serial;
    DeviceUID uid;
    Message msg;
    Parameter params[MAX_PARAMETERS];
    /* A bitmap of subscribed parameters. Only valid iff the `update` task has
       a positive interval. */
    param_map_t subscription;
    Task update;    /* Task for subscription updates. */
    Task hb;        /* Task for sending heartbeat requests. */

    /* The minimum timeout (in ms) for `serve_once` to actually receive a
       packet. If the requested timeout is less than this minimum, the method
       will instead just delay, since it's not worth waiting for such a short
       amount of time. */
    static const interval_t MIN_TIMEOUT = 10;
    /* Minimum duration (in ms) spent serving packets. This prevents a slow
       read from completely blocking the main loop. */
    static const interval_t MIN_SERVE_INTERVAL = 40;
    /* Bounds on the subscription interval (in ms). A special subscription
       interval of zero will disable subscriptions entirely. */
    static const interval_t MIN_SUB_INTERVAL = 40;
    static const interval_t MAX_SUB_INTERVAL = 250;
    /* Disable check interval (in ms). */
    static const interval_t DISABLE_INTERVAL = 1000;
    /* Heartbeat request interval (in ms). */
    static const interval_t HB_INTERVAL = 1000;

    /* True iff an active subscription exists. */
    bool is_subscribed(void);
    /* Handle a subscription request. The actual subscription may differ from
       the requested parameters if some parameters are not readable. */
    void set_subscription(param_map_t, interval_t);
    /* Helper method to read and transmit the requested parameters. The payload
       may overflow if too many wide parameters are requested. In that case,
       the Smart Device will break up the data across multiple packets. */
    bool send_data(param_map_t);
    /* Receive up to one Smart Device message and send zero or more messages in
       response. This method may block for up to as long as the timeout (in ms)
       given as the argument. */
    void serve_once(unsigned long);
    /* Callback that disables the device if the serial handler has not received
       valid messages recently. Called periodically by `Timer1` (a hardware
       interrupt). */
    static void maybe_disable(void);

public:
    /* Required constructor. Parameters are a one-byte device ID, the number of
       parameters, and the array of parameters. */
    SmartDeviceLoop(device_id_t, SmartDevice *);
    /* A drop-in replacement for Arduino's required `setup` function. */
    void setup(void);
    /* A drop-in replacement for Arduino's required `loop` function. */
    void loop(void);
};

#endif
