#include <stdint.h>
#include <Arduino.h>
#include <TimerOne.h>
#include "cobs.h"
#include "message.hpp"
#include "SmartDevice.hpp"

using namespace message;

const interval_t Task::MAX_INTERVAL = 1000;
const uint64_t SmartDeviceLoop::BAUD_RATE = 115200;
const interval_t SmartDeviceLoop::MIN_TIMEOUT = 10;
const interval_t SmartDeviceLoop::MIN_SERVE_INTERVAL = 40;
const interval_t SmartDeviceLoop::MIN_SUB_INTERVAL = 40;
const interval_t SmartDeviceLoop::MAX_SUB_INTERVAL = 250;
const interval_t SmartDeviceLoop::DISABLE_INTERVAL = 1000;
const interval_t SmartDeviceLoop::HB_INTERVAL = 1000;

/* If any operation fails, all subsequent operations will not run because of
   the short-circuit. */
#define check_ok(ok, status) ((ok) = (ok) && (status))

/* Need these global variables because the Timer1 callback cannot accept arguments. */
SmartDevice *sd_isr = nullptr;
volatile bool active = true;

bool SmartDeviceLoop::recv(unsigned long timeout) {
    if (timeout < SmartDeviceLoop::MIN_TIMEOUT) {
        delay(timeout);
        return false;
    }
    Serial.setTimeout(timeout);
    size_t bytes_read = Serial.readBytesUntil(
        Message::DELIMETER, this->serial_buf, sizeof(this->serial_buf));
    if (bytes_read > 0) {
        ErrorCode error = this->msg.decode(this->serial_buf, bytes_read);
        if (error == ErrorCode::OK) {
            active = true;
            return true;
        }
        if (this->msg.make_error(error)) {
            this->send();
        }
    }
    return false;
}

bool SmartDeviceLoop::send(void) {
    size_t out_len;
    if (this->msg.encode(this->serial_buf, sizeof(this->serial_buf), &out_len) == ErrorCode::OK) {
        Serial.write(this->serial_buf, out_len);
        Serial.write(Message::DELIMETER);
        return true;
    }
    Serial.write(GENERIC_ERROR_MESSAGE);
    Serial.write(Message::DELIMETER);
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
        update(Message::NO_SUBSCRIPTION), hb(SmartDeviceLoop::HB_INTERVAL) {
    this->uid = { device_id, YEAR, RANDOM };
    this->sd = sd;
    memset(this->params, 0, sizeof(this->params));
    this->sd->get_parameters(this->params);
    this->subscription = Message::NO_PARAMETERS;
}

bool SmartDeviceLoop::is_subscribed(void) {
    return this->update.get_interval() != Message::NO_SUBSCRIPTION;
}

void SmartDeviceLoop::set_subscription(param_map_t subscription, interval_t interval) {
    this->subscription = this->sd->read(subscription);
    if (interval != Message::NO_SUBSCRIPTION) {
        interval = constrain(interval, SmartDeviceLoop::MIN_SUB_INTERVAL, SmartDeviceLoop::MAX_SUB_INTERVAL);
    }
    this->update.set_interval(interval);
}

bool SmartDeviceLoop::send_data(param_map_t present) {
    present = this->sd->read(present);
    if (this->msg.make_dev_data(present, this->params)) {
        return this->send();
    }
    /* The device parameters were too large to fit into one message. Split them
       across multiple messages. */
    bool success = true;
    for (size_t i = 0; i < MAX_PARAMETERS; i++) {
        if (get_bit(present, i)) {
            param_map_t params = Message::NO_PARAMETERS;
            set_bit(params, i);
            check_ok(success, this->msg.make_dev_data(present, this->params) && this->send());
        }
    }
    return success;
}

param_map_t SmartDeviceLoop::mask_subscription(param_map_t present) {
    if (this->is_subscribed()) {
        present &= Message::ALL_PARAMETERS ^ present;
    }
    return present;
}

void SmartDeviceLoop::serve_once(unsigned long timeout) {
    if (!this->recv(timeout)) {
        return;
    }

    heartbeat_id_t hb_id;
    param_map_t present;
    interval_t interval;
    bool msg_ok = true;

    switch (this->msg.get_type()) {
    case MessageType::SUB_REQ:
        check_ok(msg_ok, this->msg.read_sub_req(&present, &interval));
        if (msg_ok) {
            this->set_subscription(present, interval);
        }
    case MessageType::PING:
        check_ok(msg_ok, this->msg.make_sub_res(
            this->subscription, this->update.get_interval(), &this->uid));
        break;
    case MessageType::DEV_WRITE:
        check_ok(msg_ok, this->msg.read_dev_write(&present, this->params));
        check_ok(msg_ok, this->send_data(this->mask_subscription(this->sd->write(present))));
        if (msg_ok) {
            return;
        } else {
            break;
        }
    case MessageType::DEV_READ:
        check_ok(msg_ok, this->msg.read_dev_read(&present));
        check_ok(msg_ok, this->send_data(this->mask_subscription(present)));
        if (msg_ok) {
            return;
        } else {
            break;
        }
    case MessageType::DEV_DISABLE:
        return this->sd->disable();
    case MessageType::HB_REQ:
        check_ok(msg_ok, this->msg.read_hb_req(&hb_id));
        check_ok(msg_ok, this->msg.make_hb_res(hb_id));
        break;
    case MessageType::HB_RES:
        check_ok(msg_ok, this->msg.read_hb_res(&hb_id));
        /* TODO: At the moment, this Smart Device implementation does not send
           heartbeat requests to the SBC, so this case remains unused. */
        return;
    default:
        check_ok(msg_ok, this->msg.make_error(ErrorCode::INVALID_TYPE));
    }

    /* Send a single reply packet, which is possibly a generic error. `DEV_READ`
       and `DEV_WRITE` use the special `send_data` method instead.

       `DEV_DISABLE` does not send a reply at all, so the `DEV_DISABLE` case
       returns immediately like `DEV_READ` and `DEV_WRITE` do normally. */
    if (msg_ok) {
        this->send();
    }
}

void SmartDeviceLoop::maybe_disable(void) {
    if (!active && sd_isr) {
        sd_isr->disable();
    }
    active = false;
}

void SmartDeviceLoop::setup(void) {
    Serial.begin(SmartDeviceLoop::BAUD_RATE);
    while (!Serial);
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
        if (this->msg.make_hb_req(hb_id)) {
            this->send();
        }
    }
    if (this->update.clear_ready()) {
        this->send_data(this->subscription);
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
    return Message::NO_PARAMETERS;  /* No writeable parameters. */
}

void SmartDevice::disable(void) {
    /* No writeable parameters. */
}
