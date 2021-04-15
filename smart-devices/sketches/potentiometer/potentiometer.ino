#include <SmartDevice.hpp>
#include <Hub.hpp>

class Potentiometer: public Spoke<float> {
public:
    static float MAX_VALUE;
    Potentiometer(pin_t pin): Spoke<float>(pin) {
    }
    inline bool read(void) override {
        this->value = ((float) analogRead(this->pin)) / Potentiometer::MAX_VALUE;
        return true;
    }
};

float Potentiometer::MAX_VALUE = 1023;

Potentiometer potentiometers[] = { Potentiometer(A0), Potentiometer(A1), Potentiometer(A2) };
HubSmartDevice<float, 3> hub(potentiometers);
SmartDeviceLoop sd_loop(0x02, &hub);
ADD_ARDUINO_SETUP_AND_LOOP(sd_loop);
