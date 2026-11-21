"""Check real authenticated receiver state without printing coordinates or secrets."""
from pathlib import Path
import json,time
import httpx
ROOT=Path(__file__).resolve().parents[1]
env=dict(line.split('=',1) for line in (ROOT/'.env').read_text(encoding='utf-8-sig').splitlines() if '=' in line and not line.startswith('#'))
base='http://127.0.0.1:'+env.get('PORT','3000')+env.get('APP_BASE_PATH','/truck-tracking')
with httpx.Client(timeout=5) as client:
    login=client.post(base+'/login',data={'password':env['BROWSER_PASSWORD']})
    if login.status_code!=302:raise SystemExit('Dashboard authentication failed.')
    for attempt in range(30):
        response=client.get(base+'/api/pi/latest');response.raise_for_status();latest=response.json().get('latest')
        if latest and latest.get('transport_status')=='connected':break
        time.sleep(1)
    else:raise SystemExit('No fresh Pi telemetry reached laptop. Check bridge and internet; GPS pairing alone cannot start sensors.')
    first=latest.get('sequence_id');time.sleep(2)
    response=client.get(base+'/api/pi/latest');response.raise_for_status();latest=response.json().get('latest') or {}
    advancing=latest.get('transport_status')=='connected' and latest.get('sequence_id')!=first
    summary={'telemetry_advancing':advancing,'imu':latest.get('imu',{}).get('status'),'ultrasonic':latest.get('fuel',{}).get('status'),'rfid':latest.get('rfid',{}).get('status'),'camera':latest.get('camera',{}).get('status'),'gps':latest.get('gps',{}).get('status')}
    (ROOT/'.private/last-demo-check.json').write_text(json.dumps(summary,indent=2),encoding='utf-8')
    print('Live receiver check: '+json.dumps(summary))
    if not advancing:raise SystemExit('Pi sequence did not advance; live update check failed.')
    if summary['imu']!='connected' or summary['ultrasonic']!='connected':print('ATTENTION: sensor unavailable. Check wiring/power; a launcher cannot repair disconnected hardware.')
    if summary['gps']!='ok':print('GPS needs the phone: scan current pairing QR, enable precise location, press Start outdoors and leave sharing on.')
