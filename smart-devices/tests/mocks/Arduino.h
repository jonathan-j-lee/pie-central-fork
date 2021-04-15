#ifndef TEST_ARDUINO_H_
#define TEST_ARDUINO_H_

#include <string>
#include <catch2/catch.hpp>
#include <catch2/trompeloeil.hpp>

#define YEAR    1
#define RANDOM  0xdeadbeefdeadbeefL

#define min(a, b) ((a) < (b) ? (a) : (b))
#define max(a, b) ((a) > (b) ? (a) : (b))
#define constrain(x, low, high) max(low, min(x, high))

typedef uint8_t byte;

extern unsigned long _millis;
extern unsigned long _delay;

inline unsigned long millis(void) {
    return _millis;
}

inline void delay(unsigned long ms) {
    _delay = ms;
}

class SerialFactory {
public:
    virtual void begin(long) = 0;
    virtual void write(std::string) = 0;
    virtual void write(char) = 0;
    virtual void write(byte *, size_t) = 0;
    virtual size_t readBytesUntil(char, byte *, size_t) = 0;
    virtual void setTimeout(unsigned long) = 0;
    operator bool() const {
        return true;
    };
};

class MockSerialFactory: public SerialFactory {
public:
    MAKE_MOCK1(begin, void(long), override);
    MAKE_MOCK1(write, void(std::string), override);
    MAKE_MOCK1(write, void(char), override);
    MAKE_MOCK2(write, void(byte *, size_t), override);
    MAKE_MOCK3(readBytesUntil, size_t(char, byte *, size_t), override);
    MAKE_MOCK1(setTimeout, void(unsigned long), override);
};

extern MockSerialFactory Serial;

#endif
