import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizedQuaternion,rotate,relativeOrientation,toScene,IDENTITY} from '../src/services/truckOrientation';
const near=(a:number,b:number)=>assert.ok(Math.abs(a-b)<1e-9,`${a} != ${b}`);
test('orientation normalizes valid quaternions and rejects missing or corrupt input',()=>{
 assert.equal(normalizedQuaternion(null),null);assert.equal(normalizedQuaternion({w:0,x:0,y:0,z:0}),null);assert.equal(normalizedQuaternion({w:NaN,x:0,y:0,z:0}),null);
 assert.deepEqual(normalizedQuaternion({w:1.1,x:0,y:0,z:0}),IDENTITY);
});
test('real 90 degree sensor turns rotate the truck axes correctly',()=>{
 const s=Math.SQRT1_2;
 const yaw=rotate([1,0,0],{w:s,x:0,y:0,z:s});near(yaw[0],0);near(yaw[1],1);
 const roll=rotate([0,1,0],{w:s,x:s,y:0,z:0});near(roll[1],0);near(roll[2],1);
 const pitch=rotate([1,0,0],{w:s,x:0,y:s,z:0});near(pitch[0],0);near(pitch[2],-1);
 assert.deepEqual(toScene([1,2,3]),[1,3,-2]);
});
test('level reference cancels current pose and opposite quaternion signs describe identical pose',()=>{
 const q={w:Math.SQRT1_2,x:0,y:0,z:Math.SQRT1_2};const r=relativeOrientation(q,q);
 near(r.w,1);near(r.x,0);near(r.y,0);near(r.z,0);
 const a=rotate([1,2,3],q),b=rotate([1,2,3],{w:-q.w,x:0,y:0,z:-q.z});a.forEach((v,i)=>near(v,b[i]));
});
