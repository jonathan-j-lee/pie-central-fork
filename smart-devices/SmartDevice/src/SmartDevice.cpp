#include <stdint.h>
#include <TimerOne.h>
#include "cobs.h"
#include "message.h"
#include "SmartDevice.h"

/* If any operation fails, all subsequent operations will not run because of
   the short-circuit. */
#define check_ok(ok, status) ((ok) = (ok) && (status))

volatile bool active = true;

void SerialHandler::setup(void) {
    Serial.begin(SerialHandler::BAUD_RATE);
    while (!Serial);
}

bool SerialHandler::recv(Message *msg) {
    size_t bytes_read = Serial.readBytesUntil(
        MESSAGE_DELIMETER, this->serial_buf, sizeof(this->serial_buf));
    if (bytes_read == 0) {
        return false;
    }
    this->decode_result = msg->from_cobs(this->serial_buf, bytes_read);
    ErrorCode error = GENERIC_ERROR;
    switch (this->decode_result.status) {
    case COBS_DECODE_OK:
        if (this->decode_result.out_len < MESSAGE_MIN_SIZE) {
            error = UNEXPECTED_DELIMETER;
        } else if (!msg->verify_checksum()) {
            error = BAD_CHECKSUM;
        } else {
            active = true;
            return true;
        }
        break;
    case COBS_DECODE_OUT_BUFFER_OVERFLOW:
        error = BUFFER_OVERFLOW;
        break;
    case COBS_DECODE_INPUT_TOO_SHORT:
        error = UNEXPECTED_DELIMETER;
        break;
    }
    this->send(msg->make_error(error) ? msg : NULL);
    return false;
}

bool SerialHandler::send(Message *msg) {
    if (msg) {
        this->encode_result = msg->to_cobs(this->serial_buf, sizeof(serial_buf));
        if (this->encode_result.status == COBS_ENCODE_OK) {
            Serial.write(this->serial_buf, this->encode_result.out_len);
            Serial.write(MESSAGE_DELIMETER);
            return true;
        }
    }
    Serial.write(GENERIC_ERROR_MESSAGE);
    Serial.write(MESSAGE_DELIMETER);
    return false;
}

Task::Task(interval_t interval) {
    this->ready = false;
    this->last = millis();
    this->interval = interval;
}

interval_t Task::get_interval(void) {
    return this->interval;
}

void Task::set_interval(interval_t interval) {
    this->interval = interval;
}

unsigned long Task::next(void) {
  return this->last + this->interval;
}

bool Task::clear_ready(void) {
    bool prev_ready = this->ready;
    this->ready = false;
    return prev_ready;
}

static unsigned long Task::select(size_t ntasks, Task *tasks[]) {
    unsigned long now = millis();
    unsigned long stop = now + Task::MAX_INTERVAL;
    for (size_t i = 0; i < ntasks; i++) {
        Task *task = tasks[i];
        if (now >= task->next()) {
            task->last = now;
            task->ready = true;
        }
        stop = min(stop, task->next());
    }
    return stop;
}

SmartDevice::SmartDevice(device_id_t device_id, size_t nparams, Parameter *params):
        uid(device_id, YEAR, RANDOM), msg(PING), update(NO_SUBSCRIPTION), hb(SmartDevice::HB_INTERVAL) {
    memset(this->params, 0, sizeof(this->params));
    for (size_t i = 0; i < nparams; i++) {
        this->params[i] = params[i];
    }
    this->subscription = NO_PARAMETERS;
}

bool SmartDevice::is_subscribed(void) {
    return this->update.get_interval() != NO_SUBSCRIPTION;
}

void SmartDevice::set_subscription(param_map_t subscription, interval_t interval) {
    this->subscription = device_read(subscription);
    if (interval != NO_SUBSCRIPTION) {
        interval = constrain(interval, SmartDevice::MIN_SUB_INTERVAL, SmartDevice::MAX_SUB_INTERVAL);
    }
    this->update.set_interval(interval);
}

bool SmartDevice::send_data(param_map_t present) {
    present = device_read(present);
    if (this->msg.make_dev_data(present, this->params)) {
        return this->serial.send(&this->msg);
    }
    /* The device parameters were too large to fit into one message. Split them
       across multiple messages. */
    bool success = true;
    for (size_t i = 0; i < MAX_PARAMETERS; i++) {
        if (get_bit(present, i)) {
            param_map_t params = NO_PARAMETERS;
            set_bit(params, i);
            check_ok(success, this->msg.make_dev_data(present, this->params)
                && this->serial.send(&this->msg));
        }
    }
    return success;
}

