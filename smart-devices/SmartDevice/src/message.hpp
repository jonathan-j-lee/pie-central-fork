#ifndef SDMLIB_MESSAGE_H_
#define SDMLIB_MESSAGE_H_

#include <stdint.h>
#include "cobs.h"

typedef uint8_t byte;
typedef uint16_t param_map_t;
typedef uint16_t interval_t;
typedef uint8_t heartbeat_id_t;
typedef uint16_t device_id_t;

/* Get the maximum value of an unsigned integral type of the given width in bytes. */
#define max_value_unsigned(bytes) ((1L << 8*(bytes)) - 1)

/* Bitmap operations. Works with integral types of any width. */
#define get_bit(x, i) (((x) >> (i)) & 0b1)
#define set_bit(x, i) ((x) = (x) | (1 << (i)))
#define clear_bit(x, i) ((x) = (x) ^ ((x) & (1 << (i))))

#define MESSAGE_DELIMETER '\0'
#define MAX_PARAMETERS    (8*sizeof(param_map_t))

/* Sizes (in bytes) of different message fields. */
#define MESSAGE_TYPE_SIZE sizeof(uint8_t)
#define PAYLOAD_LEN_SIZE  sizeof(uint8_t)
#define PAYLOAD_MAX_SIZE  max_value_unsigned(PAYLOAD_LEN_SIZE)
#define CHECKSUM_SIZE     sizeof(uint8_t)

#define MESSAGE_MIN_SIZE  (MESSAGE_TYPE_SIZE + PAYLOAD_LEN_SIZE + CHECKSUM_SIZE)
#define MESSAGE_MAX_SIZE  (MESSAGE_MIN_SIZE + PAYLOAD_MAX_SIZE)
/* COBS-encoding an n-byte message adds an overhead of ceil(n/254) bytes, at most. */
#define ENCODING_MAX_SIZE COBS_ENCODE_DST_BUF_LEN_MAX(MESSAGE_MAX_SIZE)

#define NO_PARAMETERS     ((param_map_t) 0)
#define NO_SUBSCRIPTION   ((interval_t) 0)

#define PARAMETER(x) (Parameter { &(x), sizeof(x) })

/* Must fit into one byte. */
enum MessageType {
    PING        = 0x10,
    SUB_REQ     = 0x11,
    SUB_RES     = 0x12,
    DEV_READ    = 0x13,
    DEV_WRITE   = 0x14,
    DEV_DATA    = 0x15,
    DEV_DISABLE = 0x16,
    HB_REQ      = 0x17,
    HB_RES      = 0x18,
    ERROR       = 0xFF,
};

/* Must fit into one byte. */
enum ErrorCode {
    BACKOFF              = 0xFA,  /* Receiver is overwhelmed. Sender should transmit less data. */
    INVALID_TYPE         = 0xFB,  /* Receiver received a message type it does not handle. */
    BUFFER_OVERFLOW      = 0xFC,  /* Message was too large for receiver to COBS encode/decode. */
    UNEXPECTED_DELIMETER = 0xFD,  /* Message was incomplete or unable to be COBS-decoded by receiver. */
    BAD_CHECKSUM         = 0xFE,  /* Checksum computed by receiver did not match sender's claim. */
    GENERIC_ERROR        = 0xFF,  /* General error. */
};

/* Hardcoded COBS-encoded error packet used as a fallback when encoding fails. */
#define GENERIC_ERROR_MESSAGE "\x05\xff\x01\xff\x01"

class DeviceUID {
public:
    device_id_t device_id;
    uint8_t year;
    uint64_t random;
};

/* Helper structure for referencing to variable-size parameters. */
class Parameter {
public:
    void *base;
    size_t size;
};

/**
 *  A Smart Device message consists of the following fields:
 *    - Message type (1 byte)
 *    - Payload length (1 byte)
 *    - Payload (variable)
 *    - Checksum (1 byte)
 *
 *  The checksum is simply an XOR of all preceeding bytes.
 *
 *  To be transmitted over a bytestream, messages are COBS-encoded and separated
 *  by null byte delimeters.
 *
 *  Messages are mutable to support embedded systems like Arduino where memory
 *  is scarce. Allocating a new immutable object for every operation or leaking
 *  dynamically allocated memory can be fatal.
 */
class Message {
    /* The only member is a buffer. Using separate message fields would require
       unnecessary copying before encoding with COBS. */
    byte buf[MESSAGE_MAX_SIZE];

    /* Compute the message checksum. Does not set the checksum field. */
    byte compute_checksum(void);
    /* Get the length of the entire message. */
    size_t get_buffer_length(void);
    /* Set the payload length. If the size would exceed the maximum allowed
       payload length, return false and leave the payload length unchanged. */
    bool set_payload_length(size_t);

    /* Append a number of bytes to the payload. Return the number of bytes
       appended. If there is not enough space, return zero and leave the
       message unchanged. */
    size_t append(const void *, size_t);
    /* Read bytes from the payload into the given address. Return the number of
       bytes read. If the bytes do not exist, return zero. */
    size_t read(size_t, void *, size_t);

    bool append_params(param_map_t, Parameter *);
    bool finish_message(MessageType);

public:
    Message(MessageType);
    MessageType get_type(void);
    size_t get_payload_length(void);
    /* Return true iff the checksum field matches the computed checksum. */
    bool verify_checksum(void);

    /* Encode this message's buffer with COBS. The null byte delimeter is not
       appended to the provided buffer. */
    cobs_encode_result to_cobs(byte *, size_t);
    /* Decode a COBS-encoded buffer as a message. No null bytes should be
       included in the buffer. */
    cobs_decode_result from_cobs(byte *, size_t);

    /* Methods for building different types of messages. Return true iff the
       operation was successful. May fail if the caller attempts to append too
       much data to the payload. */
    bool make_ping(void);
    bool make_sub_req(param_map_t, interval_t);
    bool make_sub_res(param_map_t, interval_t, DeviceUID *);
    bool make_dev_read(param_map_t);
    bool make_dev_write(param_map_t, Parameter *);
    bool make_dev_data(param_map_t, Parameter *);
    bool make_dev_disable(void);
    bool make_hb_req(heartbeat_id_t);
    bool make_hb_res(heartbeat_id_t);
    bool make_error(ErrorCode);

    /* Methods for reading payload fields. Return true iff the operation was
       successful. A read may fail because the payload size does not match the
       expected size. */
    bool read_sub_req(param_map_t *, interval_t *);
    bool read_sub_res(param_map_t *, interval_t *, DeviceUID *);
    bool read_dev_read(param_map_t *);
    bool read_dev_write(param_map_t *, Parameter *);
    bool read_dev_data(param_map_t *, Parameter *);
    bool read_hb_req(heartbeat_id_t *);
    bool read_hb_res(heartbeat_id_t *);
    bool read_error(ErrorCode *);
};

#endif
