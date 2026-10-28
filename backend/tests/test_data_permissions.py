"""The data directory and the SQLite file are private to the user (0700 / 0600)."""

import os
import stat

import pytest

from app import db
from app.keystore import get_keystore


def mode(p):
    return stat.S_IMODE(os.stat(p).st_mode)


@pytest.fixture
def fresh(tmp_path, monkeypatch):
    monkeypatch.setenv("HOME", str(tmp_path / "home"))
    (tmp_path / "home").mkdir()
    monkeypatch.delenv("RESUMAKER_DB", raising=False)
    monkeypatch.delenv("RESUMAKER_HOME", raising=False)
    old = os.umask(0o022)
    db.get_engine.cache_clear()
    yield tmp_path
    db.get_engine().dispose()
    db.get_engine.cache_clear()
    os.umask(old)


def test_default_dir_and_db_are_private(fresh):
    db.init_db()
    data = fresh / "home" / ".resumaker"
    assert mode(data) == 0o700
    assert mode(data / "resumaker.db") == 0o600
    get_keystore().set("anthropic", "sk-x")
    assert mode(data) == 0o700 and mode(data / "keys.json") == 0o600


def test_existing_default_dir_and_db_are_tightened(fresh):
    data = fresh / "home" / ".resumaker"
    data.mkdir(mode=0o755)
    os.chmod(data, 0o755)
    (data / "resumaker.db").touch()
    os.chmod(data / "resumaker.db", 0o644)
    db.init_db()
    assert mode(data) == 0o700
    assert mode(data / "resumaker.db") == 0o600


def test_user_chosen_existing_dir_is_left_alone_but_new_db_is_private(fresh, monkeypatch):
    shared = fresh / "shared"
    shared.mkdir()
    os.chmod(shared, 0o755)
    monkeypatch.setenv("RESUMAKER_DB", str(shared / "r.db"))
    db.init_db()
    assert mode(shared) == 0o755
    assert mode(shared / "r.db") == 0o600


def test_user_chosen_existing_db_file_is_left_alone(fresh, monkeypatch):
    shared = fresh / "shared"
    shared.mkdir()
    (shared / "r.db").touch()
    os.chmod(shared / "r.db", 0o640)
    monkeypatch.setenv("RESUMAKER_DB", str(shared / "r.db"))
    db.init_db()
    assert mode(shared / "r.db") == 0o640


def test_user_chosen_dir_we_create_is_private(fresh, monkeypatch):
    monkeypatch.setenv("RESUMAKER_DB", str(fresh / "new" / "deep" / "r.db"))
    monkeypatch.setenv("RESUMAKER_HOME", str(fresh / "keys-here"))
    db.init_db()
    assert mode(fresh / "new" / "deep") == 0o700
    assert mode(fresh / "new" / "deep" / "r.db") == 0o600
    get_keystore().set("openai", "sk-y")
    assert mode(fresh / "keys-here") == 0o700


def test_user_chosen_existing_keys_dir_is_left_alone(fresh, monkeypatch):
    keys = fresh / "keys-here"
    keys.mkdir()
    os.chmod(keys, 0o750)
    monkeypatch.setenv("RESUMAKER_HOME", str(keys))
    get_keystore().set("openai", "sk-y")
    assert mode(keys) == 0o750 and mode(keys / "keys.json") == 0o600
