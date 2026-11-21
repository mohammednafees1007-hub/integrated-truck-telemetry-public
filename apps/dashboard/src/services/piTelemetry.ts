import { StandardTelemetryPayload } from '../types';
import { piFreshness } from './piFreshness';
const age=(t:any)=>t && Number.isFinite(Date.parse(t))?Math.max(0,Date.now()-Date.parse(t)):null;
export function piStandard(p:any): StandardTelemetryPayload {
  const s=p?.canonical, i=p?.imu||{}, f=p?.fuel||{}, g=p?.gps||{}, r=p?.rfid||{}, c=p?.camera, v=c?.status==='ok'?c.results:null;
  const clock=piFreshness(p),fresh=clock.online;
  const sourceAge=(key:string,t:any)=>p?.source_age_at_receipt_ms ? clock.sourceAge(key) : age(t);
  const imuAge=sourceAge('imu',s?.imu?.received_at), gpsAge=sourceAge('gps',s?.gps?.timestamp), fuelAge=sourceAge('ultrasonic',s?.ultrasonic?.received_at);
  const imuFresh=fresh && i.status==='connected' && (imuAge??Infinity)<2000, gpsFresh=fresh && g.status==='ok' && (gpsAge??Infinity)<10000;
  const camFresh=clock.cameraReady && !!v;
  const cv=camFresh?v:null;
  return {
    timestamp:p?.timestamp??null,device_id:p?.device_id??'Awaiting Pi',vehicle_id:p?.vehicle_id??'prototype',
    trip:{trip_id:null,status:'IDLE',start_time:null,end_time:null,distance_km:null,avg_speed_kmh:null,max_speed_kmh:null,duration_s:null},
    gps:{latitude:gpsFresh?g.latitude:null,longitude:gpsFresh?g.longitude:null,speed_kmh:null,heading:null,altitude_m:null,fix_status:gpsFresh?'PHONE_FIX':'UNAVAILABLE',satellites:null,accuracy_m:gpsFresh?g.accuracy_m:null,geofence_status:'UNAVAILABLE',timestamp:g.timestamp??null,freshness_ms:gpsAge,is_stale:!gpsFresh},
    imu:{...Object.fromEntries(['accel_x','accel_y','accel_z','lin_accel_x','lin_accel_y','lin_accel_z','gyro_x','gyro_y','gyro_z','roll','pitch','yaw'].map(k=>[k,imuFresh?i[k]??null:null])),quaternion:imuFresh?s?.imu?.quaternion:null,gravity_vector:null,calibration_status:'UNCALIBRATED',connection_status:imuFresh?i.status:'disconnected',freshness_ms:imuAge,is_stale:!imuFresh},
    fuel:{...f,distance_cm:fresh && (fuelAge??Infinity)<3000?f.distance_cm:null,level_percent:null,volume_litres:null,low_fuel_warning:false,status:fresh?f.status:'disconnected',freshness_ms:fuelAge,is_stale:!fresh || (fuelAge??Infinity)>3000},
    rfid:{driver_id:r.driver_id??null,card_id:r.card_id??null,driver_name:fresh && r.status==='ok' ? r.driver_name??'Unknown card' : 'Unavailable',authenticated:fresh && r.status==='ok' && !!r.authenticated,shift_status:'IDENTIFICATION ONLY',safety_score:null,last_scan_timestamp:r.last_scan_timestamp??null},
    fatigue:{overall_status:cv?.fatigue_state??'UNAVAILABLE',fatigue_score:cv?.fatigue_score??null,confidence:null,models:{face_detection:{detected:!!cv,box:null,confidence:null},eye_state:{left_eye:cv?.left_eye_status??'unknown',right_eye:cv?.right_eye_status??'unknown',ear_left:cv?.ear_left??null,ear_right:cv?.ear_right??null,perclos:null},mouth_state:{status:cv?.mouth_status??'unknown',mar:cv?.mar??null,yawn_detected:cv?.mouth_status==='yawn',yawn_count:cv?.total_yawns??null},head_pose:{yaw:cv?.head_pose?.yaw??null,pitch:cv?.head_pose?.pitch??null,roll:cv?.head_pose?.roll??null,looking_away:null}},inference_latency_ms:cv?c.inference_ms:null,fps:null,camera_status:cv?'connected':'unavailable',last_inference_time:c?.captured_at??null},
    driving:{state:'normal',latest_event:null,detector_mode:'THRESHOLD_PROTOTYPE',trip_event_counts:{harsh_braking:0,harsh_acceleration:0,harsh_cornering:0,excessive_vibration:0}},
    system:{cpu_usage_percent:null,memory_usage_percent:null,disk_usage_percent:null,cpu_temperature_c:null,uptime_seconds:null,network:{interface:'Outbound HTTPS',ip:'Unavailable',signal_dbm:null}},
    telemetry:{publishing_rate_hz:null,dropped_messages:null,network_latency_ms:null}
  } as unknown as StandardTelemetryPayload;
}
