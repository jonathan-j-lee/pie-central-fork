BUILD_PATH  = $(CURDIR)/build
COBS_LIB    = $(CURDIR)/cobs-c
SD_LIB      = $(CURDIR)/SmartDevice
SD_MSG_LIB  = $(CURDIR)/sdmlib
SKETCH_PATH = $(CURDIR)/sketches

common_src  = $(filter %.c %.h %.cpp,$(wildcard $(COBS_LIB)/* $(SD_LIB)/src/* $(SD_MSG_LIB)/*))

ARDUINO_CLI  = arduino-cli
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
	rm -rf $(BUILD_PATH) $(ARDUINO_CACHE_PATH)
.PHONY: clean

$(BUILD_PATH):
	mkdir -p $(BUILD_PATH)

$(BUILD_PATH)/%.hex $(BUILD_PATH)/%.elf: $(SKETCH_PATH)/% $(common_src) $(BUILD_PATH)
	$(ARDUINO_CLI) compile $(ARDUINO_COMPILE_FLAGS) --output-dir $(dir $@) $(dir $<)

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

upload: check-device select-port $(BUILD_PATH)/$(DEVICE)/$(DEVICE).ino.hex
	$(ARDUINO_CLI) upload $(ARDUINO_UPLOAD_FLAGS) --input-dir $(dir $(lastword $^)) --port $(PORT)
.PHONY: upload
