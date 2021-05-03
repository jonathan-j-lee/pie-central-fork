#ifdef ARDUINO
    #include <string.h>
#else
    #include <cstring>
#endif
#include "cobs.h"
#include "message.hpp"

using namespace message;

const param_map_t Message::NO_PARAMETERS = 0;
const interval_t Message::NO_SUBSCRIPTION = 0;
const char Message::DELIMETER = '\0';

#define append_check(src, size)                             \
    if (!this->append((src), (size))) {                     \
        return false;                                       \
    }                                                       \

#define read_check(offset, dst, size)                       \
    if (!(dst) || !this->read((offset), (dst), (size))) {   \
        return false;                                       \
    }                                                       \
    (offset) += (size)                                      \

#define type_check(type)                                    \
    if (this->get_type() != (type)) {                       \
        return false;                                       \
    }                                                       \

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

Message::Message(void): Message::Message(MessageType::PING) {
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

ErrorCode Message::encode(byte *dst, size_t capacity, size_t *out_len) {
    cobs_encode_result result = cobs_encode(dst, capacity, this->buf, this->get_buffer_length());
    switch (result.status) {
    case COBS_ENCODE_OK:
        *out_len = result.out_len;
        return ErrorCode::OK;
    case COBS_ENCODE_OUT_BUFFER_OVERFLOW:
        return ErrorCode::BUFFER_OVERFLOW;
    default:
        return ErrorCode::GENERIC_ERROR;
    }
}

ErrorCode Message::decode(const byte *src, size_t size) {
    cobs_decode_result result = cobs_decode(this->buf, MESSAGE_MAX_SIZE, src, size);
    switch (result.status) {
    case COBS_DECODE_OK:
        if (result.out_len < MESSAGE_MIN_SIZE) {
            return ErrorCode::UNEXPECTED_DELIMETER;
        } else if (!this->verify_checksum()) {
            return ErrorCode::BAD_CHECKSUM;
        } else {
            return ErrorCode::OK;
        }
    case COBS_DECODE_OUT_BUFFER_OVERFLOW:
        return ErrorCode::BUFFER_OVERFLOW;
    case COBS_DECODE_INPUT_TOO_SHORT:
        return ErrorCode::UNEXPECTED_DELIMETER;
    default:
        return ErrorCode::GENERIC_ERROR;
    }
}

bool Message::make_ping(void) {
    this->set_payload_length(0);
    return this->finish_message(MessageType::PING);
}

bool Message::make_sub_req(param_map_t params, interval_t interval) {
    this->set_payload_length(0);
    append_check(&params, sizeof(params));
    append_check(&interval, sizeof(interval));
    return this->finish_message(MessageType::SUB_REQ);
}

bool Message::make_sub_res(param_map_t params, interval_t interval, DeviceUID *uid) {
    this->set_payload_length(0);
    append_check(&params, sizeof(params));
    append_check(&interval, sizeof(interval));
    append_check(&uid->device_id, sizeof(uid->device_id));
    append_check(&uid->year, sizeof(uid->year));
    append_check(&uid->random, sizeof(uid->random));
    return this->finish_message(MessageType::SUB_RES);
}

bool Message::make_dev_read(param_map_t params) {
    this->set_payload_length(0);
    append_check(&params, sizeof(params));
    return this->finish_message(MessageType::DEV_READ);
}

bool Message::make_dev_write(param_map_t present, Parameter *params) {
    this->set_payload_length(0);
    return this->append_params(present, params) && this->finish_message(MessageType::DEV_WRITE);
}

bool Message::make_dev_data(param_map_t present, Parameter *params) {
    this->set_payload_length(0);
    return this->append_params(present, params) && this->finish_message(MessageType::DEV_DATA);
}

bool Message::make_dev_disable(void) {
    this->set_payload_length(0);
    return this->finish_message(MessageType::DEV_DISABLE);
}

bool Message::make_hb_req(heartbeat_id_t hb_id) {
    this->set_payload_length(0);
    append_check(&hb_id, sizeof(hb_id));
    return this->finish_message(MessageType::HB_REQ);
}

bool Message::make_hb_res(heartbeat_id_t hb_id) {
    this->set_payload_length(0);
    append_check(&hb_id, sizeof(hb_id));
    return this->finish_message(MessageType::HB_RES);
}

bool Message::make_error(ErrorCode error) {
    this->set_payload_length(0);
    byte err = (byte) error;
    append_check(&err, sizeof(err));
    return this->finish_message(MessageType::ERROR);
}

bool Message::read_sub_req(param_map_t *params, interval_t *interval) {
    type_check(MessageType::SUB_REQ);
    size_t offset = 0;
    read_check(offset, params, sizeof(*params));
    read_check(offset, interval, sizeof(*interval));
    return offset == this->get_payload_length();
}

bool Message::read_sub_res(param_map_t *params, interval_t *interval, DeviceUID *uid) {
    type_check(MessageType::SUB_RES);
    size_t offset = 0;
    read_check(offset, params, sizeof(*params));
    read_check(offset, interval, sizeof(*interval));
    read_check(offset, &uid->device_id, sizeof(uid->device_id));
    read_check(offset, &uid->year, sizeof(uid->year));
    read_check(offset, &uid->random, sizeof(uid->random));
    return offset == this->get_payload_length();
}

bool Message::read_dev_read(param_map_t *present) {
    type_check(MessageType::DEV_READ);
    size_t offset = 0;
    read_check(offset, present, sizeof(*present));
    return offset == this->get_payload_length();
}

bool Message::read_params(param_map_t *present, Parameter *params) {
    size_t offset = 0;
    read_check(offset, present, sizeof(*present));
    for (size_t i = 0; i < MAX_PARAMETERS; i++) {
        if (get_bit(*present, i)) {
            read_check(offset, params[i].base, params[i].size);
        }
    }
    return offset == this->get_payload_length();
}

bool Message::read_dev_write(param_map_t *present, Parameter *params) {
    type_check(MessageType::DEV_WRITE);
    return this->read_params(present, params);
}

bool Message::read_dev_data(param_map_t *present, Parameter *params) {
    type_check(MessageType::DEV_DATA);
    return this->read_params(present, params);
}

bool Message::read_hb_req(heartbeat_id_t *hb_id) {
    type_check(MessageType::HB_REQ);
    size_t offset = 0;
    read_check(offset, hb_id, sizeof(*hb_id));
    return offset == this->get_payload_length();
}

bool Message::read_hb_res(heartbeat_id_t *hb_id) {
    type_check(MessageType::HB_RES);
    size_t offset = 0;
    read_check(offset, hb_id, sizeof(*hb_id));
    return offset == this->get_payload_length();
}

bool Message::read_error(ErrorCode *error) {
    type_check(MessageType::ERROR);
    size_t offset = 0;
    byte err;
    read_check(offset, &err, sizeof(err));
    *error = ErrorCode(err);
    return offset == this->get_payload_length();
}
