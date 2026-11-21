"""Local dashboard: real Pi inputs only, independent source timing, bounded audit log."""

import asyncio, contextlib, json, math, os, re, sqlite3, time
from pathlib import Path
from contextlib import asynccontextmanager, contextmanager
from datetime import datetime, timezone
import httpx, websockets
from fastapi import FastAPI, HTTPException, Request, WebSocket
from fastapi.responses import JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, ConfigDict

ROOT = Path(__file__).resolve().parents[1]
DB = Path(os.environ.get("PI_DASHBOARD_DB", str(ROOT / "build/dashboard.sqlite3")))
DEFAULTS = {
    "braking": 3.5,
    "acceleration": 3.2,
    "cornering": 3.0,
    "rotation": 42.0,
    "vibration": 4.2,
    "persistence_ms": 150,
    "calibrated": False,
}


def utc():
    return (
        datetime.now(timezone.utc)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z")
    )


@contextmanager
def connect():
    DB.parent.mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(DB)
    c.row_factory = sqlite3.Row
    c.executescript(
        "CREATE TABLE IF NOT EXISTS drivers(uid TEXT PRIMARY KEY,name TEXT NOT NULL);CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY AUTOINCREMENT,timestamp TEXT,kind TEXT,message TEXT,severity TEXT,ack INTEGER DEFAULT 0);CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT);"
    )
    try:
        with c:
            yield c
    finally:
        c.close()


def settings():
    with connect() as c:
        r = c.execute("SELECT value FROM settings WHERE key='motion'").fetchone()
    return {**DEFAULTS, **(json.loads(r[0]) if r else {})}


def drivers():
    with connect() as c:
        return [dict(r) for r in c.execute("SELECT * FROM drivers ORDER BY name")]


def events():
    with connect() as c:
        return [
            dict(r)
            for r in c.execute("SELECT * FROM events ORDER BY id DESC LIMIT 100")
        ]


def event(kind, message, severity="info", stamp=None):
    with connect() as c:
        c.execute(
            "INSERT INTO events(timestamp,kind,message,severity) VALUES(?,?,?,?)",
            (stamp or utc(), kind, message, severity),
        )
        c.execute(
            "DELETE FROM events WHERE id NOT IN (SELECT id FROM events ORDER BY id DESC LIMIT 1000)"
        )


