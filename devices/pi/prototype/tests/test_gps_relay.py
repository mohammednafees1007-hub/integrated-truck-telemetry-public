"""Isolated relay checks: synthetic fixtures never reach the running Pi gateway."""
import asyncio, hashlib, json, os, shutil, socket, subprocess, time
from pathlib import Path
from datetime import datetime, timezone
import httpx
import pytest
from gps_internet.relay_worker import RelayWorker
ROOT=Path(__file__).resolve().parents[1]
PHONE='a'*43; PI='b'*43
@pytest.fixture
def relay(tmp_path):
 host=ROOT/'android_app/tools/host';php=host/'usr/bin/php8.4'
 if not php.exists():pytest.skip('Local PHP toolchain absent')
 web=tmp_path/'public_html';target=web/'pi-gps';shutil.copytree(ROOT/'gps_relay/upload/pi-gps',target)
 (target/'config.php').write_text("<?php\nif (!defined('PIGPS_INTERNAL')) exit;\n"+''.join("define('%s','%s');\n"%(k,v) for k,v in {'GPS_PHONE_HASH':hashlib.sha256(PHONE.encode()).hexdigest(),'GPS_PI_HASH':hashlib.sha256(PI.encode()).hexdigest(),'GPS_STORAGE_NAME':'test-private'}.items()))
 with socket.socket() as s:s.bind(('127.0.0.1',0));port=s.getsockname()[1]
 env=os.environ.copy();env['LD_LIBRARY_PATH']=str(host/'usr/lib/aarch64-linux-gnu')
 proc=subprocess.Popen([str(php),'-n','-S',f'127.0.0.1:{port}','-t',str(web)],env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 base=f'http://127.0.0.1:{port}/pi-gps'
 try:
  for _ in range(100):
   try:
    if httpx.get(base+'/health.php').status_code==200:break
   except httpx.ConnectError:pass
   time.sleep(.03)
  else:raise RuntimeError('PHP server did not start')
  yield base,tmp_path
 finally:proc.terminate();proc.wait(timeout=5)
def fixture_fix():return dict(latitude=12.3,longitude=77.4,accuracy_m=4.0,timestamp=datetime.now(timezone.utc).isoformat(timespec='milliseconds'))
def test_hosting_relay(relay):
 base,tmp=relay;phone={'X-GPS-Key':PHONE};pi={'X-GPS-Key':PI};fix=fixture_fix()
 with httpx.Client() as c:
  assert c.post(base+'/ingest.php',json=fix).status_code==401
  assert c.get(base+'/latest.php',headers=phone).status_code==401
  assert c.post(base+'/ingest.php',headers=pi,json=fix).status_code==401
  assert c.post(base+'/ingest.php',headers=phone,json={**fix,'latitude':True}).status_code==422
  assert c.post(base+'/ingest.php',headers=phone,content='x'*4097).status_code==413
  assert c.post(base+'/ingest.php',headers=phone,json={**fix,'timestamp':'2099-01-01T00:00:00Z'}).status_code==409
  receipt=c.post(base+'/ingest.php',headers=phone,json=fix).json();assert receipt['accepted'] and receipt['pi_last_ack_timestamp'] is None
  assert c.post(base+'/ingest.php',headers=phone,json=fix).json()['accepted'] is False
  assert c.post(base+'/ingest.php',headers=phone,json={**fix,'timestamp':'2001-01-01T00:00:00Z'}).status_code==409
  latest=c.get(base+'/latest.php',headers=pi).json();assert latest['seq']==1 and latest['fix']['latitude']==fix['latitude']
  ack={'stream_id':latest['stream_id'],'seq':latest['seq']}
  assert c.post(base+'/ack.php',headers=phone,json=ack).status_code==401
  assert c.post(base+'/ack.php',headers=pi,json={**ack,'seq':2}).status_code==409
  assert c.post(base+'/ack.php',headers=pi,json=ack).json()['acknowledged']
  status=c.get(base+'/status.php',headers=phone).json();assert status['pi_last_ack_seq']==1 and 'fix' not in status
  private=tmp/'test-private/latest.json';assert private.exists() and private.stat().st_mode&0o777==0o600
@pytest.mark.parametrize('reject',[False,True])
def test_worker_receipt_and_rejection(relay,reject):
 base,_=relay;fix=fixture_fix();httpx.post(base+'/ingest.php',headers={'X-GPS-Key':PHONE},json=fix).raise_for_status();calls=[]
 async def run():
  async with httpx.AsyncClient() as network:
   async def dispatch(request):
    if request.url.host=='isolated-gateway':
     calls.append(json.loads(request.content));return httpx.Response(409 if reject else 200,json={'accepted':True})
    return await network.send(request)
   async with httpx.AsyncClient(transport=httpx.MockTransport(dispatch)) as client:
    worker=RelayWorker(base,PI,'http://isolated-gateway');await worker.step(client);await worker.step(client)
    assert worker.status['acknowledged']==(0 if reject else 1)
 asyncio.run(run());assert len(calls)==1 and datetime.fromisoformat(calls[0]['timestamp'])==datetime.fromisoformat(fix['timestamp'])
 status=httpx.get(base+'/status.php',headers={'X-GPS-Key':PHONE}).json();assert (status['pi_last_ack_seq'] is None)==reject
