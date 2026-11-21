"""Outbound-only bridge. Acquisition and camera service ownership stay on the Pi."""
import asyncio
import json
import logging
from logging.handlers import RotatingFileHandler
import math
import re
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse
import httpx
import websockets

ROOT = Path(__file__).resolve().parent

def utc():
    return datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')

def valid_fix(f):
    if not isinstance(f, dict) or set(f) != {'latitude', 'longitude', 'accuracy_m', 'timestamp'}:
        raise ValueError('GPS fields')
    for key in ('latitude', 'longitude', 'accuracy_m'):
        if type(f[key]) not in (int, float) or not math.isfinite(f[key]):
            raise ValueError('GPS number')
    if abs(f['latitude']) > 90 or abs(f['longitude']) > 180 or f['accuracy_m'] < 0:
        raise ValueError('GPS range')
    if not isinstance(f['timestamp'], str) or not re.fullmatch(r'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)', f['timestamp']):
        raise ValueError('GPS timezone')
    dt = datetime.fromisoformat(f['timestamp'].replace('Z', '+00:00'))
    if dt.timestamp() > time.time() + 5:
        raise ValueError('GPS future source time')
    return f

def config_check(c):
    u = urlparse(c['public_origin'])
    if u.scheme != 'https' or not u.hostname or u.username or u.password or u.query or u.fragment or u.path not in ('', '/'):
        raise ValueError('Use HTTPS origin only')
    if not re.fullmatch(r'/[a-z0-9-]+', c.get('base_path', '/truck-tracking')):
        raise ValueError('Base path')
    for key in ('device_key', 'reader_key'):
        if not re.fullmatch(r'[A-Za-z0-9_-]{32,128}', c[key]):
            raise ValueError('Invalid key')

