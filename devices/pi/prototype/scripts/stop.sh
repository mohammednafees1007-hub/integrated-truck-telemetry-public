#!/usr/bin/env bash
set -u
systemctl --user stop prototype-dashboard.service prototype-sensors.service prototype-camera.service
