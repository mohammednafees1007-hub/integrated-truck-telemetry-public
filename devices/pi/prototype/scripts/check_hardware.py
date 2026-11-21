#!/usr/bin/env python3
"""Observe real live packets only; never inject fixtures into production."""
import asyncio,json,math,time,statistics
from pathlib import Path
import websockets
from urllib.request import urlopen
def health():
 with urlopen('http://127.0.0.1:8765/health') as response:return json.load(response)
async def main():
 before=health();first=None;last=None;times=[];statuses={};cards=set();ranges={};counts={};invalid=False
 async with websockets.connect('ws://127.0.0.1:8765/ws/sensors') as ws:
  await ws.recv();start=time.monotonic()
  while time.monotonic()-start<60:
   packet=json.loads(await asyncio.wait_for(ws.recv(),2));times.append(time.monotonic())
   if first is None:first=packet
   last=packet
   for section in ('imu','rfid','ultrasonic','gps'):
    key=section+':'+packet[section]['status'];statuses[key]=statuses.get(key,0)+1
   if packet['rfid']['card_id']:cards.add(packet['rfid']['card_id'])
   for k,v in {**packet['imu'],**{'q'+k:v for k,v in packet['imu']['quaternion'].items()}}.items():
    if type(v) in (int,float):
     r=ranges.setdefault(k,[v,v]);r[0]=min(r[0],v);r[1]=max(r[1],v)
 elapsed=(last['source']['esp_uptime_us']-first['source']['esp_uptime_us'])/1e6
 report_rates={k:(last['source']['imu_seq'][k]-first['source']['imu_seq'][k])/elapsed for k in ('linear','gyro','rotation')}
 gaps=[(b-a)*1000 for a,b in zip(times,times[1:])];gaps.sort()
 after=health()
 result=dict(serial_invalid=after['metrics']['invalid']-before['metrics']['invalid'],serial_gaps=after['metrics']['serial_gaps']-before['metrics']['serial_gaps'],duration_s=times[-1]-times[0],received=len(times),received_hz=(len(times)-1)/(times[-1]-times[0]),esp_packet_hz=(last['source']['esp_seq']-first['source']['esp_seq'])/elapsed,imu_report_rates_hz=report_rates,status_counts=statuses,cards_observed=sorted(cards),value_ranges=ranges,interarrival_ms=dict(p95=gaps[int(len(gaps)*.95)],p99=gaps[int(len(gaps)*.99)],maximum=max(gaps)),first_source=first['source'],last_source=last['source'])
 Path('docs/hardware-connected-check.json').write_text(json.dumps(result,indent=2)+'\n')
 Path('build/connected-hardware-snapshot.json').write_text(json.dumps(last,indent=2)+'\n')
 print(json.dumps(result,indent=2))
asyncio.run(main())
