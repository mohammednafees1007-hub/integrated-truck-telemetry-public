# Local setup

This is a source export. It does not include commissioned device configuration, model weights, Android build tools, APK signing keys or personal replay clips. Use your own devices and credentials.

## Independent synthetic demonstration

From `apps/dashboard`, run `npm ci`, `npm run build:synthetic`, then:

```sh
node scripts/synthetic-server.cjs
```

Open `http://localhost:3001/truck-tracking/`. This server binds to loopback and has no real receiving APIs. Demo fixtures are synthetic. Video replay requires a separately supplied, consented clip; no personal recording is included.

## Real laptop receiver

From `apps/dashboard`:

```sh
node scripts/secrets.cjs
npm run build
npm start
```

Open `http://localhost:3000/truck-tracking/`. The generated local password is in `.private/ACCESS.md`. Keep `.env` and `.private/` private. The public export retains integration source, but it does not configure a new Pi automatically.

For remote phone/Pi transport, create your own authenticated HTTPS receiver address and update local `PUBLIC_ORIGIN`. A temporary tunnel can forward to port 3000. Keep authentication enabled. Do not put keys in source files or publish pairing pages. Online map tiles also require internet. The final system is laptop-hosted, not a cPanel service.

## Raspberry Pi and ESP32

1. Use Raspberry Pi OS with compatible CSI/Picamera2 support. Connect the camera ribbon while power is off.
2. In `devices/pi/prototype`, run `bash scripts/setup_pi.sh`. This creates the environment at `devices/pi/.venv` and copies `config.example.yaml` to your local `config.yaml` when absent. Review serial device and camera settings for your hardware.
3. Install camera dependencies separately from `requirements-camera.txt`, including required OS camera libraries. Obtain ONNX files from the documented upstream project after checking their terms; the public export excludes weights.
4. Build/flash `firmware/esp32_sensor_hub/` using Arduino tooling and the libraries used by its source. Inspect `pins.h` before wiring. This is classic ESP32 pin numbering.
5. With the ESP32 connected by a data-capable USB cable and serial permissions configured, run the gateway using the Pi environment: `../.venv/bin/python -m pi_gateway.app`. Run camera processing in a separate terminal with `../.venv/bin/python -m camera_service.app`.
6. `scripts/install_services.py` can generate user service files from your actual checkout/environment paths. Review before starting them. The public copy omits service snapshots from the original laptop/Pi.
7. In `devices/pi/bridge`, copy `config.example.json` to **local** `config.json`. Enter your receiver origin and separately generated device/reader keys matching the laptop. Run `sh install.sh` only after the commissioned gateway answers at `http://127.0.0.1:8765/health`, then `sh start.sh`. The installer checks the gateway rather than starting another serial reader.

| Device | Classic ESP32 GPIO |
|---|---|
| BNO085 I2C | SDA 21, SCL 22 |
| RC522 SPI | SCK 18, MISO 19, MOSI 23; SS 27, RST 26 |
| SR04M-2 trigger/echo | Trigger 25, voltage-divided echo 33 |
| ESP32 → Pi | 460800-baud USB serial |

Use common grounds and the documented voltage divider; do not feed 5 V echo directly to an ESP32 input. The enabled probe path is trigger/echo, not the alternative UART parser.

## Phone

Build the Android source using the documented ARM64 tool layout, or use your own reviewed build. Set the receiver and scoped write key through your private pairing page. Grant precise location and notifications; press Start outdoors. Verify both an accepted fresh fix and its matching Pi acknowledgement. Stop sharing using the notification. Pairing alone is not proof of delivery.

## Stop and check

Stop the two Node processes with Ctrl+C in their own terminals. On the Pi, stop the bridge with `sh stop.sh` and stop the gateway/camera processes or their user services. Stop GPS sharing on the phone. Shut down Raspberry Pi OS before removing power.

Inspect source ages independently: GPS, IMU, probe, card state, inference and JPEG. A connected bridge can still deliver stale or unavailable sensor state. Check wiring and source diagnostics before interpreting dashboard values. No live all-sensors-ready result is claimed by this public export.
