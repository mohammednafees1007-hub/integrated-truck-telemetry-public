"""Commissioning must not pass merely because processes/readers are running."""
import importlib.util,json,tempfile,unittest,datetime
from pathlib import Path
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('startup_status',Path(__file__).resolve().parents[1]/'scripts/startup-status.py')
status=importlib.util.module_from_spec(spec);spec.loader.exec_module(status)
class Reply:
 def __init__(self,value=None,code=200,content=b''):self.value=value;self.status_code=code;self.content=content;self.is_success=200<=code<300
 def json(self):return self.value
 def raise_for_status(self):
  if not self.is_success:raise RuntimeError('HTTP failed')
class Client:
 def __init__(self,packet):self.packet=packet;self.calls=0
 def __enter__(self):return self
 def __exit__(self,*args):pass
 def post(self,*a,**k):return Reply(code=302)
 def get(self,url):
  if url.endswith('/api/pi/latest'):
   self.calls+=1;return Reply({'latest':{**self.packet,'sequence_id':self.calls}})
  if url.endswith('/api/camera/latest'):return Reply(content=b'\xff\xd8fixture\xff\xd9')
  return Reply({'mode':'synthetic'})
class Commissioning(unittest.TestCase):
 def packet(self):return {'transport_status':'connected','imu':{'status':'connected'},'fuel':{'status':'connected'},'gps':{'status':'ok'},'rfid':{'status':'ok','card_id':'TEST','last_scan_timestamp':datetime.datetime.now(datetime.timezone.utc).isoformat()},'camera':{'status':'ok','face_detected':True,'results':{'fatigue_score':10}}}
 def collect(self,p):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);(root/'.env').write_text('BROWSER_PASSWORD=fixture\n')
   with patch.object(status,'ROOT',root),patch.object(status.httpx,'Client',return_value=Client(p)),patch.object(status.time,'sleep'):
    return status.collect()
 def test_complete_ready(self):self.assertTrue(self.collect(self.packet())['all_ready'])
 def test_reader_without_recent_scan_waits(self):
  p=self.packet();p['rfid']['last_scan_timestamp']='2000-01-01T00:00:00Z';r=self.collect(p)
  self.assertTrue(r['checks']['RFID reader']);self.assertFalse(r['checks']['Recent RFID card scan']);self.assertFalse(r['all_ready'])
 def test_no_face_has_camera_but_no_ready_results(self):
  p=self.packet();p['camera']={'status':'no_face','face_detected':False,'results':None};r=self.collect(p)
  self.assertTrue(r['checks']['Camera frames']);self.assertFalse(r['checks']['Face and model results']);self.assertFalse(r['all_ready'])
 def test_stale_gps_never_passes(self):
  p=self.packet();p['gps']['status']='stale';self.assertFalse(self.collect(p)['all_ready'])
 def test_disconnected_imu_never_passes(self):
  p=self.packet();p['imu']['status']='disconnected';self.assertFalse(self.collect(p)['all_ready'])
if __name__=='__main__':unittest.main()
