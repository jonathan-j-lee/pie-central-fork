#ifndef SMART_DEVICE_H_
#define SMART_DEVICE_H_

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
    message::interval_t interval;
    /* The absolute timestamp (in ms) of when the task should next be run. */
    unsigned long next(void);
    /* The maximum interval duration (in ms). */
    static const message::interval_t MAX_INTERVAL;

public:
    Task(message::interval_t);
    message::interval_t get_interval(void);
    void set_interval(message::interval_t);
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
    virtual size_t get_parameters(message::Parameter *) = 0;
    /* Read the device parameters specified by the given map. Return the actual
       parameters read. */
    virtual message::param_map_t read(message::param_map_t) = 0;
    /* Write the device parameters specified by the given map. Return the actual
       parameters written. */
    virtual message::param_map_t write(message::param_map_t);
    /* Disable all parameters. */
    virtual void disable(void);
};

/**
 *  A Smart Device is a sensor or actuator that has readable and writeable
 *  parameters.
 */
class SmartDeviceLoop {
    SmartDevice *sd;
    /* Buffer for storing COBS-encoded messages as received/transmitted on the
       wire. The buffer should be large enough to never run into a overflow. */
    byte serial_buf[ENCODING_MAX_SIZE];
    message::DeviceUID uid;
    message::Message msg;
    message::Parameter params[MAX_PARAMETERS];
    /* A bitmap of subscribed parameters. Only valid iff the `update` task has
       a positive interval. */
    message::param_map_t subscription;
    Task update;    /* Task for subscription updates. */
    Task hb;        /* Task for sending heartbeat requests. */

    static const uint64_t BAUD_RATE;
    /* The minimum timeout (in ms) for `serve_once` to actually receive a
       packet. If the requested timeout is less than this minimum, the method
       will instead just delay, since it's not worth waiting for such a short
       amount of time. */
    static const message::interval_t MIN_TIMEOUT;
    /* Minimum duration (in ms) spent serving packets. This prevents a slow
       read from completely blocking the main loop. */
    static const message::interval_t MIN_SERVE_INTERVAL;
    /* Bounds on the subscription interval (in ms). A special subscription
       interval of zero will disable subscriptions entirely. */
    static const message::interval_t MIN_SUB_INTERVAL;
    static const message::interval_t MAX_SUB_INTERVAL;
    /* Disable check interval (in ms). */
    static const message::interval_t DISABLE_INTERVAL;
    /* Heartbeat request interval (in ms). */
    static const message::interval_t HB_INTERVAL;

    /* Read an incoming Smart Device message with the provided timeout (in ms).
       Return true iff the loop received a valid message. If decoding fails,
       the loop may transmit an error message. */
    bool recv(unsigned long);
    /* Write an outgoing Smart Device message. Return true iff the loop
       succeeded. If encoding fails, the loop will transmit a generic error. */
    bool send(void);
    /* True iff an active subscription exists. */
    bool is_subscribed(void);
    /* Clear parameters present in the subscription, if a subscription exists. */
    message::param_map_t mask_subscription(message::param_map_t);
    /* Handle a subscription request. The actual subscription may differ from
       the requested parameters if some parameters are not readable. */
    void set_subscription(message::param_map_t, message::interval_t);
    /* Helper method to read and transmit the requested parameters. The payload
       may overflow if too many wide parameters are requested. In that case,
       the Smart Device will break up the data across multiple packets. */
    bool send_data(message::param_map_t);
    /* Receive up to one Smart Device message and send zero or more messages in
       response. This method may block for up to as long as the timeout (in ms)
       given as the argument. */
    void serve_once(unsigned long);
    /* Callback that disables the device if the serial handler has not received
       valid messages recently. Called periodically by `Timer1` (a hardware
       interrupt). */
    static void maybe_disable(void);

public:
    /* Required constructor. message::Parameters are a one-byte device ID, the number of
       parameters, and the array of parameters. */
    SmartDeviceLoop(message::device_id_t, SmartDevice *);
    /* A drop-in replacement for Arduino's required `setup` function. */
    void setup(void);
    /* A drop-in replacement for Arduino's required `loop` function. */
    void loop(void);
};

#endif
