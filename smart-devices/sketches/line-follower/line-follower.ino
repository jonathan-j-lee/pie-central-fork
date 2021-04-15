#include <SmartDevice.hpp>
#include <Hub.hpp>

class LineFollower: public Spoke<float> {
public:
    static float MAX_INTENSITY;
    LineFollower(pin_t pin): Spoke<float>(pin) {
    }
    inline bool read(void) override {
        this->value = ((float) analogRead(this->pin)) / LineFollower::MAX_INTENSITY;
        return true;
    }
};

float LineFollower::MAX_INTENSITY = 1023;

LineFollower line_followers[] = { LineFollower(A0), LineFollower(A1), LineFollower(A2) };
HubSmartDevice<float, 3> hub(line_followers);
SmartDeviceLoop sd_loop(0x01, &hub);
ADD_ARDUINO_SETUP_AND_LOOP(sd_loop);
