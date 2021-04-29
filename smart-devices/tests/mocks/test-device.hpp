#include <SmartDevice.hpp>

class MockSmartDevice: public SmartDevice {
public:
    MAKE_MOCK0(setup, void(void), override);
    MAKE_MOCK1(get_parameters, size_t(message::Parameter *), override);
    MAKE_MOCK1(read, message::param_map_t(message::param_map_t), override);
    MAKE_MOCK1(write, message::param_map_t(message::param_map_t), override);
    MAKE_MOCK0(disable, void(void), override);
};
