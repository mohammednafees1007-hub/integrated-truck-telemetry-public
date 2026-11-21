import type {AreaGeofence,RouteGeofence,Vehicle} from '../types';
import {piFreshness} from './piFreshness';
const number=(x:unknown):x is number=>typeof x==='number' && Number.isFinite(x);
export function processPi(p:any,now=Date.now()) {
  const {transportAge,online,sourceAge:age}=piFreshness(p,now);
  const raw=p?.canonical;
  const imuReady=online && p?.imu?.status==='connected' && (age('imu')??Infinity)<2000;
  const distanceReady=online && p?.fuel?.status==='connected' && (age('ultrasonic')??Infinity)<3000;
  const gpsReady=online && p?.gps?.status==='ok' && (age('gps')??Infinity)<10000 && number(p?.gps?.latitude) && number(p?.gps?.longitude);
  const lastGps=raw?.gps;
  const hasPosition=number(lastGps?.latitude) && Math.abs(lastGps.latitude)<=90 && number(lastGps?.longitude) && Math.abs(lastGps.longitude)<=180;
  const rfidReady=online && p?.rfid?.status==='ok';
  const cameraReady=online && ['ok','no_face'].includes(p?.camera?.status) && (age('camera')??Infinity)<2000;
  return {packet:p,online,transportAge,sourceAge:age,imuReady,distanceReady,gpsReady,hasPosition,rfidReady,cameraReady,
    imuStatus:imuReady?'connected':p?.imu?.status??'waiting',gpsStatus:(gpsReady?'recent':hasPosition?'stale':'waiting') as 'recent'|'stale'|'waiting',
    distanceCm:distanceReady && number(p?.fuel?.distance_cm)?p.fuel.distance_cm:null,
    echoUs:distanceReady && number(raw?.ultrasonic?.echo_us)?raw.ultrasonic.echo_us:null,
    driverName:rfidReady?p?.rfid?.driver_name??null:null,driverId:rfidReady?p?.rfid?.driver_id??null:null,
    rfidUid:rfidReady?p?.rfid?.card_id??null:null,
    gpsTimestamp:lastGps?.timestamp??null,gpsAccuracy:hasPosition?lastGps.accuracy_m??null:null,
    coordinates:{lat:hasPosition?lastGps.latitude:null,lng:hasPosition?lastGps.longitude:null},
    cameraStatus:cameraReady?p.camera.status:'unavailable'};
}
export function piVehicle(p:any,now=Date.now()):Vehicle {
  const v=processPi(p,now), age=v.sourceAge('gps');
  return {id:p?.vehicle_id||'prototype',plateNumber:'Prototype',name:'Live Pi prototype',type:'Heavy Truck',
    currentSpeed:null,status:!v.online?'No Signal':v.gpsReady?'Telemetry Online':v.hasPosition?'GPS Stale':'Telemetry Online',statusDuration:'Speed / ignition unavailable',
    fuelLevel:null,fuelCapacity:null,currentFuelLiters:null,mileage:null,ignition:null,heading:null,
    coordinates:v.coordinates,lastKnownLocation:v.hasPosition?`${v.gpsReady?'Measured position':'Last known position · GPS stale'} · ±${v.gpsAccuracy??'—'} m`:'Waiting for phone GPS',
    assignedDriverId:v.driverId??undefined,assignedDriverName:v.driverName??undefined,lastUpdated:p?.received_at||'Waiting',
    telemetryOnline:v.online,gpsStatus:v.gpsStatus,gpsTimestamp:v.gpsTimestamp,gpsAccuracyM:v.gpsAccuracy,gpsAgeMs:age,
    ultrasonicDistanceCm:v.distanceCm,ultrasonicStatus:v.distanceReady?'connected':'unavailable',imuStatus:v.imuStatus,rfidUid:v.rfidUid};
}
export function metres(a:{lat:number,lng:number},b:{lat:number,lng:number}) {
  const rad=Math.PI/180,dLat=(b.lat-a.lat)*rad,dLng=(b.lng-a.lng)*rad;
  const h=Math.sin(dLat/2)**2+Math.cos(a.lat*rad)*Math.cos(b.lat*rad)*Math.sin(dLng/2)**2;
  return 6371000*2*Math.atan2(Math.sqrt(h),Math.sqrt(Math.max(0,1-h)));
}
export function insideArea(point:{lat:number,lng:number},zone:AreaGeofence) {
  if(zone.shapeType==='circle' && zone.center && number(zone.radius)) return metres(point,zone.center)<=zone.radius;
  const vertices=zone.coordinates||[];let inside=false;
  for(let i=0,j=vertices.length-1;i<vertices.length;j=i++) {
    const a=vertices[i],b=vertices[j];
    if((a.lat>point.lat)!==(b.lat>point.lat) && point.lng<(b.lng-a.lng)*(point.lat-a.lat)/(b.lat-a.lat)+a.lng)inside=!inside;
  }return inside;
}
function segmentDistance(p:{lat:number,lng:number},a:{lat:number,lng:number},b:{lat:number,lng:number}) {
  const scale=6371000*Math.PI/180,cos=Math.cos(p.lat*Math.PI/180);
  const ax=(a.lng-p.lng)*scale*cos,ay=(a.lat-p.lat)*scale,bx=(b.lng-p.lng)*scale*cos,by=(b.lat-p.lat)*scale;
  const dx=bx-ax,dy=by-ay,len=dx*dx+dy*dy,t=len?Math.max(0,Math.min(1,-(ax*dx+ay*dy)/len)):0;
  return Math.hypot(ax+t*dx,ay+t*dy);
}
export function routeDistance(point:{lat:number,lng:number},route:RouteGeofence) {
  const points=[route.startLocation,...(route.waypoints||[]),route.endLocation].filter(Boolean);
  return points.length<2?Infinity:Math.min(...points.slice(1).map((b,i)=>segmentDistance(point,points[i],b)));
}
export function evaluateGeofences(vehicle:Vehicle,areas:AreaGeofence[],routes:RouteGeofence[]) {
  if(vehicle.gpsStatus!=='recent' || !number(vehicle.coordinates.lat) || !number(vehicle.coordinates.lng))return [];
  const point=vehicle.coordinates as {lat:number,lng:number};
  return [
    ...areas.filter(z=>z.enabled && z.assignedVehicleIds.includes(vehicle.id)).map(z=>({id:z.id,name:z.name,kind:'area' as const,inside:insideArea(point,z),distanceM:null as number|null,zone:z})),
    ...routes.filter(z=>z.enabled && z.assignedVehicleIds.includes(vehicle.id)).map(z=>{const distanceM=routeDistance(point,z);return{id:z.id,name:z.name,kind:'route' as const,inside:distanceM<=z.corridorWidthMeters,distanceM,zone:z};})
  ];
}
