#include <SmartDevice.hpp>
#include <Hub.hpp>

class LimitSwitch: public Spoke<bool> {
public:
    LimitSwitch(pin_t pin): Spoke<bool>(pin) {
    }
    inline bool read(void) override {
        this->value = digitalRead(this->pin) == HIGH;
        return true;
    }
};

LimitSwitch limit_switches[] = { LimitSwitch(A0), LimitSwitch(A1), LimitSwitch(A2) };
HubSmartDevice<bool, 3> hub(limit_switches);
SmartDeviceLoop sd_loop(0x00, &hub);
ADD_ARDUINO_SETUP_AND_LOOP(sd_loop);
