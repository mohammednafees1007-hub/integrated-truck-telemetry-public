import test from 'node:test';
import assert from 'node:assert/strict';
import {observePiSnapshot,piFreshness} from '../src/services/piFreshness';
import {processPi} from '../src/services/liveProcessing';

function snapshot(){return {received_at:'2026-10-27T03:00:00.000Z',transport_status:'connected',source_age_at_receipt_ms:{camera:200,imu:40,ultrasonic:100,gps:null},camera:{status:'no_face',face_detected:false,results:null},imu:{status:'connected'},fuel:{status:'connected'},gps:{status:'stale'},rfid:{status:'ok'}};}
test('observed server-validated camera state survives browser clock skew without changing timestamps',()=>{
 const p=snapshot(),timestamp=p.received_at;observePiSnapshot(p,200,1000);
 for(const skew of [-120000,2200,600000]){
  const state=piFreshness(p,Date.parse(timestamp)+skew,1100);
  assert.equal(state.cameraReady,true);assert.equal(state.online,true);assert.equal(state.sourceAge('camera'),500);
 }
 assert.equal(p.received_at,timestamp);assert.equal(p.camera.results,null);
});
test('older receiver snapshots expire locally and long requests never masquerade as fresh',()=>{
 const p=observePiSnapshot(snapshot(),200,1000);
 assert.equal(piFreshness(p,0,1801).online,false);
 assert.equal(piFreshness(observePiSnapshot(snapshot(),1001,1000),0,1000).cameraReady,false);
});
test('server-disconnected and unavailable camera states stay unavailable even on a newly received snapshot',()=>{
 const p=snapshot();p.transport_status='disconnected';observePiSnapshot(p,0,1000);
 assert.equal(piFreshness(p,0,1000).online,false);
 p.transport_status='connected';p.camera.status='unavailable';
 assert.equal(piFreshness(p,0,1000).cameraReady,false);
});
test('precise server response ages retain the two-second camera expiry independently of wall clocks',()=>{
 const p={...snapshot(),transport_age_at_response_ms:100,source_age_at_response_ms:{camera:1700,imu:140,ultrasonic:200,gps:null}};
 observePiSnapshot(p,100,1000);
 assert.equal(piFreshness(p,0,1100).cameraReady,true);
 assert.equal(piFreshness(p,0,1200).cameraReady,false);
});
test('unobserved historical snapshots retain absolute-age checks and never become live on replay',()=>{
 const p=snapshot(),now=Date.parse(p.received_at);
 assert.equal(processPi(p,now).cameraReady,true);
 assert.equal(processPi(p,now+11000).online,false);
});
