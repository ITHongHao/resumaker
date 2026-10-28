import json
import sqlite3

import pytest
from alembic import command
from alembic.config import Config

from app import db

PREV = "b4e8d1a6c350"


def _cfg():
    cfg = Config(str(db.BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(db.BACKEND_DIR / "migrations"))
    return cfg


def _card(con, job_id, kind, title, desc, details, tags):
    con.execute(
        "INSERT INTO card (job_id, kind, title, description, details, tags, extra)"
        " VALUES (?,?,?,?,?,?,?)",
        (job_id, kind, title, desc, details, json.dumps(tags), "{}"),
    )


@pytest.fixture
def old_db(tmp_path, monkeypatch):
    path = tmp_path / "old.db"
    monkeypatch.setenv("RESUMAKER_DB", str(path))
    command.upgrade(_cfg(), PREV)
    con = sqlite3.connect(path)
    con.execute("INSERT INTO job (company, title, location, employment_type, start_date, end_date,"
                " manager_contact, reason_for_leaving, extra) VALUES ('Co','Dev','','','','','','','{}')")
    jid = con.execute("SELECT id FROM job").fetchone()[0]
    _card(con, jid, "behavioral", "Led a migration", "I led it.", "More detail.", ["lead", "infra"])
    _card(con, None, "behavioral", "Bare story", "Just this.", "", [])
    _card(con, None, "behavioral", "Details only", "", "Only details.", [])
    _card(con, None, "skill", "Python", "", "", [])
    con.commit()
    con.close()
    return path, jid


def test_migration_copies_behavioral_cards(old_db):
    path, jid = old_db
    command.upgrade(_cfg(), "head")
    con = sqlite3.connect(path)
    qs = con.execute("SELECT id, text, category FROM interviewquestion ORDER BY id").fetchall()
    assert [(t, c) for _, t, c in qs] == [
        ("Led a migration", "Mine"), ("Bare story", "Mine"), ("Details only", "Mine")]
    ans = con.execute(
        "SELECT question_ref, situation, task, action, result, source_card_ids, job_id"
        " FROM interviewanswer ORDER BY id").fetchall()
    assert len(ans) == 3
    assert ans[2][3] == "Only details."
    assert ans[0][0] == f"c:{qs[0][0]}"
    assert ans[0][1:3] == ("", "") and ans[0][4] == ""
    assert ans[0][3] == "I led it.\n\nMore detail.\n\nTags: lead, infra"
    assert json.loads(ans[0][5]) == [] and ans[0][6] == jid
    assert ans[1][0] == f"c:{qs[1][0]}"
    assert ans[1][3] == "Just this." and ans[1][6] is None
    kinds = [r[0] for r in con.execute("SELECT kind FROM card ORDER BY id")]
    assert kinds == ["behavioral", "behavioral", "behavioral", "skill"]
    assert con.execute("SELECT title FROM card WHERE kind='skill'").fetchone()[0] == "Python"
    con.close()


def test_startup_path_fresh_and_existing(tmp_path, monkeypatch, old_db):
    path, _ = old_db
    db.init_db()  # existing DB at old revision
    db.init_db()  # already at head: no duplicate data
    con = sqlite3.connect(path)
    assert con.execute("SELECT count(*) FROM interviewquestion").fetchone()[0] == 3
    con.close()
    monkeypatch.setenv("RESUMAKER_DB", str(tmp_path / "fresh" / "f.db"))
    (tmp_path / "fresh").mkdir()
    db.init_db()
    con = sqlite3.connect(tmp_path / "fresh" / "f.db")
    assert con.execute("SELECT count(*) FROM interviewquestion").fetchone()[0] == 0
    con.close()
