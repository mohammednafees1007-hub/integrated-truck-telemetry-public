#!/usr/bin/env python3
"""Run after the user uploads the generated pi-gps folder to their hosting."""
from pathlib import Path
import json,subprocess,sys
import httpx
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
from gps_internet.relay_worker import validate_config
p=ROOT/'gps_internet/relay-config.json';config=json.loads(p.read_text());validate_config(config)
try:
 with httpx.Client(timeout=15,follow_redirects=False) as c:
  health=c.get(config['base_url']+'/health.php');health.raise_for_status()
  if health.json().get('service')!='pi-gps-relay':raise ValueError('Expected PHP GPS relay, received a different page')
  check=c.get(config['base_url']+'/latest.php',headers={'X-GPS-Key':config['reader_token']});check.raise_for_status()
  if check.json().get('schema_version')!=1:raise ValueError('Relay schema mismatch')
except Exception as e:
 print('Relay is not ready. Upload pi-gps-upload.zip to public_html and extract it first.');print(type(e).__name__);sys.exit(1)
config['enabled']=True;p.write_text(json.dumps(config,indent=2)+'\n');p.chmod(0o600)
subprocess.run(['systemctl','--user','enable','--now','prototype-gps-relay.service'],check=True)
print('Internet GPS receiver activated on the Pi.')
