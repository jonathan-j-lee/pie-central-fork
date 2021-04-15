#ifdef ARDUINO
    #include <string.h>
#else
    #include <cstring>
#endif
#include "cobs.h"
#include "message.hpp"

#define append_check(src, size)                             \
    if (!this->append((src), (size))) {                     \
        return false;                                       \
    }                                                       \

#define read_check(offset, dst, size)                       \
    if ((dst) && !this->read((offset), (dst), (size))) {    \
        return false;                                       \
    }                                                       \
    (offset) += (size)                                      \

byte Message::compute_checksum(void) {
    byte checksum = 0;
    for (size_t i = 0; i < this->get_buffer_length() - CHECKSUM_SIZE; i++) {
        checksum ^= this->buf[i];
    }
    return checksum;
}

size_t Message::get_buffer_length(void) {
    return MESSAGE_MIN_SIZE + this->get_payload_length();
}

bool Message::set_payload_length(size_t payload_length) {
    if (payload_length > PAYLOAD_MAX_SIZE) {
        return false;
    }
    this->buf[MESSAGE_TYPE_SIZE] = (byte) payload_length;
    return true;
}

size_t Message::append(const void *src, size_t size) {
    size_t payload_length = this->get_payload_length();
    if (!this->set_payload_length(payload_length + size)) {
        return 0;
    }
    size_t offset = MESSAGE_TYPE_SIZE + PAYLOAD_LEN_SIZE + payload_length;
    memcpy(this->buf + offset, src, size);
    return size;
}

size_t Message::read(size_t offset, void *dst, size_t size) {
    if (offset + size > this->get_payload_length()) {
        return 0;
    }
    offset += MESSAGE_TYPE_SIZE + PAYLOAD_LEN_SIZE;
    memcpy(dst, this->buf + offset, size);
    return size;
}

bool Message::append_params(param_map_t present, Parameter *params) {
    append_check(&present, sizeof(present));
    for (size_t i = 0; i < MAX_PARAMETERS; i++) {
        if (get_bit(present, i)) {
            void *src = params[i].base;
            if (src) {
                append_check(src, params[i].size);
            }
        }
    }
    return true;
}

bool Message::finish_message(MessageType type) {
    this->buf[0] = (byte) type;
    this->buf[this->get_buffer_length() - CHECKSUM_SIZE] = this->compute_checksum();
    return true;
}

Message::Message(MessageType type) {
    this->set_payload_length(0);
    this->finish_message(type);
}

MessageType Message::get_type(void) {
    return MessageType(this->buf[0]);
}

size_t Message::get_payload_length(void) {
    return (size_t) this->buf[MESSAGE_TYPE_SIZE];
}

bool Message::verify_checksum(void) {
    return this->buf[this->get_buffer_length() - CHECKSUM_SIZE] == compute_checksum();
}

cobs_encode_result Message::to_cobs(byte *dst, size_t capacity) {
    return cobs_encode(dst, capacity, this->buf, this->get_buffer_length());
}

cobs_decode_result Message::from_cobs(byte *src, size_t size) {
    return cobs_decode(this->buf, MESSAGE_MAX_SIZE, src, size);
}

bool Message::make_ping(void) {
    this->set_payload_length(0);
    return this->finish_message(PING);
}

bool Message::make_sub_req(param_map_t params, interval_t interval) {
    this->set_payload_length(0);
    append_check(&params, sizeof(params));
    append_check(&interval, sizeof(interval));
    return this->finish_message(SUB_REQ);
}

bool Message::make_sub_res(param_map_t params, interval_t interval, DeviceUID *uid) {
    this->set_payload_length(0);
    append_check(&params, sizeof(params));
    append_check(&interval, sizeof(interval));
    append_check(&uid->device_id, sizeof(uid->device_id));
    append_check(&uid->year, sizeof(uid->year));
    append_check(&uid->random, sizeof(uid->random));
    return this->finish_message(SUB_RES);
}

bool Message::make_dev_read(param_map_t params) {
    this->set_payload_length(0);
    append_check(&params, sizeof(params));
    return this->finish_message(DEV_READ);
}

bool Message::make_dev_write(param_map_t present, Parameter *params) {
    this->set_payload_length(0);
    return this->append_params(present, params) && this->finish_message(DEV_WRITE);
}

bool Message::make_dev_data(param_map_t present, Parameter *params) {
    this->set_payload_length(0);
    return this->append_params(present, params) && this->finish_message(DEV_DATA);
}

bool Message::make_dev_disable(void) {
    this->set_payload_length(0);
    return this->finish_message(DEV_DISABLE);
}

bool Message::make_hb_req(heartbeat_id_t hb_id) {
    this->set_payload_length(0);
    append_check(&hb_id, sizeof(hb_id));
    return this->finish_message(HB_REQ);
}

bool Message::make_hb_res(heartbeat_id_t hb_id) {
    this->set_payload_length(0);
    append_check(&hb_id, sizeof(hb_id));
    return this->finish_message(HB_RES);
}

bool Message::make_error(ErrorCode error) {
    this->set_payload_length(0);
    byte err = (byte) error;
    append_check(&err, sizeof(err));
    return this->finish_message(ERROR);
}

bool Message::read_sub_req(param_map_t *params, interval_t *interval) {
    size_t offset = 0;
    read_check(offset, params, sizeof(*params));
    read_check(offset, interval, sizeof(*interval));
    return offset == this->get_payload_length();
}

bool Message::read_sub_res(param_map_t *params, interval_t *interval, DeviceUID *uid) {
    size_t offset = 0;
    read_check(offset, params, sizeof(*params));
    read_check(offset, interval, sizeof(*interval));
    read_check(offset, &uid->device_id, sizeof(uid->device_id));
    read_check(offset, &uid->year, sizeof(uid->year));
    read_check(offset, &uid->random, sizeof(uid->random));
    return offset == this->get_payload_length();
}

bool Message::read_dev_read(param_map_t *present) {
    size_t offset = 0;
    read_check(offset, present, sizeof(*present));
    return offset == this->get_payload_length();
}

bool Message::read_dev_write(param_map_t *present, Parameter *params) {
    size_t offset = 0;
    read_check(offset, present, sizeof(*present));
    for (size_t i = 0; i < MAX_PARAMETERS; i++) {
        if (get_bit(*present, i)) {
            read_check(offset, params[i].base, params[i].size);
        }
    }
    return offset == this->get_payload_length();
}

bool Message::read_dev_data(param_map_t *present, Parameter *params) {
    return this->read_dev_write(present, params);
}

bool Message::read_hb_req(heartbeat_id_t *hb_id) {
    size_t offset = 0;
    read_check(offset, hb_id, sizeof(*hb_id));
    return offset == this->get_payload_length();
}

bool Message::read_hb_res(heartbeat_id_t *hb_id) {
    return this->read_hb_req(hb_id);
}

bool Message::read_error(ErrorCode *error) {
    size_t offset = 0;
    byte err;
    read_check(offset, &err, sizeof(err));
    *error = ErrorCode(err);
    return offset == this->get_payload_length();
}
