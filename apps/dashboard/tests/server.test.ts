import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
process.env.TEST_MODE='1';
const {createApp}=await import('../server');
const {packet}=await import('./fixtures');
test('HTTP boundaries: browser session, machine scope, retired boots, persistence and legacy route closure',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'truck-http-test-'));
  const env:any={DATA_DIR:root,APP_BASE_PATH:'/truck-tracking'};
  for(const k of ['PHONE_WRITE_KEY','PI_DEVICE_KEY','PI_READER_KEY','BROWSER_PASSWORD','SESSION_SECRET'])env[k]=crypto.randomBytes(32).toString('base64url');
  const server=createApp(env).listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
  const origin=`http://127.0.0.1:${(server.address() as any).port}`,base=origin+'/truck-tracking';
  const req=(url:string,options:any={})=>fetch(base+url,{redirect:'manual',...options});
  try {
    assert.equal((await req('/')).status,302);
    for(const route of ['/api/pi/latest','/api/sensors/latest','/api/sensors/history','/api/camera/latest','/api/setup','/api/drivers'])assert.equal((await req(route)).status,401);
    assert.equal((await fetch(origin+'/api/gps',{method:'POST'})).status,404);
    assert.equal((await req('/pi-gps/latest.php',{headers:{'X-GPS-Key':env.PHONE_WRITE_KEY}})).status,401);
    assert.equal((await req('/pi-gps/ingest.php',{method:'POST',headers:{'X-GPS-Key':env.PI_READER_KEY}})).status,401);
    const post={method:'POST',headers:{'X-GPS-Key':env.PHONE_WRITE_KEY,'Content-Type':'application/json'}};
    assert.equal((await req('/pi-gps/ingest.php',{...post,body:'{broken'})).status,400);
    assert.equal((await req('/pi-gps/ingest.php',{...post,body:JSON.stringify({padding:'x'.repeat(5000)})})).status,413);
    const f={latitude:12,longitude:77,accuracy_m:4,timestamp:new Date().toISOString()};
    const accepted=await (await req('/pi-gps/ingest.php',{...post,body:JSON.stringify(f)})).json();assert.equal(accepted.accepted,true);assert.equal(accepted.pi_last_ack_seq,null);
    const logged=await req('/login',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({password:env.BROWSER_PASSWORD})});
    assert.equal(logged.status,302);const cookie=logged.headers.get('set-cookie')!.split(';')[0];assert.match(logged.headers.get('set-cookie')!,/HttpOnly/);
    const browser={Cookie:cookie,Origin:origin,'Content-Type':'application/json'};
    assert.equal((await req('/api/pi/latest',{headers:browser})).status,200);
    assert.equal((await req('/api/model/toggle',{method:'POST',headers:browser,body:'{}'})).status,404);
    for(const route of ['/api/gps','/api/sensors/gps','/api/sensors/telemetry'])assert.equal((await req(route,{method:'POST',headers:browser,body:'{}'})).status,404);
    assert.equal((await req('/api/drivers',{method:'PUT',headers:{...browser,Origin:'https://evil.example'},body:'[]'})).status,403);
    const p=packet(),piPost={method:'POST',headers:{'X-Device-Token':env.PI_DEVICE_KEY,'Content-Type':'application/json'}};
    assert.equal((await req('/api/pi/telemetry',{...piPost,body:JSON.stringify(p)})).status,200);
    assert.equal((await req('/api/pi/telemetry',{...piPost,body:JSON.stringify(p)})).status,409);
    p.bridge_boot_id='new-bridge-boot';assert.equal((await req('/api/pi/telemetry',{...piPost,body:JSON.stringify(p)})).status,200);
    p.bridge_boot_id='bridge-boot-001';p.bridge_seq=2;assert.equal((await req('/api/pi/telemetry',{...piPost,body:JSON.stringify(p)})).status,409);
    assert.equal((await req('/api/camera/latest',{headers:browser})).status,503);
    const drivers=[{id:'real',name:'Real test driver',rfidId:'AAAAAAAA'}];
    assert.equal((await req('/api/drivers',{method:'PUT',headers:browser,body:JSON.stringify(drivers)})).status,200);
    assert.deepEqual(await (await req('/api/drivers',{headers:browser})).json(),drivers);
    const operations={areaGeofences:[{id:'zone',coordinates:[{lat:12,lng:77}]}],alertHistory:[],refuelEvents:[]};
    assert.equal((await req('/api/settings',{method:'PUT',headers:browser,body:JSON.stringify({dashboard:{speedUnit:'kmh'}})})).status,200);
    assert.equal((await req('/api/settings',{method:'PUT',headers:browser,body:JSON.stringify({operations})})).status,200);
    const saved=await(await req('/api/settings',{headers:browser})).json();assert.deepEqual(saved.operations,operations);assert.equal(saved.dashboard.speedUnit,'kmh');
    const second=createApp(env).listen(0,'127.0.0.1');await new Promise<void>(r=>second.once('listening',r));
    const restartBase=`http://127.0.0.1:${(second.address() as any).port}/truck-tracking`;
    try {
      assert.deepEqual(await (await fetch(restartBase+'/api/drivers',{headers:browser})).json(),drivers);
      assert.deepEqual((await(await fetch(restartBase+'/api/settings',{headers:browser})).json()).operations,operations);
      const latest=await (await fetch(restartBase+'/pi-gps/latest.php',{headers:{'X-GPS-Key':env.PI_READER_KEY}})).json();assert.equal(latest.seq,1);
    } finally {await new Promise<void>(r=>second.close(()=>r()));}
  } finally {await new Promise<void>(r=>server.close(()=>r()));fs.rmSync(root,{recursive:true});}
});
