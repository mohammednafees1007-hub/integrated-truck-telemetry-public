import {packet} from './fixtures';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Relay, gpsFix} from '../backend/relay';
import {adaptPi,euler,validatePi} from '../backend/pi';
const dir=()=>fs.mkdtempSync(path.join(os.tmpdir(),'truck-relay-test-'));
const fix=(time:number)=>({latitude:12,longitude:77,accuracy_m:4,timestamp:new Date(time).toISOString()});
test('strict GPS fields, numbers, range, timezone and future checks',()=>{
  const now=Date.now();assert.deepEqual(gpsFix(fix(now)),fix(now));
  for(const bad of [{...fix(now),extra:true},{...fix(now),latitude:'12'},{...fix(now),latitude:91},{...fix(now),longitude:181},{...fix(now),accuracy_m:-1},{...fix(now),latitude:NaN},{...fix(now),timestamp:'2026-10-18T12:00:00'},{...fix(now),timestamp:'2026-02-30T12:00:00Z'},{...fix(now),timestamp:'bad'},fix(now+6000)]) assert.throws(()=>gpsFix(bad,now));
});
test('latest-only persistence, duplicate timestamps and monotonic ACK races',()=>{
  const root=dir(),file=path.join(root,'relay.json'),now=Date.now(),r=new Relay(file);
  assert.equal(r.latest().fix,null);
  assert.equal(r.ingest(fix(now),now).accepted,true);
  const stamp=r.state.relay_received_at;
  assert.equal(r.ingest(fix(now),now+100).accepted,false);
  assert.equal(r.state.seq,1);assert.equal(r.state.relay_received_at,stamp);
  assert.throws(()=>r.ingest({...fix(now),latitude:13},now+100));assert.throws(()=>r.ingest(fix(now-1),now));
  assert.equal(r.info().pi_last_ack_timestamp,null);
  r.ingest(fix(now+1000),now+1000);
  // N was accepted by Pi while N+1 arrived: ACK N is still valid.
  assert.equal(r.ack({stream_id:r.state.stream_id,seq:1},now+1100).pi_last_ack_seq,1);
  const ackTime=r.info().pi_last_ack_timestamp;
  r.ack({stream_id:r.state.stream_id,seq:1},now+1200);assert.equal(r.info().pi_last_ack_timestamp,ackTime);
  r.ack({stream_id:r.state.stream_id,seq:2},now+1300);
  for(const bad of [{stream_id:'bad',seq:2},{stream_id:r.state.stream_id,seq:3},{stream_id:r.state.stream_id,seq:0},{stream_id:r.state.stream_id,seq:1},{stream_id:r.state.stream_id,seq:2,x:1}])assert.throws(()=>r.ack(bad));
  const restarted=new Relay(file);assert.deepEqual(restarted.state,r.state);assert.equal(restarted.latest().seq,2);
  fs.rmSync(root,{recursive:true});
});
test('canonical units, null unknowns, real UID mapping and stale sources despite heartbeat',()=>{
  const now=Date.now(),p=packet(now);validatePi(p);
  const d=[{id:'ganash',name:'ganash',rfidId:'A1B2C3D4'}];
  const a=adaptPi(p,new Date(now).toISOString(),d,now)!;
  assert.equal(a.imu.accel_x,null);assert.equal(a.imu.lin_accel_x,1);assert.equal(a.imu.gyro_x,180/Math.PI);
  assert.equal(a.imu.roll,0);assert.equal(a.fuel.distance_cm,17.15);assert.equal(a.fuel.volume_litres,null);assert.equal(a.fuel.level_percent,null);
  assert.equal(a.rfid.driver_name,'ganash');assert.equal(a.rfid.identification_only,true);assert.equal(a.gps.speed_kmh,null);assert.equal(a.gps.satellites,null);assert.equal(a.fatigue.state,'UNAVAILABLE');assert.equal(a.fatigue.score,null);
  p.bridge_sent_at=new Date(now+12000).toISOString();
  const stale=adaptPi(p,new Date(now+12000).toISOString(),d,now+12000)!;
  assert.equal(stale.transport_status,'connected');assert.equal(stale.imu.lin_accel_x,null);assert.equal(stale.gps.latitude,null);assert.equal(stale.fuel.distance_cm,null);
  const offline=adaptPi(p,new Date(now).toISOString(),d,now+4000)!;assert.equal(offline.transport_status,'disconnected');
  p.sensors.rfid.card_id='AAAAAAAA';assert.equal(adaptPi(p,new Date(now).toISOString(),d,now)!.rfid.driver_name,null);
  assert.equal(euler({w:0,x:0,y:0,z:0}).roll,null);
  p.camera.results={fatigue_score:0};assert.throws(()=>validatePi(p));
});

test('Pi-local freshness tolerates clock offset while preserving source age and failure status',()=>{
 const now=Date.now(),p=packet(now-2500);const stamp=new Date(now).toISOString();
 const live=adaptPi(p,stamp,[],now)!;assert.equal(live.imu.status,'connected');assert.equal(live.fuel.distance_cm,17.15);
 p.sensors.imu.status='disconnected';p.gateway_health={source_rates_hz:{linear:50,gyro:50,rotation:50,ultrasonic:10}};
 const failed=adaptPi(p,stamp,[],now)!;assert.equal(failed.imu.status,'disconnected');assert.equal(failed.gateway_health.source_rates_hz.linear,null);assert.equal(failed.gateway_health.source_rates_hz.ultrasonic,10);
 p.bridge_sent_at=new Date(now+3000).toISOString();assert.equal(adaptPi(p,new Date(now+5500).toISOString(),[],now+5500)!.fuel.distance_cm,null);
});
