import {finite, requireThat, timestamp} from './relay';
const states = ['ok','waiting','stale','disconnected','invalid','unconfigured'];
export function validatePi(p: any) {
  requireThat(p && typeof p==='object' && p.schema_version===1 && typeof p.bridge_boot_id==='string' && /^[a-zA-Z0-9-]{8,80}$/.test(p.bridge_boot_id) && Number.isSafeInteger(p.bridge_seq) && p.bridge_seq>=1);
  if(p.bridge_sent_at!=null) timestamp(p.bridge_sent_at);
  const s=p.sensors;
  requireThat(s && s.schema_version===1 && ['device_id','vehicle_id','boot_id'].every(k=>typeof s[k]==='string' && s[k].length>0 && s[k].length<=100) && Number.isSafeInteger(s.seq) && s.seq>=0);
  requireThat(timestamp(s.timestamp)<=Date.now()+5000);
  for(const k of ['imu','ultrasonic','rfid','gps']) {
    requireThat(s[k] && states.includes(s[k].status));
    const t=k==='rfid' ? s[k].last_scan_timestamp : s[k].received_at;
    if(t!=null) requireThat(timestamp(t)<=Date.now()+5000);
  }
  for(const k of ['lin_accel_x','lin_accel_y','lin_accel_z','gyro_x','gyro_y','gyro_z']) requireThat(s.imu[k]==null || finite(s.imu[k]));
  requireThat(s.imu.quaternion && ['w','x','y','z'].every(k=>s.imu.quaternion[k]==null || finite(s.imu.quaternion[k])));
  for(const k of ['distance_mm','echo_us']) requireThat(s.ultrasonic[k]==null || finite(s.ultrasonic[k]) && s.ultrasonic[k]>0);
  if(s.gps.latitude!=null) {
    requireThat(finite(s.gps.latitude) && Math.abs(s.gps.latitude)<=90 && finite(s.gps.longitude) && Math.abs(s.gps.longitude)<=180 && finite(s.gps.accuracy_m) && s.gps.accuracy_m>=0);
    timestamp(s.gps.timestamp);
  }
  requireThat(s.rfid.card_id==null || typeof s.rfid.card_id==='string' && /^(?:[0-9A-F]{2}){4,10}$/.test(s.rfid.card_id));
  requireThat(s.source && typeof s.source==='object');
  if(p.camera!=null) {
    requireThat(p.camera.schema_version===1 && ['ok','no_face','stale','unavailable'].includes(p.camera.status));
    if(p.camera.status==='no_face') requireThat(p.camera.results===null && p.camera.face_detected===false);
    if(p.camera.status==='ok') { requireThat(p.camera.face_detected===true && p.camera.results && typeof p.camera.results==='object'); timestamp(p.camera.captured_at); }
  }
  return p;
}
export const age = (t: any,now=Date.now()) => typeof t==='string' && Number.isFinite(Date.parse(t)) ? Math.max(0,now-Date.parse(t)) : null;
export function euler(q: any) {
  if(!q || !['w','x','y','z'].every(k=>finite(q[k]))) return {roll:null,pitch:null,yaw:null};
  const n=Math.hypot(q.w,q.x,q.y,q.z); if(n<.8 || n>1.2) return {roll:null,pitch:null,yaw:null};
  const [w,x,y,z]=['w','x','y','z'].map(k=>q[k]/n), d=180/Math.PI;
  return {roll:Math.atan2(2*(w*x+y*z),1-2*(x*x+y*y))*d,pitch:Math.asin(Math.max(-1,Math.min(1,2*(w*y-z*x))))*d,yaw:Math.atan2(2*(w*z+x*y),1-2*(y*y+z*z))*d};
}
export function adaptPi(envelope: any, received: string|null, drivers: any[], now=Date.now()) {
  if(!envelope) return null;
  const s=envelope.sensors, transport=(age(received,now)??Infinity)<3000;
  // Compare source timestamps within the Pi clock domain, then age transport locally.
  // Absolute timestamps remain intact; unknown one-way transit time is not called latency.
  const piReference=envelope.bridge_sent_at || s.timestamp;
  const sourceAge=(t:any)=>typeof t==='string' && Number.isFinite(Date.parse(t)) ? Math.max(0,Date.parse(piReference)-Date.parse(t)) : null;
  const transportAge=age(received,now)??Infinity;
  const fresh=(section:any,t:any,limit:number)=>transport && section?.status==='ok' && (sourceAge(t)??Infinity)+transportAge<limit;
  const imuOk=fresh(s.imu,s.imu.received_at,2000), uOk=fresh(s.ultrasonic,s.ultrasonic.received_at,3000), gpsOk=fresh(s.gps,s.gps.timestamp,10000);
  const i=s.imu,u=s.ultrasonic,q=euler(i.quaternion);
  const rawDistance=finite(u.distance_mm)?u.distance_mm:finite(u.echo_us)?u.echo_us*.343/2:null;
  const distanceCm=uOk && rawDistance!=null?rawDistance/10:null;
  const driver=drivers.find(d=>(d.rfidUid || d.rfidId)?.toUpperCase().replace(/[^0-9A-F]/g,'')===s.rfid.card_id);
  const camera=envelope.camera;
  const cameraFresh=transport && ['ok','no_face'].includes(camera?.status) && (sourceAge(camera.captured_at)??Infinity)+transportAge<2000;
  const c=cameraFresh && camera.face_detected ? camera.results : null;
  const sourceState=(section:any,ok:boolean)=>ok?'connected':!transport || section.status==='disconnected' || section.status==='waiting'?'disconnected':'stale';
  const health=envelope.gateway_health?{...envelope.gateway_health,source_rates_hz:{...envelope.gateway_health.source_rates_hz,...(!imuOk?{linear:null,gyro:null,rotation:null}:{}),...(!uOk?{ultrasonic:null}:{}),...(!gpsOk?{gps:null}:{})}}:null;
  const responseSourceAges=Object.fromEntries(Object.entries({imu:sourceAge(i.received_at),ultrasonic:sourceAge(u.received_at),gps:sourceAge(s.gps.timestamp),camera:sourceAge(camera?.captured_at)}).map(([key,value])=>[key,value===null||!Number.isFinite(transportAge)?null:value+transportAge]));
  return {
    transport_age_at_response_ms:Number.isFinite(transportAge)?transportAge:null,source_age_at_response_ms:responseSourceAges,
    device_id:s.device_id, vehicle_id:s.vehicle_id,timestamp:s.timestamp,received_at:received,sequence_id:envelope.bridge_seq,is_simulated:false,
    transport_status:transport?'connected':'disconnected',canonical:s,gateway_health:health,source_age_at_receipt_ms:{imu:sourceAge(i.received_at),ultrasonic:sourceAge(u.received_at),gps:sourceAge(s.gps.timestamp),camera:sourceAge(camera?.captured_at)},camera:cameraFresh?camera:{...camera,status:'unavailable',results:null,face_detected:false},gps_receipt:envelope.gps_receipt || null,
    imu:{accel_x:null,accel_y:null,accel_z:null,lin_accel_x:imuOk?i.lin_accel_x:null,lin_accel_y:imuOk?i.lin_accel_y:null,lin_accel_z:imuOk?i.lin_accel_z:null,
      gyro_x:imuOk && finite(i.gyro_x)?i.gyro_x*180/Math.PI:null,gyro_y:imuOk && finite(i.gyro_y)?i.gyro_y*180/Math.PI:null,gyro_z:imuOk && finite(i.gyro_z)?i.gyro_z*180/Math.PI:null,
      roll:imuOk?q.roll:null,pitch:imuOk?q.pitch:null,yaw:imuOk?q.yaw:null,quaternion:i.quaternion,received_at:i.received_at,status:sourceState(i,imuOk),unit_acceleration:'m/s^2',unit_angular_velocity:'deg/s'},
    fuel:{distance_cm:distanceCm,raw_distance_cm:distanceCm,echo_us:u.echo_us,level_percent:null,volume_litres:null,low_fuel_warning:false,status:sourceState(u,uOk),received_at:u.received_at,error_message:'Uncalibrated probe distance; sound speed assumed 343 m/s'},
    rfid:{...s.rfid,driver_name:driver?.name??null,driver_id:driver?.id??null,authenticated:!!driver,identification_only:true},
    gps:{...s.gps,latitude:gpsOk?s.gps.latitude:null,longitude:gpsOk?s.gps.longitude:null,status:gpsOk?'ok':'stale',speed_kmh:null,heading:null,satellites:null,altitude_m:null},
    fatigue:{score:c?.fatigue_score??null,state:c?.fatigue_state??'UNAVAILABLE',ear_left:c?.ear_left??null,ear_right:c?.ear_right??null,mar:c?.mar??null,blinks:c?.total_blinks??null,yawns:c?.total_yawns??null},
    events:{driving_state:'normal',latest_event:null,detector_mode:'THRESHOLD_PROTOTYPE',orientation_calibrated:false}
  };
}
