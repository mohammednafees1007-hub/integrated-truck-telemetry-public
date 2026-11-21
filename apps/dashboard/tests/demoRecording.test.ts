import test from 'node:test';
import assert from 'node:assert/strict';
import {BUILT_IN_SESSION,validateSession,eventAt} from '../src/services/demoRecording';
import {demoSnapshot,setDemoClock} from '../src/services/presentationDemo';
test('prepared replay covers all nine tabs with explicit missing-data cases and ordered timing',()=>{
 const session=validateSession(BUILT_IN_SESSION);
 assert.equal(new Set(session.events.map(e=>e.tab)).size,9);
 assert.ok(session.events.some(e=>e.scenario==='no_face'));
 assert.ok(session.events.some(e=>e.scenario==='offline'));
 assert.equal(eventAt(session,70000),7);
 assert.equal(eventAt(session,session.durationMs),session.events.length-1);
});
test('session import strips unrelated data and rejects invalid size timing modes and schema',()=>{
 assert.throws(()=>validateSession({...BUILT_IN_SESSION,synthetic:false}));
 assert.throws(()=>validateSession({...BUILT_IN_SESSION,durationMs:Infinity}));
 assert.throws(()=>validateSession({...BUILT_IN_SESSION,events:[{...BUILT_IN_SESSION.events[0],atMs:10}]}));
 assert.throws(()=>validateSession({...BUILT_IN_SESSION,events:[{...BUILT_IN_SESSION.events[0],tab:'unsafe'}]}));
 const cleaned=validateSession({...BUILT_IN_SESSION,password:'never saved',events:BUILT_IN_SESSION.events.map(e=>({...e,latitude:'not a recorded field'}))});
 assert.equal('password' in cleaned,false);assert.equal('latitude' in cleaned.events[0],false);
});
test('replay clock reproduces motion while preserving current synthetic receipt freshness',()=>{
 setDemoClock(45678);const first=demoSnapshot(1000000),second=demoSnapshot(2000000);
 assert.deepEqual(first.canonical.imu.quaternion,second.canonical.imu.quaternion);
 assert.notEqual(first.received_at,second.received_at);
 setDemoClock(56789);assert.notDeepEqual(first.canonical.imu.quaternion,demoSnapshot().canonical.imu.quaternion);
 setDemoClock(null);
});
