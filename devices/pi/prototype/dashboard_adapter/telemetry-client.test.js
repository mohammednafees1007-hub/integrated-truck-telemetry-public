import {test} from 'node:test';
import assert from 'node:assert/strict';
import {deriveSnapshot,SessionRoute} from './telemetry-client.js';
test('water stays unconfigured; driver never gates collection',()=>{
 const p={imu:{status:'waiting',quaternion:{w:null,x:null,y:null,z:null}},ultrasonic:{status:'ok',distance_mm:200,echo_us:null},rfid:{card_id:null,last_scan_timestamp:null}};
 const d=deriveSnapshot(p);assert.equal(d.water.distance_mm,200);assert.equal(d.water.volume_l,null);assert.equal(d.orientation,null);assert.equal(d.driver.name,'Unknown driver');
});
test('repeated location never adds distance and gaps break segments',()=>{
 const route=new SessionRoute();const g={status:'ok',latitude:12,longitude:77,accuracy_m:4,timestamp:'2026-10-17T10:00:00Z'};
 route.update(g);assert.equal(route.update(g),null);
 route.update({...g,latitude:12.0003,timestamp:'2026-10-17T10:00:01Z'});assert(route.distance_m>30 && route.distance_m<35);
 const before=route.distance_m;
 route.update({...g,latitude:13,timestamp:'2026-10-17T10:01:00Z'});assert.equal(route.distance_m,before);
 route.update({...g,status:'stale'});assert.equal(route.previous,null);
});
