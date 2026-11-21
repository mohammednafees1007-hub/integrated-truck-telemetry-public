#!/usr/bin/env bash
set -euo pipefail
systemctl --user start prototype-sensors.service prototype-dashboard.service
for attempt in {1..30}; do
  if curl -fsS http://127.0.0.1:8765/health >/dev/null 2>&1 && curl -fsS http://127.0.0.1:3000/api/pi/latest >/dev/null 2>&1; then
    echo 'Ready: http://192.168.29.243:3000 (camera starts from Driver Monitoring)'
    exit 0
  fi
  sleep 0.25
done
echo 'Startup failed; run scripts/status.sh' >&2
exit 1
