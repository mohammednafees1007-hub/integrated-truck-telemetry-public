#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
[[ -x "$ROOT/tools/arduino-cli" ]] || { echo 'Arduino CLI 1.5.1 required in tools/ (official Linux ARM64 release).'; exit 1; }
"$ROOT/../.venv/bin/pip" install 'esptool==5.6.0'
"$ROOT/tools/arduino-cli" --config-file "$ROOT/arduino-cli.yaml" core update-index
python3 "$ROOT/scripts/install_esp32_toolchain.py"
"$ROOT/tools/arduino-cli" --config-file "$ROOT/arduino-cli.yaml" lib install 'Adafruit BNO08x@1.2.7' 'Adafruit Unified Sensor@1.1.15' 'Adafruit BusIO@1.17.4' 'MFRC522@1.4.12' 'ArduinoJson@7.4.3'
"$ROOT/scripts/build_esp32.sh"
