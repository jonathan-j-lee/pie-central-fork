#include <Servo.h>
#include <SmartDevice.hpp>
#include <Hub.hpp>

class ServoMotor: public Spoke<float> {
    Servo controller;
    inline float map_to_angle(float pos) {
        return SPREAD*pos + MIDPOINT;
    }
    float map_from_angle(float angle) {
        return (angle - MIDPOINT)/SPREAD;
    }
public:
    /* A normalized position of +/- 1 (as the Smart Device protocol uses)
       corresponds to MIDPOINT +/- SPREAD, the servo angle in degrees. */
    static float MIDPOINT;
    static float SPREAD;
    ServoMotor(pin_t pin): Spoke<float>(pin) {
    }
    void setup(void) {
        this->controller.attach(this->pin);
    }
    bool read(void) override {
        this->value = map_from_angle(this->controller.read());
        return true;
    }
    bool write(void) {
        this->controller.write(map_to_angle(this->value));
        return true;
    }
    void disable(void) {
        this->controller.detach();
    }
};

float ServoMotor::MIDPOINT = 90;
float ServoMotor::SPREAD = 90;

ServoMotor motors[] = { ServoMotor(5), ServoMotor(6) };
HubSmartDevice<float, 2> hub(motors);
SmartDeviceLoop sd_loop(0x07, &hub);
ADD_ARDUINO_SETUP_AND_LOOP(sd_loop);