class Feed:
    def __init__(self):
        self.sensor = None
        self.sensor_at = 0.0
        self.fatigue = None
        self.fatigue_at = 0.0
        self.health = {}
        self.connected = False
        self.motion = "unavailable"
        self.last_motion_key = None
        self.hold = {}
        self.fired = {}
        self.vibration = []
        self.motion_cfg = settings()
        self.last_fatigue = None
        self.last_rfid_key = None

    def ingest(self, p):
        self.sensor = p
        self.sensor_at = time.monotonic()
        self.connected = True
        r = p["rfid"]
        key = json.dumps([p["source"]["esp_boot_id"], p["source"]["rfid_event_seq"]])
        if r["status"] == "ok" and r.get("card_id") and key != self.last_rfid_key:
            with connect() as c:
                old = c.execute(
                    "SELECT value FROM settings WHERE key='last_card_event'"
                ).fetchone()
                if old is None or old[0] != key:
                    name = next(
                        (d["name"] for d in drivers() if d["uid"] == r["card_id"]),
                        "Unassigned card",
                    )
                    c.execute(
                        "INSERT OR REPLACE INTO settings VALUES('last_card_event',?)",
                        (key,),
                    )
                    c.commit()
                    event(
                        "RFID",
                        name + " · " + r["card_id"],
                        stamp=r.get("last_scan_timestamp"),
                    )
            self.last_rfid_key = key
        self.detect_motion(p)

    def detect_motion(self, p):
        i = p["imu"]
        src = p["source"]
        key = (src["esp_boot_id"], src["imu_seq"]["linear"], src["imu_seq"]["gyro"])
        if i["status"] != "ok":
            self.motion = "unavailable"
            self.hold = {}
            self.vibration = []
            return
        if not self.motion_cfg["calibrated"]:
            self.motion = "awaiting axis calibration"
            self.hold = {}
            return
        if key == self.last_motion_key:
            return
        if self.last_motion_key and self.last_motion_key[0] != key[0]:
            self.hold = {}
            self.fired = {}
            self.vibration = []
        self.last_motion_key = key
        c = self.motion_cfg
        now = src["esp_uptime_us"] / 1e6
        a = [i["lin_accel_" + x] for x in "xyz"]
        g = [i["gyro_" + x] * 180 / math.pi for x in "xyz"]
        self.vibration = [v for v in self.vibration if now - v[0] <= 0.5]
        if not self.vibration or self.vibration[-1][0] != now:
            self.vibration.append((now, a))
        mean = [
            sum(v[1][j] for v in self.vibration) / len(self.vibration) for j in range(3)
        ]
        rms = math.sqrt(
            sum(sum((v[1][j] - mean[j]) ** 2 for j in range(3)) for v in self.vibration)
            / len(self.vibration)
        )
        candidates = {
            "harsh braking": a[0] < -c["braking"],
            "harsh acceleration": a[0] > c["acceleration"],
            "sharp cornering": abs(a[1]) > c["cornering"] and abs(g[2]) > c["rotation"],
            "high vibration": len(self.vibration) >= 3 and rms > c["vibration"],
        }
        active = []
        for name, on in candidates.items():
            if not on:
                self.hold.pop(name, None)
                self.fired.pop(name, None)
                continue
            start = self.hold.setdefault(name, now)
            if now - start >= c["persistence_ms"] / 1000:
                active.append(name)
                if name not in self.fired:
                    event(
                        "Motion",
                        name + " (prototype threshold)",
                        "warning",
                        i.get("received_at"),
                    )
                    self.fired[name] = now
        self.motion = ", ".join(active) or "normal"

    def snapshot(self):
        p = json.loads(json.dumps(self.sensor)) if self.sensor else None
        if p:
            p.pop("gps", None)
            if not self.connected or time.monotonic() - self.sensor_at > 1:
                for k in ("imu", "rfid", "ultrasonic"):
                    p[k]["status"] = "disconnected"
            u = p["ultrasonic"]
            u["estimated_distance_mm"] = None
            if u["status"] == "ok":
                if isinstance(u.get("echo_us"), (int, float)) and u["echo_us"] > 0:
                    u["estimated_distance_mm"] = round(u["echo_us"] * 0.343 / 2, 1)
                elif (
                    isinstance(u.get("distance_mm"), (int, float))
                    and u["distance_mm"] > 0
                ):
                    u["estimated_distance_mm"] = u["distance_mm"]
            else:
                u["distance_mm"] = None
                u["echo_us"] = None
            if p["imu"]["status"] != "ok":
                for k in p["imu"]:
                    if k.startswith(("lin_accel", "gyro")):
                        p["imu"][k] = None
                p["imu"]["quaternion"] = {k: None for k in "wxyz"}
            if p["rfid"].get("card_id"):
                p["rfid"]["driver_name"] = next(
                    (d["name"] for d in drivers() if d["uid"] == p["rfid"]["card_id"]),
                    None,
                )
        f = self.fatigue
        if f and time.monotonic() - self.fatigue_at > 1:
            f = {**f, "status": "unavailable", "results": None, "face_detected": None}
        return {
            "gateway_connected": self.connected
            and time.monotonic() - self.sensor_at <= 1,
            "sensor": p,
            "fatigue": f,
            "motion": (
                self.motion if p and p["imu"]["status"] == "ok" else "unavailable"
            ),
            "health": self.health,
            "server_time": utc(),
        }


feed = None


async def sensor_worker():
    while True:
        try:
            async with websockets.connect(
                "ws://127.0.0.1:8765/ws/sensors", max_size=65536
            ) as ws:
                async for raw in ws:
                    feed.ingest(json.loads(raw))
        except Exception:
            feed.connected = False
            feed.hold = {}
            await asyncio.sleep(1)


async def camera_worker():
    async with httpx.AsyncClient(timeout=1) as c:
        while True:
            try:
                r = await c.get("http://127.0.0.1:8766/api/v1/fatigue/latest")
                r.raise_for_status()
                p = r.json()
                feed.fatigue = p
                feed.fatigue_at = time.monotonic()
                key = (p["boot_id"], p["seq"])
                state = (
                    p["results"]["fatigue_state"]
                    if p.get("results") and p["status"] == "ok"
                    else None
                )
                if state in ("DROWSY", "CRITICAL") and state != feed.last_fatigue:
                    event(
                        "Fatigue",
                        "Model reports " + state,
                        "critical" if state == "CRITICAL" else "warning",
                        p.get("captured_at"),
                    )
                feed.last_fatigue = state
            except Exception:
                feed.fatigue = {
                    "status": "stopped or unavailable",
                    "results": None,
                    "face_detected": None,
                }
                feed.last_fatigue = None
            await asyncio.sleep(0.2)


async def health_worker():
    async with httpx.AsyncClient(timeout=1) as c:
        while True:
            try:
                r = await c.get("http://127.0.0.1:8765/health")
                r.raise_for_status()
                feed.health = r.json()
                feed.health.pop("status", None)
            except Exception:
                feed.health = {}
            await asyncio.sleep(5)


