#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
CLI="$ROOT/tools/arduino-cli"
FQBN=${ESP32_FQBN:-esp32:esp32:esp32}
mkdir -p "$ROOT/build/esp32"
"$CLI" --config-file "$ROOT/arduino-cli.yaml" compile --fqbn "$FQBN" --output-dir "$ROOT/build/esp32" "$ROOT/firmware/esp32_sensor_hub" 2>&1 | tee "$ROOT/build/firmware-build.log"
"$CLI" --config-file "$ROOT/arduino-cli.yaml" version > "$ROOT/build/firmware-versions.txt"
"$CLI" --config-file "$ROOT/arduino-cli.yaml" core list >> "$ROOT/build/firmware-versions.txt"
"$CLI" --config-file "$ROOT/arduino-cli.yaml" lib list >> "$ROOT/build/firmware-versions.txt"
