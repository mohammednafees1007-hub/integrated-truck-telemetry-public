import React from 'react';
import {useLiveTelemetry} from '../services/useLiveTelemetry';
import {SettingsView} from './SettingsView';
import {PRESENTATION_DEMO,apiUrl} from '../services/api';
export function AdvancedSettingsView({onResetData}:{onResetData:()=>void}) {
 const t=useLiveTelemetry(),p=t.packet;
 const age=(key:string)=>{const n=t.sourceAge(key);return n==null?'Unavailable':`${(n/1000).toFixed(1)} s`;};
 const rows=[
 ['Pi bridge',t.online?'Connected':'Disconnected / waiting',p?.received_at??'Waiting',`${(t.transportAge/1000).toFixed(1)} s`],
 ['BNO085 IMU',t.imuReady?'Valid':t.imuStatus,p?.canonical?.imu?.received_at??'Unavailable',age('imu')],
 ['Ultrasonic',t.distanceReady?'Valid':'Unavailable / stale',p?.canonical?.ultrasonic?.received_at??'Unavailable',age('ultrasonic')],
 ['Phone GPS',t.gpsStatus,p?.canonical?.gps?.timestamp??'Waiting',age('gps')],
 ['RFID identification',t.rfidReady?'Connected':'Unavailable',p?.rfid?.last_scan_timestamp??'No scan','Last scan retained'],
 ['Pi camera',t.cameraStatus,p?.canonical?.camera?.received_at??'Unavailable',age('camera')]
 ];
 return <div className="space-y-6 text-slate-300"><section className="bg-slate-900 border border-slate-700 rounded-xl p-5"><h2 className="text-lg font-bold text-white">Incoming data health</h2><p className="text-sm text-slate-400 my-2">Each measurement keeps its own source time. Stale or failed sources are excluded from live calculations.</p><div className="overflow-auto"><table className="w-full text-sm text-left"><thead><tr>{['Source','Validation','Source / received time','Age'].map(x=><th className="p-3 border-b border-slate-700" key={x}>{x}</th>)}</tr></thead><tbody>{rows.map(r=><tr key={r[0]}>{r.map((v,i)=><td className="p-3 border-b border-slate-800" key={i}>{v}</td>)}</tr>)}</tbody></table></div></section>
 <section className="bg-slate-900 border border-slate-700 rounded-xl p-5 space-y-2"><h2 className="text-lg font-bold text-white">Processing</h2><p>Ultrasonic echo: {t.echoUs??'—'} µs → probe distance: {t.distanceCm?.toFixed(1)??'—'} cm. Sound speed assumption: 343 m/s; round trip divided by two.</p><p>Fuel litres and percentage require tank calibration. Speed and ignition have no measured source.</p><p>RFID: {t.rfidUid??'—'} · {t.driverName??'Unassigned'}. Identification only.</p><p>GPS: {t.gpsStatus}. Geofences use fresh fixes only. Held positions are labelled stale.</p><p>Pi GPS confirmation: sequence {t.ack?.pi_last_ack_seq??'—'}. Camera availability does not start the Pi camera.</p><a hidden={PRESENTATION_DEMO} className="inline-block text-cyan-400 underline" href={apiUrl('/pi-gps/')} target="_blank" rel="noreferrer">Phone pairing and APK</a></section>
 <details className="bg-slate-900 border border-slate-700 rounded-xl p-5"><summary className="cursor-pointer font-bold">Raw incoming packet and bridge confirmation</summary><pre className="text-xs overflow-auto max-h-96 mt-4">{JSON.stringify({packet:p,relay:t.relay,ack:t.ack},null,2)}</pre></details>
 <details className="bg-slate-900 border border-slate-700 rounded-xl p-5"><summary className="cursor-pointer font-bold">Dashboard preferences</summary><div className="mt-4"><SettingsView onResetData={onResetData}/></div></details></div>;
}
