#!/bin/sh
set -eu
cd "$(dirname "$0")"
test -f config.json || { echo 'Copy config.example.json to config.json and fill private keys first'; exit 1; }
# Check commissioned gateway; never start another serial reader.
curl --fail --silent http://127.0.0.1:8765/health >/dev/null
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
chmod 600 config.json
ROOT=$(pwd)
mkdir -p "$HOME/.config/systemd/user"
cat > "$HOME/.config/systemd/user/truck-laptop-bridge.service" <<EOF
[Unit]
Description=Outbound truck laptop bridge
After=network-online.target
[Service]
WorkingDirectory=$ROOT
ExecStart="$ROOT/.venv/bin/python" "$ROOT/bridge.py"
Restart=on-failure
RestartSec=5
UMask=0077
NoNewPrivileges=true
[Install]
WantedBy=default.target
EOF
systemctl --user daemon-reload
echo 'Installed, not enabled at boot. Run sh start.sh after checking no old GPS worker is active.'
