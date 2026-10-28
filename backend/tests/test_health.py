from fastapi.testclient import TestClient

from app.main import app


def test_health_ok():
    assert TestClient(app).get("/api/health").json() == {"status": "ok"}


def test_first_run_creates_missing_data_directory(tmp_path, monkeypatch):
    from app import db

    target = tmp_path / "not" / "yet" / "r.db"
    monkeypatch.setenv("RESUMAKER_DB", str(target))
    db.get_engine.cache_clear()
    db.init_db()
    assert target.exists()
    db.get_engine.cache_clear()
