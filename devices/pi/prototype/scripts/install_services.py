#!/usr/bin/env python3
from pathlib import Path
import getpass,subprocess
root=Path(__file__).resolve().parents[1];venv=root.parent/'.venv'
dest=Path.home()/'.config/systemd/user';dest.mkdir(parents=True,exist_ok=True)
for name,module in [('sensors','pi_gateway.app'),('camera','camera_service.app'),('dashboard','dashboard_service.app')]:
    text=f'''[Unit]
Description=Single vehicle prototype {name}
After=network.target
[Service]
Type=simple
WorkingDirectory={root}
ExecStart="{venv}/bin/python" -m {module}
Environment=PYTHONUNBUFFERED=1
Restart=on-failure
RestartSec=3
TimeoutStopSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=prototype-{name}
LogRateLimitIntervalSec=30s
LogRateLimitBurst=30
[Install]
WantedBy=default.target
'''
    (dest/f'prototype-{name}.service').write_text(text)
    (root/'systemd'/f'prototype-{name}.service').write_text(text)
subprocess.run(['systemctl','--user','daemon-reload'],check=True)
