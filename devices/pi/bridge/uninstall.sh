#!/bin/sh
set -eu
systemctl --user disable --now truck-laptop-bridge.service || true
rm -f "$HOME/.config/systemd/user/truck-laptop-bridge.service"
systemctl --user daemon-reload
echo 'Bridge removed from systemd. Configuration and diagnostics retained.'
