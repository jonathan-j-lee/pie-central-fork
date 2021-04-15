#include <stdint.h>
#include <MFRC522.h>
#include <SPI.h>
#include <SmartDevice.hpp>

#define RST_PIN 9
#define SS_PIN 10

enum {
    TAG_DETECT = 0,
    ID = 1,
};

class RFID: public SmartDevice {
    static const unsigned long READ_CACHE_TIMEOUT = 200;  /* In ms. */
    MFRC522 reader;

    unsigned long last_read;
    bool tag_detect;
    uint32_t id;

public:
    RFID(): reader(SS_PIN, RST_PIN) {
        this->tag_detect = false;
        this->id = 0;
    }
    void setup(void) {
        SPI.begin();
        this->last_read = millis();
        this->reader.PCD_Init();
    }
    size_t get_parameters(Parameter *params) {
        params[TAG_DETECT] = PARAMETER(this->tag_detect);
        params[ID] = PARAMETER(this->id);
        return 2;
    }
    /* Unfortunately, accessing the RFID can be somewhat slow (about 100 ms for a
       card present), so we cache the read. Frequent subscription updates may block
       the main loop and lead to unresponsiveness. */
    param_map_t read(param_map_t params) {
        bool refresh = millis() - this->last_read >= READ_CACHE_TIMEOUT;
        param_map_t params_read = NO_PARAMETERS;
        if (get_bit(params, ID)) {
            set_bit(params, TAG_DETECT);
        }
        if (get_bit(params, TAG_DETECT)) {
            set_bit(params_read, TAG_DETECT);
            if (refresh) {
                this->tag_detect = reader.PICC_IsNewCardPresent();
            }
        }
        if (get_bit(params, ID)) {
            set_bit(params_read, ID);
            if (refresh) {
                this->tag_detect = this->tag_detect && reader.PICC_ReadCardSerial();
            }
            if (this->tag_detect && refresh) {
                this->id = (uint32_t) reader.uid.uidByte[0];
                this->id |= ((uint32_t) reader.uid.uidByte[1]) << 8;
                this->id |= ((uint32_t) reader.uid.uidByte[2]) << 16;
            }
        }
        if (refresh) {
            last_read = millis();
        }
        return params_read;
    }
};

RFID rfid;
SmartDeviceLoop sd_loop(0x0B, &rfid);
ADD_ARDUINO_SETUP_AND_LOOP(sd_loop);
