#define CATCH_CONFIG_MAIN
#include <catch2/catch.hpp>
#include <catch2/trompeloeil.hpp>
#include <Arduino.h>
#include <TimerOne.h>
#include "message.hpp"
#include "SmartDevice.hpp"
#include "test-device.hpp"

using namespace message;

#define MOCK_SERIAL_SEND(output, base)                                                  \
    memset((output), 0, sizeof(output));                                                \
    ALLOW_CALL(Serial, write(ANY(char)))                                                \
        .LR_SIDE_EFFECT(output[base++] = _1);                                           \
    ALLOW_CALL(Serial, write(ANY(std::string)))                                         \
        .LR_SIDE_EFFECT(strncpy((char *)(output + base), _1.c_str(), sizeof(output)))   \
        .LR_SIDE_EFFECT(base += _1.size());                                             \
    ALLOW_CALL(Serial, write(_, _))                                                     \
        .LR_SIDE_EFFECT(memcpy((void *)(output + base), _1, _2))                        \
        .LR_SIDE_EFFECT(base += _2);                                                    \

#define MOCK_SERIAL_RECV(s, delay)                      \
    ALLOW_CALL(Serial, readBytesUntil(_, _, _))         \
        .LR_SIDE_EFFECT(strncpy((char *) _2, (s), _3))  \
        .LR_SIDE_EFFECT(_millis += (delay))             \
        .LR_RETURN(strlen((s)))                         \

#define CHECK_COBS_DECODE(msg, s) \
    ((msg).decode((s), strlen((const char *)(s))) == ErrorCode::OK)

#define RUN_LOOP(sd_loop, base) \
    (base) = 0;                   \
    (sd_loop).loop();             \

#define GET_SECOND(output) ((output) + strlen((const char *) (output)) + 1)

#define REPEAT(n) for (size_t _i = 0; _i < (n); _i++)

const char *OVERFLOW_PACKET =
    "\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff"
    "\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff" /* 32 */
    "\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff"
    "\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff" /* 64 */
    "\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff"
    "\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff" /* 96 */
    "\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff"
    "\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff" /* 128 */
    "\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff"
    "\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff" /* 160 */
    "\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff"
    "\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff" /* 192 */
    "\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff"
    "\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff" /* 224 */
    "\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff"
    "\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\x06" /* 256 */
    "\xff\xff\xff\xff\xff";

using trompeloeil::_;
using trompeloeil::eq;
using trompeloeil::lt;

struct InvalidPacket {
    const char *buf;
    ErrorCode error;
};

TEST_CASE("task selection", "[smartdevice]") {
    _millis = 1000;
    Task a(600), b(1100), c(800);
    SECTION("multiple tasks") {
        Task *tasks[] = { &a, &b, &c };
        _millis = 1599;
        REQUIRE(Task::select(3, tasks) == 1600);
        REQUIRE_FALSE(a.clear_ready());
        REQUIRE_FALSE(b.clear_ready());
        REQUIRE_FALSE(c.clear_ready());
        _millis = 1600;
        REQUIRE(Task::select(3, tasks) == 1800);
        REQUIRE(a.clear_ready());
        REQUIRE_FALSE(b.clear_ready());
        REQUIRE_FALSE(c.clear_ready());
        _millis = 1900;
        REQUIRE(Task::select(3, tasks) == 2100);
        REQUIRE_FALSE(a.clear_ready());
        REQUIRE_FALSE(b.clear_ready());
        REQUIRE(c.clear_ready());
        _millis = 2200;
        REQUIRE(Task::select(3, tasks) == 2700);
        REQUIRE(a.clear_ready());
        REQUIRE(b.clear_ready());
        REQUIRE_FALSE(c.clear_ready());
    }
    SECTION("long tasks") {
        Task *tasks[] = { &b };
        REQUIRE(Task::select(1, tasks) == 2000);
        REQUIRE_FALSE(b.clear_ready());
        _millis = 2050;
        REQUIRE(Task::select(1, tasks) == 2100);
        REQUIRE_FALSE(b.clear_ready());
        _millis = 2150;
        REQUIRE(Task::select(1, tasks) == 3150);
        REQUIRE(b.clear_ready());
    }
    SECTION("no tasks") {
        REQUIRE(Task::select(0, nullptr) == 2000);
    }
};

