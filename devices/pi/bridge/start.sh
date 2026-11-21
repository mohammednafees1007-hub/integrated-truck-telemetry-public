#!/bin/sh
set -eu
systemctl --user start truck-laptop-bridge.service
systemctl --user --no-pager status truck-laptop-bridge.service
