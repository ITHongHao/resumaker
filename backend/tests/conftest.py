import pytest
from fastapi.testclient import TestClient

from app import db
from app.main import app


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("RESUMAKER_DB", str(tmp_path / "test.db"))
    monkeypatch.setenv("RESUMAKER_HOME", str(tmp_path / "home"))
    db.get_engine.cache_clear()
    db.init_db()
    with TestClient(app) as c:
        yield c
    db.get_engine().dispose()
    db.get_engine.cache_clear()
