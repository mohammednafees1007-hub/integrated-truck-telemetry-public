"""Isolated state/API tests; no live sensor or camera modifications."""

import time
import pytest, yaml
from fastapi.testclient import TestClient
from pi_gateway.state import State
from dashboard_service import app as m


@pytest.fixture
def dashboard(tmp_path, monkeypatch):
    monkeypatch.setattr(m, "DB", tmp_path / "dashboard.sqlite3")
    f = m.Feed()
    monkeypatch.setattr(m, "feed", f)
    return f, TestClient(m.app)


def sample():
    state = State(yaml.safe_load(open("config.example.yaml")))
    state.connected = True
    state.ingest(
        dict(
            v=1,
            boot="fixture",
            seq=1,
            t_us=1000000,
            imu=dict(
                a=[0.0, 0.0, 0.0],
                g=[0.0, 0.0, 0.0],
                q=[1.0, 0.0, 0.0, 0.0],
                n=[1, 1, 1],
                us=[990000] * 3,
                s=[0] * 3,
                state="ok",
            ),
            us=dict(mm=None, echo_us=None, n=None, t_us=None, state="unconfigured"),
            rfid=dict(uid="AABBCCDD", event=1, t_us=800000, state="ok"),
        )
    )
    return state.snapshot()


def test_driver_mapping_persists_and_no_vehicle_control(dashboard):
    f, c = dashboard
    assert (
        c.put(
            "/api/pi/drivers", json={"uid": "AABBCCDD", "name": "Test driver"}
        ).status_code
        == 200
    )
    p = sample()
    f.ingest(p)
    f.ingest(p)
    assert f.snapshot()["sensor"]["rfid"]["driver_name"] == "Test driver"
    assert len(m.events()) == 1
    assert m.Feed().snapshot()["sensor"] is None
    assert m.drivers() == [{"uid": "AABBCCDD", "name": "Test driver"}]
    assert "ignition" not in f.snapshot()["sensor"]
    assert c.delete("/api/pi/drivers/AABBCCDD").status_code == 200
    assert f.snapshot()["sensor"]["rfid"]["driver_name"] is None
    assert c.put("/api/pi/drivers", json={"uid": "bad", "name": "x"}).status_code == 422
    assert (
        c.put("/api/pi/drivers", json={"uid": "AABBCCDD", "name": " "}).status_code
        == 422
    )


def test_stale_and_excluded_sources(dashboard):
    f, c = dashboard
    f.ingest(sample())
    p = f.snapshot()
    assert "gps" not in p["sensor"] and "ultrasonic" in p["sensor"]
    original = f.sensor["imu"]["received_at"]
    f.sensor_at -= 2
    p = f.snapshot()
    assert (
        p["sensor"]["imu"]["status"] == "disconnected"
        and p["sensor"]["imu"]["lin_accel_x"] is None
    )
    assert (
        p["sensor"]["imu"]["received_at"] == original and p["motion"] == "unavailable"
    )
    f.fatigue = {
        "status": "ok",
        "face_detected": True,
        "results": {"fatigue_score": 90},
    }
    f.fatigue_at = time.monotonic() - 2
    assert f.snapshot()["fatigue"]["results"] is None


def test_motion_distinct_samples_persistence_and_reboot(dashboard):
    f, c = dashboard
    p = sample()
    p["imu"]["lin_accel_x"] = 5
    f.ingest(p)
    assert f.motion == "awaiting axis calibration"
    cfg = {**m.DEFAULTS, "calibrated": True}
    assert c.put("/api/pi/settings", json=cfg).status_code == 200
    f.ingest(p)
    for _ in range(5):
        f.ingest(p)
    assert not any(e["kind"] == "Motion" for e in m.events())
    p["source"]["imu_seq"]["linear"] += 1
    p["source"]["esp_uptime_us"] += 200000
    f.ingest(p)
    assert f.motion == "harsh acceleration"
    assert sum(e["kind"] == "Motion" for e in m.events()) == 1
    p["source"]["imu_seq"]["linear"] += 1
    p["source"]["esp_uptime_us"] += 20000
    f.ingest(p)
    assert sum(e["kind"] == "Motion" for e in m.events()) == 1
    p["source"]["esp_boot_id"] = "restart"
    p["source"]["esp_uptime_us"] = 100
    f.ingest(p)
    assert f.motion == "normal" and len(f.fired) == 0
    cfg["persistence_ms"] = 0
    assert c.put("/api/pi/settings", json=cfg).status_code == 422
    assert m.Feed().motion_cfg["calibrated"] is True


def test_api_origin_log_ack(dashboard):
    f, c = dashboard
    assert (
        c.put(
            "/api/pi/drivers",
            headers={"Origin": "https://untrusted.example"},
            json={"uid": "AABBCCDD", "name": "x"},
        ).status_code
        == 403
    )
    m.event("Test", "isolated fixture")
    id = m.events()[0]["id"]
    assert c.post(f"/api/pi/events/{id}/ack").json()["acknowledged"]
    assert m.events()[0]["ack"] == 1


def test_gateway_and_imu_status_are_independent(dashboard):
    f, c = dashboard
    p = sample()
    p["imu"]["status"] = "disconnected"
    f.ingest(p)
    snapshot = f.snapshot()
    assert snapshot["gateway_connected"] is True
    assert snapshot["sensor"]["imu"]["status"] == "disconnected"
    f.connected = False
    assert f.snapshot()["gateway_connected"] is False


def test_ultrasonic_conversion_and_stale_masking(dashboard):
    f, c = dashboard
    p = sample()
    p["ultrasonic"] = {
        "status": "ok",
        "distance_mm": None,
        "echo_us": 3500,
        "received_at": "2026-10-18T10:00:00.000Z",
    }
    f.ingest(p)
    assert f.snapshot()["sensor"]["ultrasonic"]["estimated_distance_mm"] == 600.2
    assert f.snapshot()["sensor"]["ultrasonic"]["echo_us"] == 3500
    p["ultrasonic"]["status"] = "invalid"
    f.ingest(p)
    assert f.snapshot()["sensor"]["ultrasonic"]["estimated_distance_mm"] is None
    assert f.snapshot()["sensor"]["ultrasonic"]["echo_us"] is None
    p["ultrasonic"]["status"] = "ok"
    f.ingest(p)
    f.sensor_at -= 2
    assert f.snapshot()["sensor"]["ultrasonic"]["status"] == "disconnected"
    assert f.snapshot()["sensor"]["ultrasonic"]["estimated_distance_mm"] is None
