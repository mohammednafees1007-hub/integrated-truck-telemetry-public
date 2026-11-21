"""Read-only commissioning checks. Prints no credentials, names or coordinates."""
from pathlib import Path
import datetime,json,time
import httpx
ROOT=Path(__file__).resolve().parents[1]
def collect():
 env=dict(l.split('=',1) for l in (ROOT/'.env').read_text(encoding='utf-8-sig').splitlines() if '=' in l and not l.startswith('#'))
 base='http://127.0.0.1:'+env.get('PORT','3000')+env.get('APP_BASE_PATH','/truck-tracking')
 with httpx.Client(timeout=5) as c:
  login=c.post(base+'/login',data={'password':env['BROWSER_PASSWORD']})
  if login.status_code!=302:raise RuntimeError('Local sign-in check failed')
  first=c.get(base+'/api/pi/latest');first.raise_for_status();old=first.json().get('latest') or {};time.sleep(1.2)
  response=c.get(base+'/api/pi/latest');response.raise_for_status();body=response.json();p=body.get('latest') or {}
  advancing=p.get('transport_status')=='connected' and p.get('sequence_id')!=old.get('sequence_id')
  camera=p.get('camera') or {};rfid=p.get('rfid') or {};stamp=rfid.get('last_scan_timestamp')
  scan_age=None
  try:scan_age=max(0,(datetime.datetime.now(datetime.timezone.utc)-datetime.datetime.fromisoformat(stamp.replace('Z','+00:00'))).total_seconds())
  except (ValueError,TypeError,AttributeError):pass
  preview=c.get(base+'/api/camera/latest');jpeg=preview.status_code==200 and preview.content[:2]==b'\xff\xd8'
  try:d=c.get('http://127.0.0.1:3001/health');demo=d.is_success and d.json().get('mode')=='synthetic'
  except httpx.HTTPError:demo=False
  checks={'Laptop receiver':True,'Demo and replay site':demo,'Pi telemetry advancing':advancing,'IMU fresh':advancing and p.get('imu',{}).get('status')=='connected','Ultrasonic fresh':advancing and p.get('fuel',{}).get('status')=='connected','RFID reader':advancing and rfid.get('status')=='ok','Recent RFID card scan':advancing and bool(rfid.get('card_id')) and scan_age is not None and scan_age<300,'Camera frames':advancing and jpeg and camera.get('status') in ['ok','no_face'],'Face and model results':advancing and camera.get('status')=='ok' and camera.get('face_detected') is True and bool(camera.get('results')),'Fresh phone GPS on Pi':advancing and p.get('gps',{}).get('status')=='ok'}
  info={'camera_status':camera.get('status','waiting'),'gps_status':p.get('gps',{}).get('status','waiting'),'imu_status':p.get('imu',{}).get('status','waiting'),'rfid_scan_age_s':round(scan_age,1) if scan_age is not None else None}
  return {'checks':checks,'info':info,'all_ready':all(checks.values()),'checked_at':datetime.datetime.now(datetime.timezone.utc).isoformat()}
if __name__=='__main__':
 try:
  result=collect();(ROOT/'.private/startup-check.json').write_text(json.dumps(result,indent=2),encoding='utf-8');print(json.dumps(result))
 except Exception as exc:
  print(json.dumps({'all_ready':False,'checks':{},'error':type(exc).__name__+': local receiver check unavailable'}));raise SystemExit(1)
