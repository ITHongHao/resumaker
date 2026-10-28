"""Host and Origin protection: DNS rebinding and cross-site requests are refused before any
route runs, so they have no side effect."""

import httpx
import pytest

from app.latex import compile as compile_mod
from app.main import app
from app.routes.ai import llm_dep
from app.routes.postings import http_client_dep

EVIL = "http://evil.example"


class RecordingLLM:
    def __init__(self):
        self.calls = 0

    def complete(self, system, user, images=[], json_schema=None):
        self.calls += 1
        return '{"title": "", "company": "", "requirements": []}'


@pytest.fixture
def spies(client, monkeypatch):
    llm = RecordingLLM()
    fetched: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        fetched.append(str(request.url))
        return httpx.Response(200, text="<p>job</p>")

    app.dependency_overrides[llm_dep] = lambda: llm
    app.dependency_overrides[http_client_dep] = lambda: httpx.Client(transport=httpx.MockTransport(handler))
    compiled: list[str] = []
    monkeypatch.setattr(compile_mod.subprocess, "run",
                        lambda *a, **k: compiled.append("ran") or (_ for _ in ()).throw(FileNotFoundError()))
    yield {"llm": llm, "fetched": fetched, "compiled": compiled}
    app.dependency_overrides.clear()


def _job(client):
    r = client.post("/api/jobs", json={"company": "Acme", "title": "Dev"})
    assert r.status_code == 201
    return r.json()


@pytest.mark.parametrize("host", ["localhost:8000", "127.0.0.1:8000", "[::1]:8000", "localhost",
                                  "127.0.0.1", "[::1]", "testserver", "LOCALHOST:5173"])
def test_loopback_hosts_pass(client, host):
    r = client.get("/api/health", headers={"Host": host})
    assert r.status_code == 200


@pytest.mark.parametrize("path", ["/api/health", "/api/export", "/api/settings", "/api/nope"])
def test_foreign_host_is_403(client, path):
    r = client.get(path, headers={"Host": "attacker.example:8000"})
    assert r.status_code == 403
    assert r.headers["content-type"].startswith("application/json")
    assert "detail" in r.json()


def test_foreign_host_403_on_writes_too(client):
    r = client.post("/api/jobs", json={"company": "X", "title": "Y"}, headers={"Host": "attacker.example"})
    assert r.status_code == 403
    assert client.get("/api/jobs").json() == []


def test_evil_origin_post_posting_has_no_side_effect(client, spies):
    r = client.post("/api/postings", data={"url": "https://jobs.example/1"}, headers={"Origin": EVIL})
    assert r.status_code == 403
    assert spies["fetched"] == [] and spies["llm"].calls == 0
    assert client.get("/api/postings").json() == []


def test_evil_origin_import_leaves_db_unchanged(client):
    job = _job(client)
    doc = {"schema_version": 1, "jobs": [], "cards": [], "profile": {}}
    r = client.post("/api/import", json=doc, headers={"Origin": EVIL})
    assert r.status_code == 403
    assert client.get("/api/jobs").json() == [job]


def test_evil_origin_compile_never_runs(client, spies):
    r = client.post("/api/latex/compile", json={"tex": "x"}, headers={"Origin": EVIL})
    assert r.status_code == 403
    assert spies["compiled"] == []


def test_evil_origin_put_settings_changes_nothing(client, tmp_path):
    before = client.get("/api/settings").json()
    r = client.put("/api/settings", json={"provider": "openai", "model": "m", "api_key": "sk-evil"},
                   headers={"Origin": EVIL})
    assert r.status_code == 403
    assert "sk-evil" not in r.text
    assert client.get("/api/settings").json() == before
    assert not (tmp_path / "home" / "keys.json").exists()


@pytest.mark.parametrize("origin", ["null", "http://localhost.evil.example", "http://127.0.0.1.nip.io",
                                    "http://evil.example:5173", "file://"])
def test_other_bad_origins_rejected(client, origin):
    r = client.post("/api/jobs", json={"company": "X", "title": "Y"}, headers={"Origin": origin})
    assert r.status_code == 403
    assert client.get("/api/jobs").json() == []


@pytest.mark.parametrize("origin", ["http://localhost:5173", "http://127.0.0.1:5273", "http://[::1]:5173"])
def test_loopback_origins_pass(client, origin):
    r = client.post("/api/jobs", json={"company": "X", "title": "Y"}, headers={"Origin": origin})
    assert r.status_code == 201


def test_vite_proxy_shape_passes(client):
    # The dev proxy forwards the browser's Host (localhost:5173) or, with changeOrigin, the
    # target's (localhost:8000); the Origin is the dev page.
    for host in ("localhost:5173", "localhost:8000"):
        r = client.post("/api/jobs", json={"company": "X", "title": host},
                        headers={"Host": host, "Origin": "http://localhost:5173"})
        assert r.status_code == 201


def test_no_origin_is_allowed_for_curl_and_server_side(client):
    r = client.post("/api/jobs", json={"company": "X", "title": "Y"})
    assert r.status_code == 201


def test_evil_origin_on_get_is_not_blocked_by_origin_rule(client):
    # A cross-site GET cannot read the response (no CORS); the Host rule still applies.
    assert client.get("/api/health", headers={"Origin": EVIL}).status_code == 200


def test_cross_site_fetch_metadata_without_origin_rejected(client):
    r = client.post("/api/jobs", json={"company": "X", "title": "Y"}, headers={"Sec-Fetch-Site": "cross-site"})
    assert r.status_code == 403
    for site in ("same-origin", "same-site", "none"):
        assert client.post("/api/jobs", json={"company": "X", "title": site},
                           headers={"Sec-Fetch-Site": site}).status_code == 201
    # GET with cross-site metadata is not a write; allowed.
    assert client.get("/api/health", headers={"Sec-Fetch-Site": "cross-site"}).status_code == 200


def test_no_permissive_cors(client):
    r = client.get("/api/health", headers={"Origin": "http://localhost:5173"})
    assert "access-control-allow-origin" not in {k.lower() for k in r.headers}


def test_allowed_hosts_env_is_additive(client, monkeypatch):
    monkeypatch.setenv("RESUMAKER_ALLOWED_HOSTS", "resumaker.lan, Other.Lan:9000")
    assert client.get("/api/health", headers={"Host": "resumaker.lan:8000"}).status_code == 200
    assert client.get("/api/health", headers={"Host": "other.lan"}).status_code == 200
    assert client.get("/api/health", headers={"Host": "localhost"}).status_code == 200
    assert client.post("/api/jobs", json={"company": "X", "title": "Y"},
                       headers={"Host": "resumaker.lan", "Origin": "http://resumaker.lan:5173"}).status_code == 201
    assert client.get("/api/health", headers={"Host": "attacker.example"}).status_code == 403
