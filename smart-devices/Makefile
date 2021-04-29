.SECONDARY:

BUILD_PATH  = $(CURDIR)/build
COBS_LIB    = $(CURDIR)/cobs-c
SD_LIB      = $(CURDIR)/SmartDevice
SKETCH_PATH = $(CURDIR)/sketches
TESTS_PATH  = $(CURDIR)/tests

CXX = c++
CXXFLAGS = -Wall -Werror -fPIC -pipe -I$(SD_LIB)/src -I$(TESTS_PATH)/mocks

cobs_src = $(SD_LIB)/src/cobs.c $(SD_LIB)/src/cobs.h
sd_lib_src := $(wildcard $(SD_LIB)/src/*.cpp)
sd_lib_src += $(sd_lib_src:%.cpp=%.hpp)
test_src = $(wildcard $(TESTS_PATH)/test_*.cpp)
test_bin = $(patsubst $(TESTS_PATH)/test_%.cpp,$(BUILD_PATH)/tests/test_%,$(test_src))
mocks_src = $(filter %.h %.cpp,$(wildcard $(TESTS_PATH)/mocks/*))

ARDUINO_CLI = arduino-cli
ARDUINO_PLATFORM = arduino:avr
# Fully qualified board name (see `arduino-cli board listall` for details)
ARDUINO_FQBN = arduino:avr:micro

ARDUINO_LIBS = \
	MFRC522 \
	Servo \
	TimerOne \
	TimerThree \

# The real-world year that Smart Devices were introduced, which corresponds to
# year 0 in the Smart Device protocol.
start_year = 2016
YEAR   = $(shell expr $(shell date +%Y) - $(start_year))
RANDOM = $(strip $(shell od --address-radix=n -v --format=u8 --read-bytes=8 < /dev/urandom))L
ARDUINO_COMPILE_FLAGS = \
	--fqbn $(ARDUINO_FQBN) \
	--libraries "$(SD_LIB)" \
	--build-property "compiler.cpp.extra_flags=-DYEAR=$(YEAR) \"-DRANDOM=$(RANDOM)\"" \

ARDUINO_UPLOAD_FLAGS = \
	--fqbn $(ARDUINO_FQBN) \
	--verify \

ARDUINO_CACHE_PATH = $(wildcard /tmp/arduino-*)

devices := $(notdir $(wildcard $(SKETCH_PATH)/*))

# Colorize output
ifndef NO_COLOR
	red=$(shell echo -e "\033[0;91;1m")
	green=$(shell echo -e "\033[0;92;1m")
	yellow=$(shell echo -e "\033[0;93;1m")
	blue=$(shell echo -e "\033[0;94;1m")
	reset=$(shell echo -e "\033[0m")
endif

all: install-deps compile-sketches
.PHONY: all

install-deps:
	$(ARDUINO_CLI) lib update-index
	$(ARDUINO_CLI) core install $(ARDUINO_PLATFORM)
	$(ARDUINO_CLI) lib install $(ARDUINO_LIBS)
	$(ARDUINO_CLI) lib upgrade
.PHONY: install-deps

clean:
	$(ARDUINO_CLI) cache clean
	$(RM) -r $(BUILD_PATH) $(ARDUINO_CACHE_PATH)
	$(RM) $(cobs_src)
	[ -f $(COBS_LIB)/Makefile ] && $(MAKE) -C $(COBS_LIB) clean
.PHONY: clean

$(BUILD_PATH) $(BUILD_PATH)/tests:
	mkdir -p $@

$(COBS_LIB)/Makefile:
	cd $(COBS_LIB) && ./autogen.sh && ./configure

$(COBS_LIB)/%.o: $(COBS_LIB)/%.c $(COBS_LIB)/%.h $(COBS_LIB)/Makefile
	$(MAKE) -C $(dir $@) $@

$(SD_LIB)/src/cobs.c: $(COBS_LIB)/cobs.c
$(SD_LIB)/src/cobs.h: $(COBS_LIB)/cobs.h
$(cobs_src):
	cd $(dir $@) && ln -s $(shell realpath --relative-to $(dir $@) $<) .

$(BUILD_PATH)/%.hex $(BUILD_PATH)/%.elf: $(SKETCH_PATH)/% $(BUILD_PATH) $(sd_lib_src) $(cobs_src)
	$(ARDUINO_CLI) compile $(ARDUINO_COMPILE_FLAGS) --output-dir $(dir $@) $(dir $<)

# NOTE: Maybe the dependencies are not as targeted as `gcc -MM`, causing
#       unnecessary rebuilds, but it's not a big deal for such a simple library.
test_deps = $(BUILD_PATH)/tests $(mocks_src) $(sd_lib_src) $(cobs_src) $(COBS_LIB)/cobs.o
$(BUILD_PATH)/tests/test_%: $(TESTS_PATH)/test_%.cpp $(test_deps)
	$(CXX) $(CXXFLAGS) -o $@ $(filter %.o %.cpp,$^)

test: $(test_bin)
	@for bin in $^; do \
		echo "$(blue)*** Running test: $$(basename $$bin) ***$(reset)"; \
		sh -c $$bin; \
	done
.PHONY: test

check-device:
ifeq (,$(filter $(DEVICE),$(devices)))
	$(info Available devices:)
	$(foreach device,$(devices),$(info - $(device)))
	$(error $(red)The DEVICE variable must be a valid device$(reset))
endif
.PHONY: check-device

select-port:
ifndef PORT
	$(warning $(yellow)The PORT variable was not provided$(reset))
	$(eval PORT := $(shell $(ARDUINO_CLI) --format json board list | jq -r '.[0].address'))
endif
	$(if $(PORT),$(info $(green)Port selected: $(PORT)$(reset)),$(error $(red)No port found$(reset)))
.PHONY: select-port

compile-sketches: $(foreach dev,$(devices),$(BUILD_PATH)/$(dev)/$(dev).ino.hex)
.PHONY: compile-sketches

compile-bindings:
.PHONY: compile-bindings

upload: check-device select-port $(BUILD_PATH)/$(DEVICE)/$(DEVICE).ino.hex
	$(ARDUINO_CLI) upload $(ARDUINO_UPLOAD_FLAGS) --input-dir $(dir $(lastword $^)) --port $(PORT)
.PHONY: upload

help:
	@echo "make targets:"
	@echo "  (none):           install dependencies and compile all binaries"
	@echo "  install-deps:     install all dependencies"
	@echo "  clean:            remove all build artifacts"
	@echo "  test:             compile and run the test suite"
	@echo "  compile-sketches: compile all Arduino sketches"
	@echo "  compile-bindings: compile all sdmlib bindings"
	@echo "  upload:           upload a sketch for DEVICE to a board on PORT"
.PHONY: help
