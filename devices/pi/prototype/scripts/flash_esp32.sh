#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
: "${ESP32_PORT:?Set ESP32_PORT to the verified USB by-id path}"
: "${ESP32_FQBN:?Set ESP32_FQBN to the verified board}"
[[ -e "$ESP32_PORT" ]] || { echo 'Verified port missing'; exit 1; }
was_active=false
if systemctl --user is-active --quiet prototype-sensors; then was_active=true;systemctl --user stop prototype-sensors;fi
restore(){ if "$was_active"; then systemctl --user start prototype-sensors;fi; }
trap restore EXIT
"$ROOT/tools/arduino-cli" --config-file "$ROOT/arduino-cli.yaml" upload --fqbn "$ESP32_FQBN" --port "$ESP32_PORT" --input-dir "$ROOT/build/esp32" "$ROOT/firmware/esp32_sensor_hub" 2>&1 | tee "$ROOT/build/firmware-upload.log"
