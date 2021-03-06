from libc.stddef cimport size_t
from libc.stdint cimport uint8_t, uint16_t, uint64_t


cdef extern from "message.cpp" nogil:
    pass

cdef extern from "message.hpp":
    cpdef enum:
        MAX_PARAMETERS, ENCODING_MAX_SIZE, MESSAGE_MAX_SIZE

cdef extern from "message.hpp" namespace "message::Message":
    cpdef enum:
        NO_PARAMETERS, ALL_PARAMETERS, NO_SUBSCRIPTION, DELIMETER

cdef extern from "message.hpp" namespace "message" nogil:
    ctypedef uint8_t bool
    ctypedef uint8_t byte
    ctypedef uint8_t heartbeat_id_t
    ctypedef uint16_t param_map_t
    ctypedef uint16_t interval_t
    ctypedef uint16_t device_id_t

    cpdef enum class MessageType:
        """The Smart Device message's type identifies what kind of payload it contains.

        Attributes:
            PING: Ping request from Runtime to the Smart Device.
            SUB_REQ: Subscription request.
            SUB_RES: Subscription response.
            DEV_READ: Device read.
            DEV_WRITE: Device write.
            DEV_DATA: Device data.
            DEV_DISABLE: Device disable.
            HB_REQ: Heartbeat request.
            HB_RES: Heartbeat response.
            ERROR: Error.
        """
        PING,
        SUB_REQ,
        SUB_RES,
        DEV_READ,
        DEV_WRITE,
        DEV_DATA,
        DEV_DISABLE,
        HB_REQ,
        HB_RES,
        ERROR

    cpdef enum class ErrorCode:
        """Error codes produced by the Smart Device or during message encoding/decoding.

        Attributes:
            OK: No error occurred.
            BACKOFF: The receiver is overwhelmed. The peer should transmit less data.
            INVALID_TYPE: The receiver received a message type it does not handle.
            BUFFER_OVERFLOW: Message was too large to encode/decode.
            UNEXPECTED_DELIMETER: Message was incomplete or otherwise unable to be
                decoded.
            BAD_CHECKSUM: Checksum computed by the receiver did not match the sender's
                claim.
            GENERIC_ERROR: General error.
        """
        OK,
        BACKOFF,
        INVALID_TYPE,
        BUFFER_OVERFLOW,
        UNEXPECTED_DELIMETER,
        BAD_CHECKSUM,
        GENERIC_ERROR

    cdef cppclass _DeviceUID "message::DeviceUID":
        device_id_t device_id
        uint8_t year
        uint64_t random

    cdef cppclass _Parameter "message::Parameter":
        void *base
        size_t size

    cdef cppclass _Message "message::Message":
        _Message()
        MessageType get_type()
        size_t get_payload_length()
        bool verify_checksum()

        ErrorCode decode(byte *, size_t)
        ErrorCode encode(byte *, size_t, size_t *)

        bool make_ping()
        bool make_sub_req(param_map_t, interval_t)
        bool make_sub_res(param_map_t, interval_t, _DeviceUID *)
        bool make_dev_read(param_map_t)
        bool make_dev_write(param_map_t, _Parameter *)
        bool make_dev_data(param_map_t, _Parameter *)
        bool make_dev_disable()
        bool make_hb_req(heartbeat_id_t)
        bool make_hb_res(heartbeat_id_t)
        bool make_error(ErrorCode)

        bool read_sub_req(param_map_t *, interval_t *)
        bool read_sub_res(param_map_t *, interval_t *, _DeviceUID *)
        bool read_dev_read(param_map_t *)
        bool read_dev_write(param_map_t *, _Parameter *)
        bool read_dev_data(param_map_t *, _Parameter *)
        bool read_hb_req(heartbeat_id_t *)
        bool read_hb_res(heartbeat_id_t *)
        bool read_error(ErrorCode *)
