import React from 'react';
import {useLiveTelemetry} from '../services/useLiveTelemetry';
export function LiveOperationalReadings({kind='overview'}:{kind?:'overview'|'drivers'|'fleet'|'dynamics'}) {
 const t=useLiveTelemetry();
 const cards=kind==='drivers' ? [['Identified driver',t.driverName??'Unassigned'],['RFID card',t.rfidUid??'No card'],['Last scan',t.packet?.rfid?.last_scan_timestamp??'No scan']] : kind==='dynamics' ? [['BNO085 IMU',t.imuReady?'Connected':t.imuStatus],['Motion measurements',t.imuReady?JSON.stringify(t.packet.imu):'Unavailable until IMU reconnects']] : [['Pi connection',t.online?'Connected':'Disconnected'],['Probe distance',t.distanceCm==null?'Unavailable':`${t.distanceCm.toFixed(1)} cm`],['Driver',t.driverName??'Unassigned'],['GPS',t.gpsStatus==='recent'?'Fresh fix':t.gpsStatus==='stale'?'Stale — waiting for phone':'Waiting for phone']];
 return <section aria-label="Current vehicle readings" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">{cards.map(([title,value])=><div key={title} className="rounded-xl border border-slate-700 bg-slate-900 p-4"><p className="text-xs text-slate-400">{title}</p><p className="text-sm font-semibold text-white mt-2 break-words">{value}</p></div>)}</section>;
}
