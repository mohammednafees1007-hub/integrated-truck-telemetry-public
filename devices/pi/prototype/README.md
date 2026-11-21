# Raspberry Pi gateway and camera adapter

The gateway reads framed ESP32 serial data and serves source state on port 8765. The independent camera adapter serves inference/preview state on port 8766. Follow the public [setup guide](../../../docs/SETUP.md).

config.example.yaml is a template, not device configuration. Set your serial device, source IDs, origins and camera settings locally. Camera processing is disabled in the example until explicitly configured. Keep your actual config.yaml private.

Firmware is in firmware/esp32_sensor_hub/; inspect pins.h before wiring. The camera adapter uses the attributed fatigue engine under third_party/fatigue-engine; ONNX weights are excluded from this public source copy. Restore compatible weights from upstream after reviewing terms.

The integration combines independently valid measurements in one view. It does not implement joint GPS/IMU Kalman filtering, calibrated fuel litres, ignition control or a validated fatigue classifier. Historical physical fixtures and installed service snapshots are omitted.
