#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
python3 -m venv --system-site-packages "$ROOT/../.venv"
"$ROOT/../.venv/bin/pip" install -r "$ROOT/requirements-sensors.txt" -r "$ROOT/requirements-dev.txt"
[[ -e "$ROOT/config.yaml" ]] || cp "$ROOT/config.example.yaml" "$ROOT/config.yaml"
echo "Sensor setup ready. Camera dependencies are separate: requirements-camera.txt"