class Bridge:
    def __init__(self, config):
        config_check(config)
        self.base = config['public_origin'].rstrip('/') + config.get('base_path', '/truck-tracking')
        self.device_headers = {'X-Device-Token': config['device_key']}
        self.reader_headers = {'X-GPS-Key': config['reader_key']}
        self.boot = str(uuid.uuid4())
        self.seq = 0
        self.sensors = None
        self.sensor_seen = 0
        self.camera = None
        self.health = None
        self.receipt = None
        self.delivered = None
        self.acked = None
        self.rejected = None
        self.gateway = 'http://127.0.0.1:8765'
        self.camera_base = 'http://127.0.0.1:8766'

    async def gps_step(self, remote, local):
        r = await remote.get(self.base + '/pi-gps/latest.php', headers=self.reader_headers)
        r.raise_for_status()
        d = r.json()
        if d.get('schema_version') != 1:
            raise ValueError('GPS relay schema')
        if d.get('fix') is None:
            return
        stream, seq = d.get('stream_id'), d.get('seq')
        if not isinstance(stream, str) or not re.fullmatch(r'[a-f0-9]{32}', stream) or type(seq) is not int or seq < 1:
            raise ValueError('GPS stream identity')
        fix = valid_fix(d['fix'])
        identity = (stream, seq)
        if self.delivered and self.delivered[0] == stream and seq < self.delivered[1]:
            raise ValueError('GPS sequence regressed')
        if identity == self.rejected:
            return
        if identity != self.delivered:
            accepted = await local.post(self.gateway + '/api/v1/gps', json=fix)
            if accepted.status_code == 409:
                self.rejected = identity
                return
            if accepted.status_code != 200 or type(accepted.json().get('accepted')) is not bool:
                raise ValueError('Invalid local GPS receipt')
            # A false receipt is a duplicate: verify it matches the actual held Pi fix.
            if not accepted.json()['accepted']:
                current = await local.get(self.gateway + '/api/v1/sensors/latest')
                current.raise_for_status()
                held = current.json().get('gps', {})
                same_time = datetime.fromisoformat(str(held.get('timestamp', '')).replace('Z', '+00:00')) == datetime.fromisoformat(fix['timestamp'].replace('Z', '+00:00'))
                if not same_time or any(held.get(k) != fix[k] for k in ('latitude', 'longitude', 'accuracy_m')):
                    raise ValueError('Duplicate receipt does not match Pi GPS')
            self.delivered = identity
            self.receipt = {'stream_id': stream, 'seq': seq, 'source_timestamp': fix['timestamp'],
                            'relay_received_at': d.get('relay_received_at'), 'pi_local_accepted_at': utc(),
                            'duplicate': not accepted.json()['accepted'], 'relay_acknowledged_at': None}
        if identity != self.acked:
            ack = await remote.post(self.base + '/pi-gps/ack.php', headers=self.reader_headers,
                                    json={'stream_id': stream, 'seq': seq})
            ack.raise_for_status()
            data = ack.json()
            if data.get('acknowledged') is not True or data.get('pi_last_ack_seq') != seq:
                raise ValueError('Invalid relay ACK')
            self.acked = identity
            self.receipt['relay_acknowledged_at'] = data.get('pi_last_ack_timestamp')

    async def sensor_loop(self):
        backoff = 1
        while True:
            try:
                async with websockets.connect('ws://127.0.0.1:8765/ws/sensors', max_size=131072, max_queue=1,
                                              open_timeout=4, ping_interval=10, ping_timeout=5) as ws:
                    backoff = 1
                    while True:
                        raw = await asyncio.wait_for(ws.recv(), timeout=3)
                        d = json.loads(raw)
                        if d.get('schema_version') != 1 or not isinstance(d.get('source'), dict):
                            raise ValueError('Gateway schema')
                        self.sensors = d
                        self.sensor_seen = time.monotonic()
            except Exception as e:
                logging.warning('Sensor connection: %s', type(e).__name__)
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 15)

    async def health_step(self, local):
        r = await local.get(self.gateway + '/health')
        r.raise_for_status()
        self.health = r.json()

    async def camera_step(self, local):
        try:
            r = await local.get(self.camera_base + '/api/v1/fatigue/latest')
            r.raise_for_status()
            d = r.json()
            if d.get('schema_version') != 1 or d.get('status') not in ('ok', 'no_face', 'stale', 'unavailable'):
                raise ValueError('Camera startup or invalid result')
            self.camera = d
        except Exception:
            self.camera = {'schema_version': 1, 'status': 'unavailable', 'face_detected': False, 'results': None}

    async def upload_step(self, remote):
        if self.sensors is None or time.monotonic() - self.sensor_seen > 2:
            return  # Silence cannot become an apparently live bridge heartbeat.
        self.seq += 1
        p = {'schema_version': 1, 'bridge_boot_id': self.boot, 'bridge_seq': self.seq, 'bridge_sent_at': utc(),
             'sensors': self.sensors, 'camera': self.camera, 'gps_receipt': self.receipt, 'gateway_health': self.health}
        r = await remote.post(self.base + '/api/pi/telemetry', headers=self.device_headers, json=p)
        r.raise_for_status()
        if r.json().get('accepted') is not True:
            raise ValueError('Invalid laptop telemetry receipt')

    async def jpeg_step(self, remote, local):
        if not self.camera or self.camera.get('status') not in ('ok', 'no_face'):
            return
        async with local.stream('GET', self.camera_base + '/camera_feed') as response:
            response.raise_for_status()
            data = bytearray()
            async for chunk in response.aiter_bytes():
                data.extend(chunk)
                if len(data) > 512 * 1024:
                    raise ValueError('JPEG size limit')
        if bytes(data[:2]) != b'\xff\xd8' or bytes(data[-2:]) != b'\xff\xd9':
            raise ValueError('Expected bounded JPEG')
        r = await remote.post(self.base + '/api/pi/camera', headers={**self.device_headers, 'Content-Type': 'image/jpeg'}, content=bytes(data))
        r.raise_for_status()

async def periodic(name, interval, step):
    backoff = interval
    while True:
        start = time.monotonic()
        try:
            await step()
            backoff = interval
        except Exception as e:
            logging.warning('%s: %s', name, type(e).__name__)  # Never log keys, request URLs, fixes, or faces.
            backoff = min(max(interval, backoff * 2), 15)
        await asyncio.sleep(max(.01, backoff - (time.monotonic() - start)))

async def main():
    config = json.loads((ROOT / 'config.json').read_text())
    handler = RotatingFileHandler(ROOT / 'bridge.log', maxBytes=256000, backupCount=2)
    logging.basicConfig(level=logging.WARNING, handlers=[handler], format='%(asctime)s %(message)s')
    bridge = Bridge(config)
    limits = httpx.Limits(max_connections=6, max_keepalive_connections=4)
    async with httpx.AsyncClient(timeout=httpx.Timeout(4, connect=3), follow_redirects=False, limits=limits, verify=True) as remote, \
               httpx.AsyncClient(timeout=httpx.Timeout(.8, connect=.4), follow_redirects=False, limits=limits) as local:
        await asyncio.gather(bridge.sensor_loop(),
                             periodic('Camera', .2, lambda: bridge.camera_step(local)),
                             periodic('Telemetry', .1, lambda: bridge.upload_step(remote)),
                             periodic('GPS', 1, lambda: bridge.gps_step(remote, local)),
                             periodic('Gateway health', 1, lambda: bridge.health_step(local)),
                             periodic('JPEG', .7, lambda: bridge.jpeg_step(remote, local)))

if __name__ == '__main__':
    asyncio.run(main())
