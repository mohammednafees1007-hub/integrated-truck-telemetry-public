// Browser-only fixtures. Never imported by the receiving backend or sent to hardware.
export type DemoScenario = 'normal' | 'drowsy' | 'critical' | 'no_face' | 'offline';
let scenario: DemoScenario = 'normal';
let playbackTimeMs: number | null = null;
export function setDemoClock(value: number | null) {playbackTimeMs=value;}
const listeners = new Set<() => void>();
export const demoScenarios: {id: DemoScenario; label: string}[] = [
  {id:'normal',label:'Normal drive'}, {id:'drowsy',label:'Drowsy driver'},
  {id:'critical',label:'Critical alert'}, {id:'no_face',label:'No face'}, {id:'offline',label:'Link lost'}
];
export const getDemoScenario = () => scenario;
export function setDemoScenario(value: DemoScenario) { if(value===scenario)return; scenario=value; listeners.forEach(fn=>fn()); }
export function subscribeDemo(fn: () => void) { listeners.add(fn); return () => {listeners.delete(fn);}; }
export function demoSnapshot(now=Date.now(), selected: DemoScenario=scenario) {
  const t=(playbackTimeMs??now)/1000, stamp=new Date(now).toISOString(), offline=selected==='offline';
  const score=selected==='critical'?86:selected==='drowsy'?57:18;
  const pitch=Math.sin(t*.22)*12, roll=Math.sin(t*.35)*9, yaw=Math.sin(t*.12)*25;
  const a=roll*Math.PI/360,b=pitch*Math.PI/360,c=yaw*Math.PI/360;
  const quaternion=[Math.cos(a)*Math.cos(b)*Math.cos(c)+Math.sin(a)*Math.sin(b)*Math.sin(c),Math.sin(a)*Math.cos(b)*Math.cos(c)-Math.cos(a)*Math.sin(b)*Math.sin(c),Math.cos(a)*Math.sin(b)*Math.cos(c)+Math.sin(a)*Math.cos(b)*Math.sin(c),Math.cos(a)*Math.cos(b)*Math.sin(c)-Math.sin(a)*Math.sin(b)*Math.cos(c)];
  const orientation={w:quaternion[0],x:quaternion[1],y:quaternion[2],z:quaternion[3]};
  const distance=22+Math.sin(t*.18)*4;
  const results={fatigue_score:score,fatigue_state:score>=70?'CRITICAL':score>=50?'DROWSY':'NORMAL',left_eye_status:score>50?'closed':'open',right_eye_status:score>50?'closed':'open',mouth_status:selected==='drowsy'?'yawn':'normal',blink_rate_bpm:16,total_yawns:selected==='drowsy'?4:1,head_pose:{yaw,pitch,roll}};
  const packet={is_simulated:true,device_id:'SYNTHETIC-ESP32',vehicle_id:'veh-1',sequence_id:Math.floor(now/250),timestamp:stamp,received_at:stamp,transport_status:offline?'disconnected':'connected',transport_age_at_response_ms:offline?20000:0,source_age_at_response_ms:{imu:0,ultrasonic:0,gps:0,camera:0},source_age_at_receipt_ms:{imu:0,ultrasonic:0,gps:0,camera:0},
    imu:{status:offline?'disconnected':'connected',roll,pitch,yaw,lin_accel_x:Math.sin(t)*.4,lin_accel_y:Math.cos(t)*.3,lin_accel_z:.02,gyro_x:2.1,gyro_y:1.4,gyro_z:.8},
    fuel:{status:offline?'disconnected':'connected',distance_cm:distance},gps:{status:offline?'stale':'ok',latitude:13.0827,longitude:80.2707,accuracy_m:4},
    rfid:{status:offline?'disconnected':'ok',card_id:'DEMO001',driver_id:'DRV001',driver_name:'Demo Driver',last_scan_timestamp:stamp},
    camera:{status:offline?'stale':selected==='no_face'?'no_face':'ok',captured_at:stamp,face_detected:!offline&&selected!=='no_face',results:offline||selected==='no_face'?null:results},
    canonical:{imu:{received_at:stamp,quaternion:orientation},ultrasonic:{received_at:stamp,echo_us:distance/.01715},gps:{timestamp:stamp,latitude:13.0827,longitude:80.2707,accuracy_m:4},camera:{received_at:stamp}}};
  return packet;
}
