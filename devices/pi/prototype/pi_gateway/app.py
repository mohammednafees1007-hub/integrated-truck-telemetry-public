import asyncio,contextlib,os,time
from contextlib import asynccontextmanager
from pathlib import Path
import yaml
from fastapi import FastAPI,HTTPException,Request,WebSocket,WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from .state import State
from .gps_ingest import GPSFix,GPSLoggerFix
from .serial_reader import read_serial
from .publisher import publish

ROOT=Path(__file__).resolve().parents[1]
config=yaml.safe_load((ROOT/'config.example.yaml').read_text())
if (ROOT/'config.yaml').exists(): config.update(yaml.safe_load((ROOT/'config.yaml').read_text()) or {})
state=State(config);clients=set();started=time.monotonic()
@asynccontextmanager
async def lifespan(app):
    tasks=[asyncio.create_task(read_serial(state,config)),asyncio.create_task(publish(state,clients))]
    yield
    for t in tasks: t.cancel()
    for t in tasks:
        with contextlib.suppress(asyncio.CancelledError): await t
app=FastAPI(lifespan=lifespan)
app.add_middleware(CORSMiddleware,allow_origins=config['origins'],allow_methods=['GET','POST'],allow_headers=['Content-Type'])
@app.middleware('http')
async def bounds(request,call_next):
    origin=request.headers.get('origin')
    if origin and origin not in config['origins']: return __import__('starlette.responses',fromlist=['JSONResponse']).JSONResponse({'detail':'origin not configured'},status_code=403)
    if request.method=='POST':
        total=0; chunks=[]
        async for chunk in request.stream():
            total+=len(chunk);chunks.append(chunk)
            if total>4096: return __import__('starlette.responses',fromlist=['JSONResponse']).JSONResponse({'detail':'body too large'},status_code=413)
        request._body=b''.join(chunks)
    return await call_next(request)
@app.get('/health')
def health():
    snap=state.snapshot()
    return dict(uptime_s=time.monotonic()-started,target_hz=50,publish_hz=state.metrics['published']/max(.001,time.monotonic()-started),serial_connected=state.connected,source_rates_hz=state.source_rates(),status={k:snap[k]['status'] for k in ('imu','ultrasonic','rfid','gps')},metrics=state.metrics)
@app.get('/api/v1/sensors/latest')
def latest(): return state.snapshot()
@app.get('/api/v1/config/public')
def public(): return {k:config[k] for k in ('device_id','vehicle_id','freshness')}
@app.post('/api/v1/gps')
def gps(fix:GPSFix):
    try: accepted=state.add_gps(fix.model_dump())
    except ValueError as e: raise HTTPException(409,str(e))
    return {'accepted':accepted,'delay_s':state.metrics.get('gps_delay_s')}
@app.post('/api/v1/gps/gpslogger')
def gpslogger(fix:GPSLoggerFix): return gps(fix)
@app.websocket('/ws/sensors')
async def sensors(ws:WebSocket):
    origin=ws.headers.get('origin')
    if origin and origin not in config['origins']: await ws.close(code=1008);return
    if len(clients)>=16: await ws.close(code=1013);return
    await ws.accept();q=asyncio.Queue(maxsize=1);clients.add(q)
    try:
        await ws.send_json(state.snapshot())
        while True: await asyncio.wait_for(ws.send_json(await q.get()),timeout=1)
    except (WebSocketDisconnect,asyncio.TimeoutError,RuntimeError): pass
    finally: clients.discard(q)
from fastapi.staticfiles import StaticFiles
# Legacy Pi UI is optional; the supported dashboard runs on laptop/PHP hosting.
if (ROOT.parent/'dashboard').is_dir():
    app.mount('/dashboard',StaticFiles(directory=str(ROOT.parent/'dashboard'),html=True),name='dashboard')
if __name__=='__main__':
    import uvicorn
    uvicorn.run(app,host=config['host'],port=config['port'],access_log=False)
