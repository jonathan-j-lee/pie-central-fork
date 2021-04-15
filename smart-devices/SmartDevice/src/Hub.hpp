#ifndef HUB_H_
#define HUB_H_

#include <stdint.h>
#include <SmartDevice.hpp>

typedef uint8_t pin_t;

template <typename T>
class Spoke {
protected:
    pin_t pin;
    T value;
public:
    Spoke(pin_t pin) {
        this->pin = pin;
    }
    void setup(void) {
        pinMode(this->pin, INPUT);
    }
    void get_parameter(Parameter *param) {
        param->base = &this->value;
        param->size = sizeof(this->value);
    }
    virtual bool read(void) = 0;
    bool write(void) {
        /* Default implementation of a sensor with no writeable parameters. */
        return false;
    }
    void disable(void) {
        /* Default implementation of a sensor with no writeable parameters. */
    }
};

/**
 *  A hub Smart Device is a special Smart Device that controls multiple
 *  identical sensors or actuators (the "spokes"). Each spoke measures or acts
 *  on a single scalar value and is placed on a single pin.
 *
 *  Because each sensor is so simple, it is more economical to have each
 *  microcontroller monitor more than just one.
 */
template <typename T, size_t N>
class HubSmartDevice: public SmartDevice {
    Spoke<T> *spokes;
public:
    HubSmartDevice(Spoke<T> *spokes) {
        this->spokes = spokes;
    }
    void setup(void) override {
        for (size_t i = 0; i < N; i++) {
            this->spokes[i].setup();
        }
    }
    size_t get_parameters(Parameter *params) override {
        for (size_t i = 0; i < N; i++) {
            this->spokes[i].get_parameter(&params[i]);
        }
        return N;
    }
    param_map_t read(param_map_t params) override {
        param_map_t params_read = NO_PARAMETERS;
        for (size_t i = 0; i < min(N, MAX_PARAMETERS); i++) {
            if (get_bit(params, i) && this->spokes[i].read()) {
                set_bit(params_read, i);
            }
        }
        return params_read;
    }
    param_map_t write(param_map_t params) override {
        param_map_t params_written = NO_PARAMETERS;
        for (size_t i = 0; i < min(N, MAX_PARAMETERS); i++) {
            if (get_bit(params, i) && this->spokes[i].write()) {
                set_bit(params_written, i);
            }
        }
        return params_written;
    }
    void disable(void) override {
        for (size_t i = 0; i < N; i++) {
            this->spokes[i].disable();
        }
    }
};

#endif
