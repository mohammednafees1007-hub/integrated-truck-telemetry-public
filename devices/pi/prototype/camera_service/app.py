"""Isolated CSI camera adapter. No GPIO controls, recordings, or serial access."""
import asyncio,contextlib,json,sys,time,uuid,os
from pathlib import Path
from fastapi import FastAPI,WebSocket,HTTPException
from fastapi.responses import Response,HTMLResponse
from contextlib import asynccontextmanager
import yaml
ROOT=Path(__file__).resolve().parents[1]
UPSTREAM=Path(os.environ.get('FATIGUE_ENGINE_ROOT',str(ROOT.parent/'upstream-fatigue' if (ROOT.parent/'upstream-fatigue').is_dir() else ROOT.parents[2]/'third_party/fatigue-engine')))
sys.path.insert(0,str(UPSTREAM))
config=yaml.safe_load((ROOT/'config.example.yaml').read_text())
if (ROOT/'config.yaml').exists(): config.update(yaml.safe_load((ROOT/'config.yaml').read_text()) or {})
cfg=config['camera']; boot=str(uuid.uuid4()); seq=0; jpeg=None;last_sensor_timestamp=None;completed_monotonic=None
latest=dict(schema_version=1,boot_id=boot,seq=0,status='unconfigured',face_detected=None,results=None,captured_at=None,inference_completed_at=None)
from pi_gateway.state import utc

def failure(status,error):
    global latest,jpeg
    latest={**latest,'status':status,'error':str(error)[:500],'results':None,'face_detected':None};jpeg=None

def open_pipeline():
    import cv2
    from picamera2 import Picamera2
    if not Picamera2.global_camera_info(): raise RuntimeError('No CSI camera enumerated')
    from src.detector import FatigueDetector
    from src.tracker import FatigueTracker
    for p in (UPSTREAM/'models').glob('*.onnx'):
        if p.read_bytes()[:80].startswith(b'version https://git-lfs'): raise RuntimeError('Model is a Git LFS pointer: '+str(p))
    detector=FatigueDetector(str(UPSTREAM/'models'),num_threads=2)
    tracker=FatigueTracker(fps=cfg['target_fps'])
    cam=Picamera2()
    try:
        # Picamera2 RGB888 yields B,G,R byte order; upstream process_frame expects BGR.
        cam.configure(cam.create_video_configuration(main={'size':(cfg['width'],cfg['height']),'format':'RGB888'},buffer_count=3))
        cam.start()
    except Exception:
        cam.close();raise
    return cam,detector,tracker,cv2

def frame_once(cam,detector,tracker,cv2):
    global seq,jpeg,last_sensor_timestamp,completed_monotonic
    request=cam.capture_request()
    try:
        meta=request.get_metadata();frame=request.make_array('main');captured=utc()
    finally: request.release()
    sensor_timestamp=meta.get('SensorTimestamp')
    if sensor_timestamp is not None and sensor_timestamp==last_sensor_timestamp:return None
    last_sensor_timestamp=sensor_timestamp
    start=time.monotonic();r=detector.process_frame(frame);seq+=1
    # Upstream returns NORMAL for missing faces: override with explicit no_face.
    tracked=tracker.update(r)
    fields=('ear_left','ear_right','mar','head_pose','left_eye_status','right_eye_status','mouth_status','latency_ms','fatigue_score','fatigue_state','blink_rate_bpm','total_yawns','total_blinks')
    results={k:tracked[k] for k in fields if k in tracked} if r['face_detected'] else None
    if cfg.get('preview'):
        success,b=cv2.imencode('.jpg',frame,[cv2.IMWRITE_JPEG_QUALITY,70]);jpeg=b.tobytes() if success else None
    packet=dict(schema_version=1,boot_id=boot,seq=seq,status='ok' if r['face_detected'] else 'no_face',face_detected=r['face_detected'],results=results,captured_at=captured,inference_completed_at=utc(),sensor_timestamp_ns=meta.get('SensorTimestamp'),capture_time_basis='Pi receipt after capture; sensor timestamp is monotonic nanoseconds',inference_ms=(time.monotonic()-start)*1000)
    completed_monotonic=time.monotonic()
    # Convert numpy scalar outputs to standard JSON types.
    return json.loads(json.dumps(packet,default=lambda x:x.item()))
async def worker():
    global latest
    while True:
        if not cfg.get('enabled'):
            failure('unconfigured','camera.enabled is false');await asyncio.sleep(2);continue
        cam=None
        try:
            cam,detector,tracker,cv2=await asyncio.to_thread(open_pipeline)
            while True:
                begin=time.monotonic();packet=await asyncio.to_thread(frame_once,cam,detector,tracker,cv2)
                if packet is not None: latest=packet
                await asyncio.sleep(max(0,1/cfg['target_fps']-(time.monotonic()-begin)))
        except Exception as e:
            failure('unavailable',e);await asyncio.sleep(5)
        finally:
            if cam:
                with contextlib.suppress(Exception): cam.stop();cam.close()
@asynccontextmanager
async def lifespan(app):
    t=asyncio.create_task(worker());yield;t.cancel()
    with contextlib.suppress(asyncio.CancelledError): await t
app=FastAPI(lifespan=lifespan)
@app.get('/health')
@app.get('/api/v1/fatigue/latest')
def result():
    if latest['status'] in ('ok','no_face') and completed_monotonic and time.monotonic()-completed_monotonic>3:
        return {**latest,'status':'stale','results':None,'face_detected':None}
    return latest
@app.get('/demo',response_class=HTMLResponse)
def demo():
    return HTMLResponse((ROOT/'camera_service/demo.html').read_text(),headers={'Cache-Control':'no-store'})
@app.get('/camera_feed')
def preview():
    if not cfg.get('preview') or jpeg is None: raise HTTPException(503,'Preview disabled or no frame')
    return Response(jpeg,media_type='image/jpeg',headers={'Cache-Control':'no-store'})
@app.websocket('/ws/fatigue')
async def stream(ws:WebSocket):
    if ws.headers.get('origin') and ws.headers['origin'] not in config['origins']: await ws.close(code=1008);return
    await ws.accept();last=None;receive_task=asyncio.create_task(ws.receive())
    try:
        while True:
            if receive_task.done():
                message=receive_task.result()
                if message['type']=='websocket.disconnect':break
                receive_task=asyncio.create_task(ws.receive())
            packet=result();key=(packet['seq'],packet['status'],packet.get('error'))
            if key!=last: await asyncio.wait_for(ws.send_json(packet),1);last=key
            await asyncio.sleep(.05)
    except Exception: pass
    finally:
        receive_task.cancel()
        with contextlib.suppress(asyncio.CancelledError):await receive_task
if __name__=='__main__':
    import uvicorn
    uvicorn.run(app,host=config['host'],port=cfg['port'],access_log=False)
