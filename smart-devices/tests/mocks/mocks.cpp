#include <Arduino.h>
#include <TimerOne.h>

/* Define global mocks. */

unsigned long _millis = 0;
unsigned long _delay = 0;

MockSerialFactory Serial;
MockTimerOne Timer1;