TEST_CASE("smart device loop", "[smartdevice]") {
    bool param1 = false;
    float param2 = 1.234;
    uint32_t param3 = 0xc0deba5e;
    Parameter params[] = { PARAMETER(param1), PARAMETER(param2), PARAMETER(param3) };

    _millis = 1000;
    MockSmartDevice sd;
    ALLOW_CALL(sd, setup());
    ALLOW_CALL(sd, get_parameters(_))
        .SIDE_EFFECT(memcpy(_1, params, sizeof(params)))
        .RETURN(3);
    ALLOW_CALL(sd, read(_))
        .RETURN(_1 & 0b111);
    ALLOW_CALL(sd, write(_))
        .RETURN(_1 & 0b111);
    FORBID_CALL(sd, disable());                 /* Forbid spurious disables. */
    SmartDeviceLoop sd_loop(0x80, &sd);

    Message msg;
    param_map_t present = Message::NO_PARAMETERS;
    interval_t interval = Message::NO_SUBSCRIPTION;
    DeviceUID uid = { 0, 0, 0 };
    heartbeat_id_t hb_id = 0;
    ErrorCode error = ErrorCode::GENERIC_ERROR;

    byte output[256];
    size_t base = 0;
    MOCK_SERIAL_SEND(output, base);
    ALLOW_CALL(Serial, setTimeout(lt(2000)));   /* Ensure the Arduino never freezes up. */

    /* See subscription test cases (below) for decoding SUB_RES in response to
       PING or SUB_REQ. */

    SECTION("recv DEV_READ") {
        MOCK_SERIAL_RECV("\x06\x13\x02\x05\xff\xeb", 10000);
        RUN_LOOP(sd_loop, base);
        REQUIRE(CHECK_COBS_DECODE(msg, output));
        REQUIRE(msg.get_type() == MessageType::DEV_DATA);
        param1 = true;
        param2 = 0;
        param3 = 0;
        REQUIRE(msg.read_dev_data(&present, params));
        REQUIRE(present == 0b101);
        REQUIRE(param1 == false);
        REQUIRE(param2 == Approx(0));
        REQUIRE(param3 == 0xc0deba5e);
    }

    SECTION("recv DEV_WRITE") {
        MOCK_SERIAL_RECV("\x0b\x14\x07\x05\xff\x01\xef\xbe\xad\xde\xca", 10000);
        RUN_LOOP(sd_loop, base);
        REQUIRE(CHECK_COBS_DECODE(msg, output));
        REQUIRE(msg.get_type() == MessageType::DEV_DATA);
        REQUIRE(param1 == true);
        REQUIRE(param2 == Approx(1.234));
        REQUIRE(param3 == 0xdeadbeef);
        param1 = false;
        param2 = 0;
        param3 = 0;
        REQUIRE(msg.read_dev_data(&present, params));
        REQUIRE(present == 0b101);
        REQUIRE(param1 == true);
        REQUIRE(param2 == Approx(0));
        REQUIRE(param3 == 0xdeadbeef);
    }

    SECTION("recv DEV_DISABLE") {
        MOCK_SERIAL_RECV("\x02\x16\x02\x16", 10000);
        REQUIRE_CALL(sd, disable());
        RUN_LOOP(sd_loop, base);
        REQUIRE(base == 0);
    }

    SECTION("recv HB_REQ") {
        MOCK_SERIAL_RECV("\x05\x17\x01\xff\xe9", 10000);
        RUN_LOOP(sd_loop, base);
        REQUIRE(CHECK_COBS_DECODE(msg, output));
        REQUIRE(msg.get_type() == MessageType::HB_RES);
        REQUIRE(msg.read_hb_res(&hb_id));
        REQUIRE(hb_id == 0xff);
    }

    SECTION("recv HB_RES") {
        MOCK_SERIAL_RECV("\x05\x18\x01\xff\xe6", 10000);
        RUN_LOOP(sd_loop, base);
        REQUIRE(base == 0);
    }

    SECTION("reject messages with an invalid type") {
        auto message = GENERATE(
            "\x06\x12\x0f\xff\xff\x80\x01\x01\x01\x01"
            "\x01\x01\x01\x01\x01\x01\x01\x02\x9d",     /* SUB_RES */
            "\x03\x15\x02\x01\x02\x17"                  /* DEV_DATA */
        );
        MOCK_SERIAL_RECV(message, 10000);
        RUN_LOOP(sd_loop, base);
        REQUIRE(CHECK_COBS_DECODE(msg, output));
        REQUIRE(msg.get_type() == MessageType::ERROR);
        REQUIRE(msg.read_error(&error));
        REQUIRE(error == ErrorCode::INVALID_TYPE);
    }

    SECTION("reject bad messages") {
        auto packet = GENERATE(
            InvalidPacket { "\x02\x10\x02\x11", ErrorCode::BAD_CHECKSUM },
            InvalidPacket { "\x02\x10\x01", ErrorCode::UNEXPECTED_DELIMETER },
            InvalidPacket { "\xff", ErrorCode::UNEXPECTED_DELIMETER },
            InvalidPacket { OVERFLOW_PACKET, ErrorCode::BUFFER_OVERFLOW }
        );
        MOCK_SERIAL_RECV(packet.buf, 10000);
        RUN_LOOP(sd_loop, base);
        REQUIRE(CHECK_COBS_DECODE(msg, output));
        REQUIRE(msg.get_type() == MessageType::ERROR);
        ErrorCode error;
        REQUIRE(msg.read_error(&error));
        REQUIRE(error == packet.error);
    }

    SECTION("loop sends subscription updates") {
        const char *packet = "\x06\x11\x04\x01\xff\x01\x02\xea";
        unsigned long delay = 1000;
        MOCK_SERIAL_RECV(packet, delay);
        RUN_LOOP(sd_loop, base);
        REQUIRE(CHECK_COBS_DECODE(msg, output));
        REQUIRE(msg.get_type() == MessageType::SUB_RES);
        REQUIRE(msg.read_sub_res(&present, &interval, &uid));
        REQUIRE(present == 0b1);
        REQUIRE(interval == 40);

        packet = "";
        delay = 40;
        RUN_LOOP(sd_loop, base);
        REQUIRE(CHECK_COBS_DECODE(msg, output));
        REQUIRE(msg.get_type() == MessageType::HB_REQ);
        REQUIRE(CHECK_COBS_DECODE(msg, GET_SECOND(output)));
        REQUIRE(msg.get_type() == MessageType::DEV_DATA);
        param1 = true;
        REQUIRE(msg.read_dev_data(&present, params));
        REQUIRE(present == 0b1);
        REQUIRE_FALSE(param1);

        SECTION("subscription updates should send up-to-date data") {
            param1 = true;
            RUN_LOOP(sd_loop, base);
            REQUIRE(CHECK_COBS_DECODE(msg, output));
            REQUIRE(msg.get_type() == MessageType::DEV_DATA);
            param1 = false;
            REQUIRE(msg.read_dev_data(&present, params));
            REQUIRE(present == 0b1);
            REQUIRE(param1);
        }
        SECTION("subscription invalidation") {
            packet = "\x04\x11\x04\x01\x01\x01\x02\x14";
            RUN_LOOP(sd_loop, base);
            REQUIRE(CHECK_COBS_DECODE(msg, GET_SECOND(output)));
            REQUIRE(msg.read_sub_res(&present, &interval, &uid));
            REQUIRE(interval == Message::NO_SUBSCRIPTION);
            packet = "";
            RUN_LOOP(sd_loop, base);
            REQUIRE(_millis > 2000 + 40 + 40 + 40);
        }
        SECTION("subscription change") {
            packet = "\x08\x11\x04\x01\xff\xff\xff\xeb";
            RUN_LOOP(sd_loop, base);
            REQUIRE(CHECK_COBS_DECODE(msg, GET_SECOND(output)));
            REQUIRE(msg.read_sub_res(&present, &interval, &uid));
            REQUIRE(present == 0b1);
            REQUIRE(interval == 250);
            packet = "";
            delay = 50;
            RUN_LOOP(sd_loop, base);
            REQUIRE(_millis == 2000 + 40 + 40 + 250);
        }
        SECTION("subscription stays the same on error") {
            packet = "\x02\x80\x02\x80";
            RUN_LOOP(sd_loop, base);
            REQUIRE(CHECK_COBS_DECODE(msg, GET_SECOND(output)));
            REQUIRE(msg.get_type() == MessageType::ERROR);
            REQUIRE(msg.read_error(&error));
            REQUIRE(error == ErrorCode::INVALID_TYPE);
            packet = "";
            RUN_LOOP(sd_loop, base);
            REQUIRE(CHECK_COBS_DECODE(msg, output));
            REQUIRE(msg.get_type() == MessageType::DEV_DATA);
            param1 = true;
            REQUIRE(msg.read_dev_data(&present, params));
            REQUIRE(present == 0b1);
            REQUIRE_FALSE(param1);
        }
        SECTION("PING returns the current subscription") {
            packet = "\x02\x10\x02\x10";
            RUN_LOOP(sd_loop, base);
            REQUIRE(CHECK_COBS_DECODE(msg, GET_SECOND(output)));
            REQUIRE(msg.get_type() == MessageType::SUB_RES);
            REQUIRE(msg.read_sub_res(&present, &interval, &uid));
            REQUIRE(present == 0b1);
            REQUIRE(interval == 40);
        }

        REQUIRE(uid.device_id == 0x80);
        REQUIRE(uid.year == 1);
        REQUIRE(uid.random == 0xdeadbeefdeadbeefL);
    }

    SECTION("automatic disable") {
        unsigned long delay = 1000;
        isr_t isr = nullptr;
        REQUIRE_CALL(Timer1, initialize(_))
            .LR_SIDE_EFFECT(delay = _1);
        REQUIRE_CALL(Timer1, attachInterrupt(_))
            .LR_SIDE_EFFECT(isr = _1);
        REQUIRE_CALL(Serial, begin(eq(115200)));
        REQUIRE_CALL(sd, setup());
        REQUIRE_CALL(sd, disable());
        sd_loop.setup();
        SECTION("no spurious device disable") {
            FORBID_CALL(sd, disable());
            MOCK_SERIAL_RECV("\x02\x10\x02\x10", delay);
            REPEAT(5) {
                (*isr)();
                RUN_LOOP(sd_loop, base);
            }
        }
        SECTION("bad upstream") {
            REQUIRE_CALL(sd, disable()).TIMES(4);
            const char *packet;
            SECTION("inactive upstream") {
                packet = "";
            }
            SECTION("malfunctioning upstream") {
                packet = "\x02\x10\x02\x11";    /* PING with bad checksum. */
            }
            MOCK_SERIAL_RECV(packet, delay);
            REPEAT(5) {
                (*isr)();
                RUN_LOOP(sd_loop, base);
            }
        }
    }

    SECTION("ensure service even with slow read") {
        const char *packet = "\x03\x11\x04\x01\x02\x01\x02\x14";
        MOCK_SERIAL_RECV(packet, 2000);
        sd_loop.loop();
        ALLOW_CALL(sd, read(_))
            .LR_SIDE_EFFECT(_millis += 10000)
            .RETURN(0);
        packet = "";
        REQUIRE_CALL(Serial, setTimeout(_)).TIMES(5);
        REPEAT(5) {
            RUN_LOOP(sd_loop, base);
        }
    }
};
