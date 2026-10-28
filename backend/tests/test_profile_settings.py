import os
import stat

from app.keystore import FileKeyStore, home_dir


def test_settings_never_returns_key(client, tmp_path, caplog):
    assert client.get("/api/settings").json() == {
        "provider": "anthropic", "model": "", "has_key": False}
    r = client.put("/api/settings", json={
        "provider": "anthropic", "model": "m1", "api_key": "sk-secret-123"})
    assert r.status_code == 200
    assert r.json() == {"provider": "anthropic", "model": "m1", "has_key": True}
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
