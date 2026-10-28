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


def test_fake_llm_prints_one_startup_warning_to_stderr(tmp_path, monkeypatch, capsys):
    from fastapi.testclient import TestClient

    from app import db
    from app.main import app

    monkeypatch.setenv("RESUMAKER_DB", str(tmp_path / "t.db"))
    monkeypatch.setenv("RESUMAKER_HOME", str(tmp_path / "home"))
    db.get_engine.cache_clear()
    monkeypatch.setenv("RESUMAKER_FAKE_LLM", "1")
    with TestClient(app) as c:
        r = c.get("/api/health")
    err = capsys.readouterr().err
    assert err.count("RESUMAKER_FAKE_LLM") == 1 and "fake" in err.lower()
    assert r.json() == {"status": "ok"} and "fake" not in r.text.lower()

    monkeypatch.delenv("RESUMAKER_FAKE_LLM")
    with TestClient(app):
        pass
    assert "RESUMAKER_FAKE_LLM" not in capsys.readouterr().err
    db.get_engine().dispose()
    db.get_engine.cache_clear()
