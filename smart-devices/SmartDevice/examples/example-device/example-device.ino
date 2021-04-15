/* Minimal sample implementation of a one-parameter read-only Smart Device
   (i.e., a sensor). You must implement `get_parameters(...)` and `read(...)`.
   You may also overload `setup(...)`, `write(...)`, and `disable()`. See
   `SmartDevice.hpp` for details. */

#include <SmartDevice.hpp>

enum {
    PARAM1 = 0,
};

class ExampleDevice: public SmartDevice {
    bool param1;
public:
    void setup(void) {
        pinMode(A0, INPUT);
    }
    size_t get_parameters(Parameter *params) {
        /* Reveal PARAM1's memory address and size to the caller. */
        params[PARAM1] = PARAMETER(this->param1);
        return 1;
    }
    param_map_t read(param_map_t params) {
        param_map_t params_read = NO_PARAMETERS;
        if (get_bit(params, PARAM1)) {
            set_bit(params, PARAM1);
            param1 = digitalRead(A0) == HIGH;
        }
        /* Only return the parameters that were actually read. You may read
           more parameters than were explicitly requested. */
        return params_read;
    }
};

ExampleDevice device;
SmartDeviceLoop sd_loop(0xff, &device);
ADD_ARDUINO_SETUP_AND_LOOP(sd_loop);
