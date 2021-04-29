#define CATCH_CONFIG_MAIN
#include <catch2/catch.hpp>
#include "message.hpp"

using namespace message;

TEST_CASE("messages are constructed", "[message]") {
    Message msg;
    float param0 = 1.2345;
    int64_t param1 = -0xffff;
    bool param2 = true;
    Parameter param_addrs[] = { PARAMETER(param0), PARAMETER(param1), PARAMETER(param2) };

    SECTION("make PING") {
        REQUIRE(msg.make_ping());
        REQUIRE(msg.get_type() == MessageType::PING);
        REQUIRE(msg.get_payload_length() == 0);
    }
    SECTION("make SUB_REQ") {
        REQUIRE(msg.make_sub_req(0xffff, 0xeeee));
        REQUIRE(msg.get_type() == MessageType::SUB_REQ);
        REQUIRE(msg.get_payload_length() == 2 + 2);
        param_map_t params = 0;
        interval_t interval = 0;
        REQUIRE(msg.read_sub_req(&params, &interval));
        REQUIRE(params == 0xffff);
        REQUIRE(interval == 0xeeee);
    }
    SECTION("make SUB_RES") {
        DeviceUID uid = { 0xaaaa, 0xbb, 0x123456789abcdef0L };
        REQUIRE(msg.make_sub_res(0xffff, 0xeeee, &uid));
        REQUIRE(msg.get_type() == MessageType::SUB_RES);
        REQUIRE(msg.get_payload_length() == 2 + 2 + 2 + 1 + 8);
        param_map_t params = 0;
        interval_t interval = 0;
        uid.device_id = uid.year = uid.random = 0;
        REQUIRE(msg.read_sub_res(&params, &interval, &uid));
        REQUIRE(params == 0xffff);
        REQUIRE(interval == 0xeeee);
        REQUIRE(uid.device_id == 0xaaaa);
        REQUIRE(uid.year == 0xbb);
        REQUIRE(uid.random == 0x123456789abcdef0L);
    }
    SECTION("make DEV_READ") {
        REQUIRE(msg.make_dev_read(0xffff));
        REQUIRE(msg.get_type() == MessageType::DEV_READ);
        REQUIRE(msg.get_payload_length() == 2);
        param_map_t params = 0;
        REQUIRE(msg.read_dev_read(&params));
        REQUIRE(params == 0xffff);
    }
    SECTION("make DEV_WRITE") {
        REQUIRE(msg.make_dev_write(0b101, param_addrs));
        REQUIRE(msg.get_type() == MessageType::DEV_WRITE);
        REQUIRE(msg.get_payload_length() == 2 + 4 + 1);
        param_map_t params = 0;
        param0 = 0;
        param2 = false;
        REQUIRE(msg.read_dev_write(&params, param_addrs));
        REQUIRE(params == 0b101);
        REQUIRE(param0 == Approx(1.2345));
        REQUIRE(param2);
    }
    SECTION("make DEV_DATA") {
        REQUIRE(msg.make_dev_data(0b11, param_addrs));
        REQUIRE(msg.get_type() == MessageType::DEV_DATA);
        REQUIRE(msg.get_payload_length() == 2 + 4 + 8);
        param_map_t params = 0;
        param0 = 0;
        param1 = 0;
        REQUIRE(msg.read_dev_data(&params, param_addrs));
        REQUIRE(params == 0b11);
        REQUIRE(param0 == Approx(1.2345));
        REQUIRE(param1 == -0xffff);
    }
    SECTION("make DEV_DISABLE") {
        REQUIRE(msg.make_dev_disable());
        REQUIRE(msg.get_type() == MessageType::DEV_DISABLE);
        REQUIRE(msg.get_payload_length() == 0);
    };
    SECTION("make HB_REQ") {
        REQUIRE(msg.make_hb_req(0xdd));
        REQUIRE(msg.get_type() == MessageType::HB_REQ);
        REQUIRE(msg.get_payload_length() == 1);
        heartbeat_id_t hb_id = 0;
        REQUIRE(msg.read_hb_req(&hb_id));
        REQUIRE(hb_id == 0xdd);
    }
    SECTION("make HB_RES") {
        REQUIRE(msg.make_hb_res(0xdd));
        REQUIRE(msg.get_type() == MessageType::HB_RES);
        REQUIRE(msg.get_payload_length() == 1);
        heartbeat_id_t hb_id = 0;
        REQUIRE(msg.read_hb_res(&hb_id));
        REQUIRE(hb_id == 0xdd);
    }
    SECTION("make ERROR") {
        REQUIRE(msg.make_error(ErrorCode::BAD_CHECKSUM));
        REQUIRE(msg.get_type() == MessageType::ERROR);
        REQUIRE(msg.get_payload_length() == 1);
        ErrorCode error = ErrorCode::GENERIC_ERROR;
        REQUIRE(msg.read_error(&error));
        REQUIRE(error == ErrorCode::BAD_CHECKSUM);
    }
    REQUIRE(msg.verify_checksum());
};

