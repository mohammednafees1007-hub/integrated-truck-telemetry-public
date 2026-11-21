import copy,json,math,time
from datetime import datetime,timezone,timedelta
import pytest,yaml
from pathlib import Path
from fastapi.testclient import TestClient
from pi_gateway.state import State,validate_frame
from pi_gateway.serial_reader import Lines
from pi_gateway.gps_ingest import GPSFix

@pytest.fixture
def state():return State(yaml.safe_load(Path('config.example.yaml').read_text()))
@pytest.fixture
def frame():
 return dict(v=1,boot='test',seq=1,t_us=1000000,imu=dict(a=[0.,0.,0.],g=[0.,0.,0.],q=[1.,0.,0.,0.],n=[1,1,1],us=[990000]*3,s=[0,0,0],state='ok'),us=dict(mm=100,echo_us=None,n=1,t_us=900000,state='ok'),rfid=dict(uid='AABBCCDD',event=1,t_us=800000,state='ok'))
def test_line_boundaries():
 p=Lines(8);assert p.feed(b'{"a":')==[];assert p.feed(b'1}\n{}\n')==[b'{"a":1}',b'{}']
 assert p.feed(b'x'*9000+b'\n{}\n')==[b'{}'];assert len(p.buf)==0;assert p.oversized==1
@pytest.mark.parametrize('bad',[float('nan'),float('inf'),True,'1'])
def test_nonfinite(frame,bad):
 frame['imu']['a'][0]=bad
 with pytest.raises(ValueError):validate_frame(frame)
def test_quaternion(frame):
 frame['imu']['q']=[0.,0.,0.,0.]
 with pytest.raises(ValueError):validate_frame(frame)
def test_duplicate_restart_and_held(state,frame):
 state.connected=True;assert state.ingest(frame);a=state.snapshot()
 assert not state.ingest(frame)
 frame['seq']=2;frame['t_us']+=20000;assert state.ingest(frame);b=state.snapshot()
 assert a['imu']['received_at']==b['imu']['received_at']
 assert a['rfid']['last_scan_timestamp']==b['rfid']['last_scan_timestamp']
 assert a['ultrasonic']['received_at']==b['ultrasonic']['received_at']
 frame['boot']='new';frame['seq']=0;assert state.ingest(frame);assert state.metrics['restarts']==1
 assert state.snapshot()['source']['esp_boot_id']=='new'
def test_waiting_and_disconnected(state):
 a=state.snapshot();assert a['imu']['lin_accel_x'] is None
 assert a['imu']['quaternion']['w'] is None
 assert a['gps']['latitude'] is None
 assert 'fatigue' not in a
 assert a['imu']['status']=='disconnected'
def test_held_stale(state,frame):
 state.connected=True;state.ingest(frame);state.marks['linear']-=1
 assert state.snapshot()['imu']['status']=='stale'
def test_invalid_metadata(frame):
 frame['imu']['us'][0]=None
 with pytest.raises((ValueError,TypeError)):validate_frame(frame)
def test_gps(state):
 d=dict(latitude=12.1,longitude=77.1,accuracy_m=4.,timestamp=datetime.now(timezone.utc).isoformat())
 d=GPSFix(**d).model_dump();assert state.add_gps(d);before=state.snapshot()['gps']['received_at']
 assert not state.add_gps(d);assert state.snapshot()['gps']['received_at']==before
 d['timestamp']='2020-01-01T00:00:00.000Z'
 with pytest.raises(ValueError):state.add_gps(d)
 state.gps=None;assert state.add_gps(d);assert state.snapshot()['gps']['status']=='stale'
def test_endpoint(monkeypatch):
 import asyncio,importlib
 module=importlib.import_module('pi_gateway.app');app=module.app
 async def idle(*args):await asyncio.Event().wait()
 monkeypatch.setattr(module,'read_serial',idle)
 with TestClient(app) as c:
  assert c.get('/health').status_code==200
  assert c.post('/api/v1/gps',json={'latitude':91.,'longitude':1.,'accuracy_m':4.,'timestamp':'2026-10-17T12:00:00Z'}).status_code==422
  assert c.post('/api/v1/gps',content=b'x'*5000).status_code==413
  assert c.get('/health',headers={'Origin':'https://unauthorized.example'}).status_code==403
  p=dict(latitude=1.,longitude=2.,accuracy_m=3.,timestamp=datetime.now(timezone.utc).isoformat())
  assert c.post('/api/v1/gps',json=p).status_code==200
  assert c.post('/api/v1/gps',json=p).json()['accepted'] is False
  with c.websocket_connect('/ws/sensors') as ws:
   a=ws.receive_json();b=ws.receive_json();assert b['seq']>a['seq']
def test_schemas(state,frame):
 import jsonschema
 jsonschema.validate(frame,json.loads(Path('schemas/serial-v1.json').read_text()))
 jsonschema.validate(state.snapshot(),json.loads(Path('schemas/sensors-v1.json').read_text()))
 state.ingest(frame)
 jsonschema.validate(state.snapshot(),json.loads(Path('schemas/sensors-v1.json').read_text()))
def test_gpslogger_encoded_time():
 from pi_gateway.gps_ingest import GPSLoggerFix
 from urllib.parse import quote
 d=GPSLoggerFix(latitude=1.,longitude=2.,accuracy_m=3.,timestamp=quote('2026-10-17T10:20:30.000Z'))
 assert d.timestamp=='2026-10-17T10:20:30.000Z'

def test_real_serial_parser_isolated_pty(state,frame):
 import os,pty,asyncio
 from pi_gateway.serial_reader import read_serial
 async def run():
  master,slave=pty.openpty();config=dict(serial_port=os.ttyname(slave),baud=921600)
  task=asyncio.create_task(read_serial(state,config))
  try:
   await asyncio.sleep(.02)
   raw=json.dumps(frame).encode()+b'\n'
   os.write(master,b'invalid json\n'+json.dumps({'v':1,'type':'diagnostic','rfid_version':146}).encode()+b'\n'+b'x'*3000+b'\n'+raw[:25])
   await asyncio.sleep(.01);os.write(master,raw[25:])
   await asyncio.sleep(.05)
   assert state.metrics['serial_frames']==1
   assert state.metrics['invalid']==1
   assert state.metrics['oversized']==1
   assert state.metrics['esp_diagnostic']['rfid_version']==146
   assert state.snapshot()['ultrasonic']['distance_mm']==100
  finally:
   task.cancel()
   try:await task
   except asyncio.CancelledError:pass
   os.close(master);os.close(slave)
 asyncio.run(run())
def test_future_gps_rejected_without_poisoning(state):
 d=dict(latitude=1.,longitude=2.,accuracy_m=3.,timestamp=(datetime.now(timezone.utc)+timedelta(minutes=10)).isoformat())
 with pytest.raises(ValueError):state.add_gps(d)
 assert state.gps is None
 assert state.metrics['gps_clock_skew'] is True
