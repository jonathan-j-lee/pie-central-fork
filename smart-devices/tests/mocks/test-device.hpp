#include <SmartDevice.hpp>

class MockSmartDevice: public SmartDevice {
public:
    MAKE_MOCK0(setup, void(void), override);
    MAKE_MOCK1(get_parameters, size_t(Parameter *), override);
    MAKE_MOCK1(read, param_map_t(param_map_t), override);
    MAKE_MOCK1(write, param_map_t(param_map_t), override);
    MAKE_MOCK0(disable, void(void), override);
};