@asynccontextmanager
async def lifespan(app):
    global feed
    feed = Feed()
    tasks = [
        asyncio.create_task(f()) for f in (sensor_worker, camera_worker, health_worker)
    ]
    yield
    for t in tasks:
        t.cancel()
    for t in tasks:
        with contextlib.suppress(asyncio.CancelledError):
            await t


app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None)


@app.middleware("http")
async def local_origin(req: Request, next):
    if req.method not in ("GET", "HEAD"):
        origin = req.headers.get("origin")
        if origin and origin != str(req.base_url).rstrip("/"):
            return JSONResponse({"detail": "Same-origin requests only"}, 403)
        if int(req.headers.get("content-length", "0")) > 8192:
            return JSONResponse({"detail": "Body too large"}, 413)
    return await next(req)


@app.get("/api/pi/latest")
def latest():
    return feed.snapshot()


@app.websocket("/api/pi/stream")
async def stream(ws: WebSocket):
    origin = ws.headers.get("origin")
    if origin and origin not in (
        "http://" + ws.headers.get("host", ""),
        "https://" + ws.headers.get("host", ""),
    ):
        await ws.close(code=1008)
        return
    await ws.accept()
    try:
        while True:
            await asyncio.wait_for(ws.send_json(feed.snapshot()), 1)
            await asyncio.sleep(0.1)
    except Exception:
        pass


@app.get("/api/pi/drivers")
def get_drivers():
    return drivers()


class Driver(BaseModel):
    model_config = ConfigDict(extra="forbid")
    uid: str = Field(min_length=8, max_length=20, pattern=r"^(?:[0-9A-F]{2}){4,10}$")
    name: str = Field(min_length=1, max_length=80)


@app.put("/api/pi/drivers")
def save_driver(d: Driver):
    if not d.name.strip():
        raise HTTPException(422, "Driver name required")
    with connect() as c:
        c.execute("INSERT OR REPLACE INTO drivers VALUES(?,?)", (d.uid, d.name.strip()))
    return drivers()


@app.delete("/api/pi/drivers/{uid}")
def delete_driver(uid: str):
    with connect() as c:
        c.execute("DELETE FROM drivers WHERE uid=?", (uid,))
    return drivers()


@app.get("/api/pi/events")
def get_events():
    return events()


@app.post("/api/pi/events/{id}/ack")
def acknowledge(id: int):
    with connect() as c:
        c.execute("UPDATE events SET ack=1 WHERE id=?", (id,))
    return {"acknowledged": True}


class MotionConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    braking: float = Field(ge=0.1, le=30)
    acceleration: float = Field(ge=0.1, le=30)
    cornering: float = Field(ge=0.1, le=30)
    rotation: float = Field(ge=1, le=1000)
    vibration: float = Field(ge=0.1, le=100)
    persistence_ms: int = Field(ge=100, le=10000)
    calibrated: bool


@app.get("/api/pi/settings")
def get_settings():
    return settings()


@app.put("/api/pi/settings")
def put_settings(s: MotionConfig):
    with connect() as c:
        c.execute(
            "INSERT OR REPLACE INTO settings VALUES('motion',?)",
            (json.dumps(s.model_dump()),),
        )
    feed.motion_cfg = s.model_dump()
    feed.hold = {}
    feed.fired = {}
    return s


class Control(BaseModel):
    enabled: bool


@app.post("/api/pi/camera")
async def camera_control(s: Control):
    p = await asyncio.create_subprocess_exec(
        "systemctl",
        "--user",
        "start" if s.enabled else "stop",
        "prototype-camera.service",
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        _, err = await asyncio.wait_for(p.communicate(), 12)
    except asyncio.TimeoutError:
        p.kill()
        await p.wait()
        raise HTTPException(504, "Camera service control timed out")
    if p.returncode:
        raise HTTPException(503, "Camera service control failed")
    return {"enabled": s.enabled}


@app.get("/api/pi/camera/frame")
async def camera_frame():
    try:
        async with httpx.AsyncClient(timeout=1) as c:
            r = await c.get("http://127.0.0.1:8766/camera_feed")
            r.raise_for_status()
            return Response(
                r.content,
                media_type="image/jpeg",
                headers={"Cache-Control": "no-store"},
            )
    except Exception:
        raise HTTPException(503, "Camera is stopped or unavailable")


app.mount(
    "/",
    StaticFiles(
        directory=str(ROOT.parent / "dashboard-new/dist"), html=True, check_dir=False
    ),
    name="dashboard",
)
if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=3000, access_log=False)
