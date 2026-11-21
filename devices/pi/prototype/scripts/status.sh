#!/usr/bin/env bash
set -u
systemctl --user --no-pager status prototype-dashboard.service prototype-sensors.service prototype-camera.service; curl -fsS http://127.0.0.1:8765/health; echo; curl -fsS http://127.0.0.1:8766/health; echo

curl -fsS http://127.0.0.1:3000/api/pi/latest; echo