void SmartDevice::serve_once(unsigned long timeout) {
    if (timeout < SmartDevice::MIN_TIMEOUT) {
        return delay(timeout);
    }
    Serial.setTimeout(timeout);
    if (!this->serial.recv(&this->msg)) {
        return;
    }

    heartbeat_id_t hb_id;
    param_map_t present;
    interval_t interval;
    bool msg_ok = true;

    switch (this->msg.get_type()) {
    case SUB_REQ:
        check_ok(msg_ok, this->msg.read_sub_req(&present, &interval));
        if (msg_ok) {
            this->set_subscription(present, interval);
        }
    case PING:
        check_ok(msg_ok, this->msg.make_sub_res(
            this->subscription, this->update.get_interval(), &this->uid));
        break;
    case DEV_WRITE:
        check_ok(msg_ok, this->msg.read_dev_write(&present, this->params));
        check_ok(msg_ok, this->send_data(device_write(present)));
        if (msg_ok) {
            return;
        } else {
            break;
        }
    case DEV_READ:
        check_ok(msg_ok, this->msg.read_dev_read(&present));
        check_ok(msg_ok, this->send_data(present));
        if (msg_ok) {
            return;
        } else {
            break;
        }
    case DEV_DISABLE:
        return device_disable();
    case HB_REQ:
        check_ok(msg_ok, this->msg.read_hb_req(&hb_id));
        check_ok(msg_ok, this->msg.make_hb_res(hb_id));
        break;
    case HB_RES:
        check_ok(msg_ok, this->msg.read_hb_res(&hb_id));
        /* TODO: At the moment, this Smart Device implementation does not send
           heartbeat requests to the SBC, so this case remains unused. */
        break;
    default:
        check_ok(msg_ok, this->msg.make_error(ILLEGAL_TYPE));
    }

    /* Send a single reply packet, which is possibly a generic error. `DEV_READ`
       and `DEV_WRITE` use the special `send_data` method instead.

       `DEV_DISABLE` does not send a reply at all, so the `DEV_DISABLE` case
       returns immediately like `DEV_READ` and `DEV_WRITE` do normally. */
    this->serial.send(msg_ok ? &this->msg : NULL);
}

static void SmartDevice::maybe_disable(void) {
    if (!active) {
        device_disable();
    }
    active = false;
}

void SmartDevice::setup(void) {
    this->serial.setup();
    device_disable();
    Timer1.initialize(ms_to_us(SmartDevice::DISABLE_INTERVAL));
    Timer1.attachInterrupt(SmartDevice::maybe_disable);
    active = true;
}

void SmartDevice::loop(void) {
    Task *tasks[] = { &this->hb, &this->update };
    unsigned long stop = Task::select(this->is_subscribed() ? 2 : 1, tasks);
    if (this->hb.clear_ready()) {
        heartbeat_id_t hb_id = 0xff;
        this->serial.send(this->msg.make_hb_req(hb_id) ? &this->msg : NULL);
    }
    if (this->update.clear_ready()) {
        if (!this->send_data(this->subscription)) {
            this->serial.send(NULL);
        }
    }
    unsigned long now;
    while ((now = millis()) < stop) {
        this->serve_once(stop - now);
    }
}

/* Example device usage. */

#define NUM_SWITCHES 3

bool switches[NUM_SWITCHES];
const Parameter PARAMS[] = {
    { &switches[0], sizeof(switches[0]) },
    { &switches[1], sizeof(switches[1]) },
    { &switches[2], sizeof(switches[2]) },
};
const SmartDevice device(0x00, NUM_SWITCHES, PARAMS);

param_map_t device_read(param_map_t params) {
    param_map_t params_read = NO_PARAMETERS;
    for (size_t i = 0; i < NUM_SWITCHES; i++) {
        if (get_bit(params, i)) {
            set_bit(params_read, i);
        }
    }
    return params_read;
}

param_map_t device_write(param_map_t params) {
    return NO_PARAMETERS;  /* No writeable parameters. */
}

void device_disable(void) {
    /* No-op because no writeable parameters. */
}

void setup(void) {
    device.setup();
}

void loop(void) {
    device.loop();
}
