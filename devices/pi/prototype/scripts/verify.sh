#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$ROOT"
"$ROOT/../.venv/bin/python" -m pytest -q tests
"$ROOT/../.venv/bin/python" scripts/measure_stream.py --seconds "${1:-60}"
