import json
import os
import stat

from app.keystore import FileKeyStore, home_dir


def test_settings_never_returns_key(client, tmp_path, caplog):
    assert client.get("/api/settings").json() == {
        "provider": "anthropic", "model": "", "base_url": "", "has_key": False}
    r = client.put("/api/settings", json={
        "provider": "anthropic", "model": "m1", "api_key": "sk-secret-123"})
    assert r.status_code == 200
    assert r.json() == {
        "provider": "anthropic", "model": "m1", "base_url": "", "has_key": True}
    got = client.get("/api/settings")
    assert "sk-secret-123" not in got.text and "api_key" not in got.json()
    assert "sk-secret-123" not in r.text
    assert "sk-secret-123" not in caplog.text
    # has_key is per selected provider; omitting api_key keeps the stored key
    assert client.put("/api/settings", json={"provider": "openai", "model": "g"}).json()[
        "has_key"] is False
    assert client.put("/api/settings", json={"provider": "anthropic", "model": "m2"}).json()[
        "has_key"] is True
    assert client.put("/api/settings", json={"provider": "gemini", "model": "x"}).status_code == 422
    assert client.put("/api/settings", json={"provider": "openai", "model": None}).status_code == 422
    # key landed under the temp home, never the real one
    assert (home_dir()).is_relative_to(tmp_path)
    saved = json.loads((tmp_path / "home" / "keys.json").read_text())
    assert saved == {"anthropic": "sk-secret-123"}


def test_validation_errors_never_echo_api_key(client):
    key = "sk-leak-me-456"
    r = client.put("/api/settings", json={"provider": "openai", "api_key": key})
    assert r.status_code == 422 and key not in r.text
    r = client.put("/api/settings", json={"provider": "openai", "model": 5, "api_key": key})
    assert r.status_code == 422 and key not in r.text
    r = client.put("/api/settings", json={"provider": "bogus", "model": "m", "api_key": key})
    assert r.status_code == 422 and key not in r.text


def test_422_detail_is_stripped_app_wide(client):
    r = client.post("/api/jobs", json={"company": 5, "secret": "zzz"})
    assert r.status_code == 422
    detail = r.json()["detail"]
    assert detail and all("loc" in e and "msg" in e and "type" in e for e in detail)
    assert all("input" not in e and "ctx" not in e for e in detail)


def test_filekeystore_file_mode_is_0600(tmp_path):
    path = tmp_path / "sub" / "keys.json"
    store = FileKeyStore(path)
    assert store.get("openai") is None
    store.set("openai", "k1")
    store.set("anthropic", "k2")
    assert stat.S_IMODE(os.stat(path).st_mode) == 0o600
    assert FileKeyStore(path).get("openai") == "k1"
    assert FileKeyStore(path).get("anthropic") == "k2"


def test_profile_roundtrip(client):
    assert client.get("/api/profile").json() == {
        "name": "", "email": "", "phone": "", "links": [], "work_authorization": ""}
    body = {"name": "Ada", "email": "ada@x.io", "phone": "555",
            "links": ["https://a.dev", "https://gh.com/ada"], "work_authorization": "citizen"}
    assert client.put("/api/profile", json=body).json() == body
    assert client.get("/api/profile").json() == body
    assert client.put("/api/profile", json={**body, "name": None}).status_code == 422
    assert client.get("/api/profile").json() == body


def test_custom_provider_settings_validate_url_and_need_no_key(client):
    ok = client.put("/api/settings", json={
        "provider": "custom", "model": "llama3", "base_url": " http://localhost:11434/v1/ "})
    assert ok.status_code == 200
    assert ok.json() == {
        "provider": "custom", "model": "llama3", "base_url": "http://localhost:11434/v1",
        "has_key": False}
    for body in (
        {"provider": "custom", "model": "m", "base_url": ""},
        {"provider": "custom", "model": "m", "base_url": "localhost:11434"},
        {"provider": "custom", "model": "m", "base_url": "file:///etc/passwd"},
        {"provider": "custom", "model": "  ", "base_url": "http://localhost:1/v1"},
        {"provider": "openai", "model": "m", "base_url": "ftp://x"},
    ):
        assert client.put("/api/settings", json=body).status_code == 422, body
