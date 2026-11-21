#!/usr/bin/env python3
import argparse,asyncio,json,time,statistics,urllib.request
from pathlib import Path
import websockets
p=argparse.ArgumentParser();p.add_argument('--seconds',type=float,default=60);p.add_argument('--output',default='docs/rate-sensors.json');args=p.parse_args()
async def measure():
    with urllib.request.urlopen('http://127.0.0.1:8765/health') as r: before=json.load(r)
    arrivals=[];seqs=[];statuses={};max_size=0
    async with websockets.connect('ws://127.0.0.1:8765/ws/sensors') as ws:
        await ws.recv(); start=time.monotonic()
        while time.monotonic()-start<args.seconds:
            raw=await asyncio.wait_for(ws.recv(),2);now=time.monotonic();packet=json.loads(raw)
            assert not any(k in packet for k in ('fatigue','camera','trip','driving'))
            arrivals.append(now);seqs.append(packet['seq']);statuses={k:packet[k]['status'] for k in ('imu','ultrasonic','rfid','gps')};max_size=max(max_size,len(raw))
    intervals=[(b-a)*1000 for a,b in zip(arrivals,arrivals[1:])];ordered=sorted(intervals)
    with urllib.request.urlopen('http://127.0.0.1:8765/health') as r: after=json.load(r)
    out=dict(serial_frames=after['metrics']['serial_frames']-before['metrics']['serial_frames'],serial_invalid=after['metrics']['invalid']-before['metrics']['invalid'],serial_gaps=after['metrics'].get('serial_gaps',0)-before['metrics'].get('serial_gaps',0),duration_s=arrivals[-1]-arrivals[0],received=len(arrivals),average_hz=(len(arrivals)-1)/(arrivals[-1]-arrivals[0]),interarrival_ms=dict(p50=statistics.median(intervals),p95=ordered[int(len(ordered)*.95)],p99=ordered[int(len(ordered)*.99)],maximum=max(intervals)),sequence_gaps=sum(max(0,b-a-1) for a,b in zip(seqs,seqs[1:])),missed_deadlines=after['metrics']['missed_deadlines']-before['metrics']['missed_deadlines'],slow_drops=after['metrics']['slow_drops']-before['metrics']['slow_drops'],outgoing=after['metrics']['published']-before['metrics']['published'],max_packet_bytes=max_size,source_status=statuses,health=after)
    Path(args.output).write_text(json.dumps(out,indent=2)+'\n');print(json.dumps(out,indent=2))
asyncio.run(measure())
