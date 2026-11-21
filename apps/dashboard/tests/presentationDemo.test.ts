import test from 'node:test';
import assert from 'node:assert/strict';
import {demoSnapshot} from '../src/services/presentationDemo';
import {normalizedQuaternion} from '../src/services/truckOrientation';
import {processPi} from '../src/services/liveProcessing';
test('synthetic scenarios identify themselves and suppress face results on missing face/link loss',()=>{
 const now=Date.now();
 for(const scenario of ['normal','drowsy','critical','no_face','offline'] as const) {
   const p=demoSnapshot(now,scenario);
   assert.equal(p.is_simulated,true);
   assert.ok(normalizedQuaternion(p.canonical.imu.quaternion));
   assert.ok(Math.abs(Math.hypot(...Object.values(p.canonical.imu.quaternion))-1)<1e-10);
   if(scenario==='no_face'||scenario==='offline')assert.equal(p.camera.results,null);
   if(scenario==='critical')assert.equal(p.camera.results?.fatigue_state,'CRITICAL');
   if(scenario==='offline'){const state=processPi(p,now);assert.equal(state.online,false);assert.equal(state.imuReady,false);assert.equal(state.gpsReady,false);}
 }
});