TEST_CASE("messages fail to be constructed", "[message]") {
    uint64_t param1;
    byte param2[255 - 2 - sizeof(param1) + 1];
    Parameter params[] = { PARAMETER(param1), { param2, sizeof(param2) } };
    Message msg;

    SECTION("too much data appended to DEV_WRITE") {
        REQUIRE_FALSE(msg.make_dev_write(0b11, params));
        params[1].size--;
        REQUIRE(msg.make_dev_write(0b11, params));
    }
    SECTION("too much data appended to DEV_DATA") {
        REQUIRE_FALSE(msg.make_dev_data(0b11, params));
        params[1].size--;
        REQUIRE(msg.make_dev_data(0b11, params));
    }
};

TEST_CASE("messages fail to be read", "[message]") {
    Message msg;
    param_map_t present;
    interval_t interval;
    DeviceUID uid = { 0, 0, 0 };
    Parameter params[16];
    heartbeat_id_t hb_id;
    ErrorCode error;

    SECTION("message too long") {
        byte param1[255 - 2];
        params[0] = { param1, sizeof(param1) };
        REQUIRE(msg.make_dev_data(0b1, params));
        params[0].size--;
    }
    SECTION("message too short") {
    }

    REQUIRE_FALSE(msg.read_sub_req(&present, &interval));
    REQUIRE_FALSE(msg.read_sub_res(&present, &interval, &uid));
    REQUIRE_FALSE(msg.read_dev_read(&present));
    REQUIRE_FALSE(msg.read_dev_write(&present, params));
    REQUIRE_FALSE(msg.read_dev_data(&present, params));
    REQUIRE_FALSE(msg.read_hb_req(&hb_id));
    REQUIRE_FALSE(msg.read_hb_res(&hb_id));
    REQUIRE_FALSE(msg.read_error(&error));
};

struct MessageEncoding {
    const char *buf;
    MessageType type;
    size_t payload_length;
};

TEST_CASE("messages are COBS-encoded", "[message]") {
    auto encoding = GENERATE(
        MessageEncoding { "\x02\x10\x02\x10", MessageType::PING, 0 },
        MessageEncoding { "\x06\x11\x04\xff\xff\x80\x02\x95", MessageType::SUB_REQ, 2 + 2 },
        MessageEncoding { "\x06\x12\x0f\xff\xff\x80\x01\x01\x01\x01\x01"
                          "\x01\x01\x01\x01\x01\x01\x02\x9d", MessageType::SUB_RES, 2 + 2 + 2 + 1 + 8 },
        MessageEncoding { "\x04\x13\x02\x07\x02\x16", MessageType::DEV_READ, 2 },
        MessageEncoding { "\x04\x14\x03\x01\x03\x01\x17", MessageType::DEV_WRITE, 2 + 1 },
        MessageEncoding { "\x04\x15\x03\x01\x01\x02\x17", MessageType::DEV_DATA, 2 + 1 },
        MessageEncoding { "\x02\x16\x02\x16", MessageType::DEV_DISABLE, 0 },
        MessageEncoding { "\x05\x17\x01\xff\xe9", MessageType::HB_REQ, 1 },
        MessageEncoding { "\x05\x18\x01\xff\xe6", MessageType::HB_RES, 1 },
        MessageEncoding { "\x05\xff\x01\xfd\x03", MessageType::ERROR, 1 }
    );

    Message msg;
    byte buf[ENCODING_MAX_SIZE];
    size_t out_len;
    size_t encoding_length = strlen(encoding.buf);

    REQUIRE(msg.decode((byte *) encoding.buf, encoding_length) == ErrorCode::OK);
    REQUIRE(msg.get_type() == encoding.type);
    REQUIRE(msg.get_payload_length() == encoding.payload_length);
    REQUIRE(msg.verify_checksum());

    REQUIRE(msg.encode(buf, sizeof(buf), &out_len) == ErrorCode::OK);
    REQUIRE(out_len == encoding_length);
    REQUIRE(strncmp(encoding.buf, (const char *) buf, encoding_length) == 0);
};
