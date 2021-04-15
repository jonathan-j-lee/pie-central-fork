#ifndef TEST_TIMERONE_H_
#define TEST_TIMERONE_H_

#include <catch2/catch.hpp>
#include <catch2/trompeloeil.hpp>

typedef void (*isr_t)(void);

class TimerOne {
public:
    virtual void initialize(unsigned long) = 0;
    virtual void attachInterrupt(isr_t) = 0;
};

class MockTimerOne: public TimerOne {
public:
    MAKE_MOCK1(initialize, void(unsigned long), override);
    MAKE_MOCK1(attachInterrupt, void(isr_t), override);
};

extern MockTimerOne Timer1;

#endif
