"""Card ids are never reused, so an answer's source_card_ids can never come to point at a new,
unrelated card after its source is deleted (SQLite reuses the highest rowid without AUTOINCREMENT)."""
import json
import sqlite3

from alembic import command
from alembic.config import Config

from app import db

PREV = "c7a2f9e5b814"


def _cfg():
    cfg = Config(str(db.BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(db.BACKEND_DIR / "migrations"))
    return cfg


def _ans(client, ids):
    r = client.post("/api/interview/answers", json={
        "question_ref": "b:most-technical", "situation": "s", "source_card_ids": ids})
    assert r.status_code == 201, r.text
    return r.json()


def _sources(client):
    return client.get("/api/interview/answers?question_ref=b:most-technical").json()[0]["source_cards"]


def test_deleted_highest_card_id_is_not_reused(client):
    client.post("/api/cards", json={"kind": "project", "title": "Old"})
    top = client.post("/api/cards", json={"kind": "project", "title": "Cited"}).json()
    _ans(client, [top["id"]])
    assert client.delete(f"/api/cards/{top['id']}").status_code == 204
    new = client.post("/api/cards", json={"kind": "skill", "title": "Unrelated"}).json()
    assert new["id"] != top["id"]
    assert _sources(client) == [{"id": top["id"], "removed": True}]


def test_cards_removed_with_their_job_are_not_reused(client):
    job = client.post("/api/jobs", json={"company": "Co", "title": "Dev"}).json()
    card = client.post("/api/cards", json={"kind": "project", "title": "Cited",
                                           "job_id": job["id"]}).json()
    _ans(client, [card["id"]])
    assert client.delete(f"/api/jobs/{job['id']}").status_code == 204
    new = client.post("/api/cards", json={"kind": "skill", "title": "Unrelated"}).json()
    assert new["id"] != card["id"]
    assert _sources(client) == [{"id": card["id"], "removed": True}]


def test_ids_stay_unique_after_import(client):
    card = client.post("/api/cards", json={"kind": "project", "title": "Cited"}).json()
    _ans(client, [card["id"]])
    doc = client.get("/api/export").json()
    assert client.post("/api/import", json=doc).status_code == 200
    assert _sources(client) == [{"id": card["id"], "title": "Cited"}]
    client.delete(f"/api/cards/{card['id']}")
    new = client.post("/api/cards", json={"kind": "skill", "title": "Unrelated"}).json()
    assert new["id"] != card["id"]
    assert _sources(client) == [{"id": card["id"], "removed": True}]


def _old_db(tmp_path, monkeypatch):
    path = tmp_path / "old.db"
    monkeypatch.setenv("RESUMAKER_DB", str(path))
    command.upgrade(_cfg(), PREV)
    con = sqlite3.connect(path)
    con.execute("INSERT INTO job (company, title, location, employment_type, start_date, end_date,"
                " manager_contact, reason_for_leaving, extra) VALUES ('Co','Dev','','','','','','','{}')")
    for i, title in enumerate(["A", "B", "C"], start=1):
        con.execute("INSERT INTO card (id, job_id, kind, title, description, details, tags, extra)"
                    " VALUES (?, 1, 'project', ?, 'd', '', '[\"x\"]', '{\"k\": \"v\"}')", (i, title))
    con.execute("DELETE FROM card WHERE id = 3")
    # Answers made before the upgrade: one cites a card deleted before the upgrade (id 7,
    # above every live id), one a live card.
    for ids in ([7], [2]):
        con.execute("INSERT INTO interviewanswer (question_ref, situation, task, action, result,"
                    " source_card_ids, job_id, created_at) VALUES ('b:most-technical','','','','',"
                    " ?, NULL, '')", (json.dumps(ids),))
    con.commit()
    con.close()
    return path


def test_migration_keeps_cards_and_stops_id_reuse(tmp_path, monkeypatch):
    path = _old_db(tmp_path, monkeypatch)
    command.upgrade(_cfg(), "head")
    con = sqlite3.connect(path)
    con.execute("PRAGMA foreign_keys=ON")
    rows = con.execute("SELECT id, job_id, kind, title, description, tags, extra FROM card"
                       " ORDER BY id").fetchall()
    assert rows == [(1, 1, "project", "A", "d", '["x"]', '{"k": "v"}'),
                    (2, 1, "project", "B", "d", '["x"]', '{"k": "v"}')]
    assert "AUTOINCREMENT" in con.execute(
        "SELECT sql FROM sqlite_master WHERE name = 'card'").fetchone()[0].upper()
    assert con.execute("SELECT name FROM sqlite_master WHERE name = 'ix_card_kind'").fetchone()
    # Neither the card deleted before the upgrade (3) nor the one an answer still cites (7)
    # gets its id back.
    cur = con.execute("INSERT INTO card (kind, title, description, details, tags, extra)"
                      " VALUES ('skill', 'New', '', '', '[]', '{}')")
    assert cur.lastrowid == 8
    # The job foreign key still cascades.
    con.execute("DELETE FROM job WHERE id = 1")
    assert con.execute("SELECT id FROM card ORDER BY id").fetchall() == [(8,)]
    con.close()


def test_migration_downgrade_round_trips(tmp_path, monkeypatch):
    path = _old_db(tmp_path, monkeypatch)
    command.upgrade(_cfg(), "head")
    command.downgrade(_cfg(), PREV)
    con = sqlite3.connect(path)
    assert [r[0] for r in con.execute("SELECT id FROM card ORDER BY id")] == [1, 2]
    con.close()
    command.upgrade(_cfg(), "head")
