import test from 'node:test';
import assert from 'node:assert/strict';
import {processPi,piVehicle,insideArea,routeDistance,evaluateGeofences} from '../src/services/liveProcessing';
import {adaptPi} from '../backend/pi';
import {packet} from './fixtures';
test('operational readings use source freshness and never invent fuel, speed or ignition',()=>{
 const now=Date.now(),p=adaptPi(packet(now),new Date(now).toISOString(),[{id:'d',name:'Test driver',rfidId:'A1B2C3D4'}],now);
 const v=piVehicle(p,now);assert.equal(v.telemetryOnline,true);assert.equal(v.gpsStatus,'recent');assert.equal(v.ultrasonicDistanceCm,17.15);assert.equal(v.assignedDriverName,'Test driver');
 for(const key of ['currentSpeed','ignition','fuelLevel','currentFuelLiters','mileage'] as const)assert.equal(v[key],null);
 const stale=piVehicle(p,now+11000);assert.equal(stale.telemetryOnline,false);assert.equal(stale.ultrasonicDistanceCm,null);assert.equal(stale.gpsStatus,'stale');assert.equal(stale.coordinates.lat,12);assert.match(stale.lastKnownLocation,/stale/);
 const failed=structuredClone(p);failed.imu.status='disconnected';assert.equal(processPi(failed,now).imuReady,false);
});
test('fresh assigned GPS evaluates polygon, circle and route; stale GPS never triggers',()=>{
 const now=Date.now(),v=piVehicle(adaptPi(packet(now),new Date(now).toISOString(),[],now),now);
 const base={id:'area',name:'Test',type:'area',enabled:true,assignedVehicleIds:['test'],alertOnEnter:true,alertOnExit:true,color:'#fff',createdAt:'today'};
 const polygon:any={...base,shapeType:'polygon',coordinates:[{lat:11.99,lng:76.99},{lat:12.01,lng:76.99},{lat:12.01,lng:77.01},{lat:11.99,lng:77.01}]};
 const circle:any={...base,id:'circle',shapeType:'circle',coordinates:[],center:{lat:12,lng:77},radius:100};
 assert.equal(insideArea({lat:12,lng:77},polygon),true);assert.equal(insideArea({lat:12.1,lng:77},polygon),false);assert.equal(insideArea({lat:12.001,lng:77},circle),false);
 const route:any={...base,id:'route',type:'route',startLocation:{lat:11.99,lng:77},endLocation:{lat:12.01,lng:77},waypoints:[],corridorWidthMeters:50};
 assert.ok(routeDistance({lat:12,lng:77},route)<.01);assert.ok(routeDistance({lat:12,lng:77.001},route)>100);
 assert.equal(evaluateGeofences(v,[polygon,circle],[route]).length,3);
 assert.equal(evaluateGeofences({...v,gpsStatus:'stale'},[polygon],[route]).length,0);
 assert.equal(evaluateGeofences(v,[{...polygon,enabled:false}],[{...route,assignedVehicleIds:[]}]).length,0);
});
