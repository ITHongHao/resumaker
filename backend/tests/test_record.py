import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app import db
from app.main import app


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("RESUMAKER_DB", str(tmp_path / "test.db"))
    db.get_engine.cache_clear()
    db.init_db()
    with TestClient(app) as c:
        yield c
    db.get_engine().dispose()
    db.get_engine.cache_clear()


JOB = {"company": "Acme", "title": "Engineer", "location": "Remote"}


def test_create_job_then_list(client):
    r = client.post("/api/jobs", json=JOB)
    assert r.status_code == 201
    job = r.json()
    assert job["id"] and job["company"] == "Acme"
    assert client.get("/api/jobs").json() == [job]
    assert client.get(f"/api/jobs/{job['id']}").json() == job
    r = client.patch(f"/api/jobs/{job['id']}", json={"title": "Staff Engineer"})
    assert r.json()["title"] == "Staff Engineer"
    assert client.get("/api/jobs/999").status_code == 404


def test_card_belongs_to_job_and_filters_by_tag(client):
    job_id = client.post("/api/jobs", json=JOB).json()["id"]
    a = client.post("/api/cards", json={
        "job_id": job_id, "kind": "project", "title": "Search",
        "tags": ["python", "search"], "extra": {"team": 3}}).json()
    client.post("/api/cards", json={
        "job_id": job_id, "kind": "accomplishment", "title": "Cut costs",
        "tags": ["ops"]})
    assert a["tags"] == ["python", "search"] and a["extra"] == {"team": 3}
    titles = lambda q: [c["title"] for c in client.get("/api/cards", params=q).json()]
    assert titles({"tag": "python"}) == ["Search"]
    assert titles({"job_id": job_id}) == ["Search", "Cut costs"]
    assert titles({"kind": "accomplishment"}) == ["Cut costs"]
    assert titles({"tag": "pyth"}) == []
    r = client.patch(f"/api/cards/{a['id']}", json={"tags": ["go"]})
    assert r.json()["tags"] == ["go"]
    assert client.delete(f"/api/cards/{a['id']}").status_code == 204
    assert titles({}) == ["Cut costs"]


def test_delete_job_cascades_cards(client):
    job_id = client.post("/api/jobs", json=JOB).json()["id"]
    client.post("/api/cards", json={"job_id": job_id, "kind": "project", "title": "P"})
    client.post("/api/cards", json={"kind": "skill", "title": "Python"})
    assert client.delete(f"/api/jobs/{job_id}").status_code == 204
    assert [c["title"] for c in client.get("/api/cards").json()] == ["Python"]


def test_education_card_has_no_job(client):
    r = client.post("/api/cards", json={
        "kind": "education", "title": "BSc CS",
        "extra": {"org": "MIT", "end": "2015"}})
    assert r.status_code == 201
    assert r.json()["job_id"] is None
    assert client.post("/api/cards", json={"kind": "bogus", "title": "x"}).status_code == 422
    assert client.post("/api/cards", json={"kind": "project", "title": "x", "job_id": 99}).status_code == 404


def test_record_hash_changes_when_card_edited(client):
    card = client.post("/api/cards", json={"kind": "skill", "title": "Python"}).json()
    with Session(db.get_engine()) as s:
        h1 = db.record_hash(s)
        assert db.record_hash(s) == h1
    client.patch(f"/api/cards/{card['id']}", json={"description": "expert"})
    with Session(db.get_engine()) as s:
        h2 = db.record_hash(s)
    assert h2 != h1
    client.post("/api/jobs", json=JOB)
    with Session(db.get_engine()) as s:
        assert db.record_hash(s) != h2
