#include <stdint.h>
#include <Arduino.h>
#include <TimerOne.h>
#include "cobs.h"
#include "message.hpp"
#include "SmartDevice.hpp"

/* If any operation fails, all subsequent operations will not run because of
   the short-circuit. */
#define check_ok(ok, status) ((ok) = (ok) && (status))

/* Need these global variables because the Timer1 callback cannot accept arguments. */
SmartDevice *sd_isr = nullptr;
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
    ErrorCode error;
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
    default:
        error = GENERIC_ERROR;
    }
    this->send(msg->make_error(error) ? msg : nullptr);
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

unsigned long Task::select(size_t ntasks, Task **tasks) {
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

SmartDeviceLoop::SmartDeviceLoop(device_id_t device_id, SmartDevice *sd):
        msg(PING), update(NO_SUBSCRIPTION), hb(SmartDeviceLoop::HB_INTERVAL) {
    this->uid = { device_id, YEAR, RANDOM };
    this->sd = sd;
    memset(this->params, 0, sizeof(this->params));
    this->sd->get_parameters(this->params);
    this->subscription = NO_PARAMETERS;
}

bool SmartDeviceLoop::is_subscribed(void) {
    return this->update.get_interval() != NO_SUBSCRIPTION;
}

void SmartDeviceLoop::set_subscription(param_map_t subscription, interval_t interval) {
    this->subscription = this->sd->read(subscription);
    if (interval != NO_SUBSCRIPTION) {
        interval = constrain(interval, SmartDeviceLoop::MIN_SUB_INTERVAL, SmartDeviceLoop::MAX_SUB_INTERVAL);
    }
    this->update.set_interval(interval);
}

bool SmartDeviceLoop::send_data(param_map_t present) {
    present = this->sd->read(present);
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

void SmartDeviceLoop::serve_once(unsigned long timeout) {
    if (timeout < SmartDeviceLoop::MIN_TIMEOUT) {
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
        check_ok(msg_ok, this->send_data(this->sd->write(present)));
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
        return this->sd->disable();
    case HB_REQ:
        check_ok(msg_ok, this->msg.read_hb_req(&hb_id));
        check_ok(msg_ok, this->msg.make_hb_res(hb_id));
        break;
    case HB_RES:
        check_ok(msg_ok, this->msg.read_hb_res(&hb_id));
        /* TODO: At the moment, this Smart Device implementation does not send
           heartbeat requests to the SBC, so this case remains unused. */
        return;
    default:
        check_ok(msg_ok, this->msg.make_error(INVALID_TYPE));
    }

    /* Send a single reply packet, which is possibly a generic error. `DEV_READ`
       and `DEV_WRITE` use the special `send_data` method instead.

       `DEV_DISABLE` does not send a reply at all, so the `DEV_DISABLE` case
       returns immediately like `DEV_READ` and `DEV_WRITE` do normally. */
    this->serial.send(msg_ok ? &this->msg : nullptr);
}

void SmartDeviceLoop::maybe_disable(void) {
    if (!active && sd_isr) {
        sd_isr->disable();
    }
    active = false;
}

void SmartDeviceLoop::setup(void) {
    this->serial.setup();
    this->sd->setup();
    this->sd->disable();
    sd_isr = this->sd;
    active = true;
    Timer1.initialize(ms_to_us(SmartDeviceLoop::DISABLE_INTERVAL));
    Timer1.attachInterrupt(SmartDeviceLoop::maybe_disable);
}

void SmartDeviceLoop::loop(void) {
    Task *tasks[] = { &this->hb, &this->update };
    unsigned long stop = Task::select(this->is_subscribed() ? 2 : 1, tasks);
    if (this->hb.clear_ready()) {
        heartbeat_id_t hb_id = 0xff;  // FIXME
        this->serial.send(this->msg.make_hb_req(hb_id) ? &this->msg : nullptr);
    }
    if (this->update.clear_ready()) {
        if (!this->send_data(this->subscription)) {
            this->serial.send(nullptr);
        }
    }
    stop = max(stop, millis() + SmartDeviceLoop::MIN_SERVE_INTERVAL);
    unsigned long now;
    while ((now = millis()) < stop) {
        this->serve_once(stop - now);
    }
}

void SmartDevice::setup(void) {
    /* No hardware used, by default. */
}

param_map_t SmartDevice::write(param_map_t) {
    return NO_PARAMETERS;  /* No writeable parameters. */
}

void SmartDevice::disable(void) {
    /* No writeable parameters. */
}
