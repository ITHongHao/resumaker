def _seed(client):
    job = client.post("/api/jobs", json={"company": "Acme", "title": "Eng"}).json()
    client.post("/api/cards", json={"job_id": job["id"], "kind": "project", "title": "Search",
                                    "tags": ["py"], "extra": {"n": 1}})
    client.post("/api/cards", json={"kind": "skill", "title": "Python"})
    client.put("/api/profile", json={"name": "Ada", "links": ["https://a.dev"]})
    client.put("/api/settings", json={"provider": "openai", "model": "g", "api_key": "sk-zzz"})


def test_export_then_import_restores_record(client):
    _seed(client)
    exported = client.get("/api/export")
    assert exported.status_code == 200
    doc = exported.json()
    assert doc["schema_version"] == 1
    assert "sk-zzz" not in exported.text and "settings" not in doc
    jobs, cards = client.get("/api/jobs").json(), client.get("/api/cards").json()
    profile = client.get("/api/profile").json()

    # mutate everything, then restore
    client.delete(f"/api/jobs/{jobs[0]['id']}")
    client.put("/api/profile", json={"name": "Other"})
    client.put("/api/settings", json={"provider": "anthropic", "model": "keep"})
    r = client.post("/api/import", json=doc)
    assert r.status_code == 200

    assert client.get("/api/jobs").json() == jobs
    assert client.get("/api/cards").json() == cards
    assert client.get("/api/profile").json() == profile
    # settings untouched by import
    assert client.get("/api/settings").json() == {
        "provider": "anthropic", "model": "keep", "has_key": False}
    assert client.get("/api/export").json() == doc


def test_import_rejects_unknown_schema_version(client):
    _seed(client)
    doc = client.get("/api/export").json()
    before = client.get("/api/jobs").json()
    assert client.post("/api/import", json={**doc, "schema_version": 999}).status_code == 422
    assert client.post("/api/import", json={k: v for k, v in doc.items()
                                            if k != "schema_version"}).status_code == 422
    assert client.get("/api/jobs").json() == before


def test_import_bad_data_rolls_back(client):
    _seed(client)
    doc = client.get("/api/export").json()
    before = client.get("/api/cards").json()
    bad = {**doc, "cards": [{"id": 9, "job_id": 4242, "kind": "skill", "title": "x"}]}
    assert client.post("/api/import", json=bad).status_code == 422
    assert client.get("/api/cards").json() == before
