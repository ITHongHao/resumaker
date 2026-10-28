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
    assert doc["schema_version"] == 2
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
        "provider": "anthropic", "model": "keep", "base_url": "", "has_key": False}
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


def test_job_extra_survives_export_and_import(client):
    jid = client.post("/api/jobs", json={"company": "A", "title": "T",
                                         "extra": {"salary": "90k"}}).json()["id"]
    doc = client.get("/api/export").json()
    assert doc["jobs"][0]["extra"] == {"salary": "90k"}
    client.delete(f"/api/jobs/{jid}")
    assert client.post("/api/import", json=doc).status_code == 200
    assert client.get("/api/jobs").json()[0]["extra"] == {"salary": "90k"}


def test_old_export_without_job_extra_still_imports(client):
    doc = {"schema_version": 1, "profile": {}, "cards": [],
           "jobs": [{"id": 1, "company": "A", "title": "T"}]}
    assert client.post("/api/import", json=doc).status_code == 200
    assert client.get("/api/jobs").json()[0]["extra"] == {}


def _seed_interview(client):
    job = client.post("/api/jobs", json={"company": "Acme", "title": "Eng",
                                         "extra": {"salary": "90k"}}).json()
    card = client.post("/api/cards", json={"kind": "project", "title": "Search"}).json()
    q = client.post("/api/interview/questions", json={"text": "Mine?", "category": "Mine"}).json()
    for s in ("one", "two"):
        client.post("/api/interview/answers", json={
            "question_ref": q["ref"], "situation": s, "source_card_ids": [card["id"]],
            "job_id": job["id"]})
    return q, card, job


def _builtin_ref(client):
    return next(r["ref"] for r in client.get("/api/interview/questions").json() if r.get("builtin"))


def test_export_v2_roundtrip_with_interview(client):
    q, card, job = _seed_interview(client)
    bref = _builtin_ref(client)
    client.put(f"/api/interview/questions/{bref}/hidden", json={"hidden": True})
    client.post("/api/interview/answers", json={"question_ref": bref, "action": "did"})
    doc = client.get("/api/export").json()
    assert doc["schema_version"] == 2
    assert doc["jobs"][0]["extra"] == {"salary": "90k"}
    assert len(doc["interview_questions"]) == 1 and len(doc["interview_answers"]) == 3
    assert doc["hidden_questions"] == [bref]
    qs = client.get("/api/interview/questions?include_hidden=true").json()
    ans = client.get("/api/interview/answers").json()
    client.delete(f"/api/jobs/{job['id']}")
    client.delete(f"/api/interview/questions/{q['id']}")
    client.put(f"/api/interview/questions/{bref}/hidden", json={"hidden": False})
    assert client.post("/api/import", json=doc).status_code == 200
    assert client.get("/api/interview/questions?include_hidden=true").json() == qs
    assert client.get("/api/interview/answers").json() == ans
    assert client.get("/api/export").json() == doc


def test_v1_export_still_imports(client):
    _seed_interview(client)
    doc = {"schema_version": 1, "profile": {"name": "Ada"}, "jobs": [
        {"id": 1, "company": "A", "title": "T"}], "cards": [
        {"id": 2, "job_id": 1, "kind": "skill", "title": "Py"}]}
    assert client.post("/api/import", json=doc).status_code == 200
    assert client.get("/api/jobs").json()[0]["company"] == "A"
    assert client.get("/api/cards").json()[0]["title"] == "Py"
    assert client.get("/api/interview/answers").json() == []
    assert [r for r in client.get("/api/interview/questions").json() if not r.get("builtin")] == []


def test_import_rejects_unknown_version_3(client):
    doc = client.get("/api/export").json()
    assert client.post("/api/import", json={**doc, "schema_version": 3}).status_code == 422


def test_import_remaps_custom_question_refs(client):
    for t in ("a", "b", "c"):  # advance the autoincrement past 7 and beyond
        client.post("/api/interview/questions", json={"text": t})
    bref = _builtin_ref(client)
    doc = {"schema_version": 2, "profile": {},
           "jobs": [{"id": 1, "company": "A", "title": "T"}],
           "cards": [{"id": 5, "kind": "skill", "title": "Py"}],
           "interview_questions": [{"id": 7, "text": "Seven?", "category": "Mine"}],
           "interview_answers": [
               {"id": 1, "question_ref": "c:7", "situation": "s", "source_card_ids": [5, 99],
                "job_id": 1},
               {"id": 2, "question_ref": "c:8", "situation": "orphan"},
               {"id": 3, "question_ref": "b:nope"},
               {"id": 4, "question_ref": bref, "job_id": 42}],
           "hidden_questions": [bref, "b:nope", "c:7", "c:9"]}
    assert client.post("/api/import", json=doc).status_code == 200
    custom = [r for r in client.get("/api/interview/questions?include_hidden=true").json()
              if not r.get("builtin")]
    assert len(custom) == 1 and custom[0]["text"] == "Seven?"
    new_ref = custom[0]["ref"]
    assert new_ref != "c:7"
    ans = client.get("/api/interview/answers").json()
    assert sorted(a["question_ref"] for a in ans) == sorted([new_ref, bref])
    a1 = next(a for a in ans if a["question_ref"] == new_ref)
    assert a1["source_card_ids"] == [5] and a1["job_id"] == 1
    assert next(a for a in ans if a["question_ref"] == bref)["job_id"] is None
    exported = client.get("/api/export").json()
    assert sorted(exported["hidden_questions"]) == sorted([bref, new_ref])


def test_import_interview_failure_leaves_interview_unchanged(client):
    q, card, job = _seed_interview(client)
    before = client.get("/api/interview/answers").json()
    doc = client.get("/api/export").json()
    bad = {**doc, "interview_questions": doc["interview_questions"] * 2}  # duplicate ids
    assert client.post("/api/import", json=bad).status_code == 422
    assert client.get("/api/interview/answers").json() == before


def test_import_remaps_each_answer_to_its_own_question(client):
    doc = {"schema_version": 2, "profile": {}, "jobs": [], "cards": [],
           "interview_questions": [{"id": 2, "text": "Two?"}, {"id": 1, "text": "One?"}],
           "interview_answers": [{"question_ref": "c:1", "situation": "for-one"},
                                 {"question_ref": "c:2", "situation": "for-two"}]}
    for _ in range(2):  # twice: the second import reuses/changes ids again
        assert client.post("/api/import", json=doc).status_code == 200
        text_by_ref = {r["ref"]: r["text"] for r in client.get("/api/interview/questions").json()
                       if not r.get("builtin")}
        for a in client.get("/api/interview/answers").json():
            expected = "One?" if a["situation"] == "for-one" else "Two?"
            assert text_by_ref[a["question_ref"]] == expected


def test_import_failure_after_deletes_rolls_back_everything(client, monkeypatch):
    _seed(client)
    _seed_interview(client)
    doc = client.get("/api/export").json()
    snap = lambda: (client.get("/api/export").json())
    before = snap()
    from app.routes import portability

    def boom(*a, **k):
        raise RuntimeError("boom")

    monkeypatch.setattr(portability, "_resolve_ref", boom)  # runs after the deletes and inserts
    doc["hidden_questions"] = ["c:1"]
    doc["jobs"][0]["company"] = "Changed"
    try:
        r = client.post("/api/import", json=doc)
        assert r.status_code >= 500
    except RuntimeError:
        pass
    monkeypatch.undo()
    assert snap() == before


def test_v1_import_converts_behavioral_cards_like_the_migration(client):
    doc = {"schema_version": 1, "profile": {}, "jobs": [
        {"id": 1, "company": "A", "title": "T"}], "cards": [
        {"id": 2, "job_id": 1, "kind": "behavioral", "title": "Led a migration",
         "description": "I led it.", "details": "More detail.", "tags": ["lead", "infra"]},
        {"id": 3, "job_id": None, "kind": "skill", "title": "Py"}]}
    r = client.post("/api/import", json=doc)
    assert r.status_code == 200 and r.json()["interview_answers"] == 1
    custom = [q for q in client.get("/api/interview/questions").json() if not q["builtin"]]
    assert [(q["text"], q["category"], q["answer_count"]) for q in custom] == [
        ("Led a migration", "Mine", 1)]
    [a] = client.get("/api/interview/answers").json()
    assert a["question_ref"] == custom[0]["ref"]
    assert a["action"] == "I led it.\n\nMore detail.\n\nTags: lead, infra"
    assert (a["situation"], a["task"], a["result"]) == ("", "", "")
    assert a["source_card_ids"] == [] and a["job_id"] == 1 and a["created_at"]
    # The original card row is still stored (hidden from the Record by its kind).
    assert [c["kind"] for c in client.get("/api/cards").json()] == ["behavioral", "skill"]


def test_v2_import_does_not_convert_behavioral_cards(client):
    doc = {"schema_version": 2, "profile": {}, "jobs": [], "cards": [
        {"id": 2, "job_id": None, "kind": "behavioral", "title": "Old story"}],
        "interview_questions": [], "interview_answers": [], "hidden_questions": []}
    assert client.post("/api/import", json=doc).status_code == 200
    assert client.get("/api/interview/answers").json() == []
    assert [q for q in client.get("/api/interview/questions").json() if not q["builtin"]] == []


def test_import_cleans_interview_questions(client):
    doc = {"schema_version": 2, "profile": {}, "jobs": [], "cards": [],
           "interview_questions": [
               {"id": 1, "text": "  Padded question  ", "category": "Leadership"},
               {"id": 2, "text": "   ", "category": "Mine"},
               {"id": 3, "text": "Odd category", "category": "Nonsense"}],
           "interview_answers": [
               {"question_ref": "c:1", "situation": "kept"},
               {"question_ref": "c:2", "situation": "dropped with its blank question"}],
           "hidden_questions": ["c:2"]}
    r = client.post("/api/import", json=doc)
    assert r.status_code == 200 and r.json()["interview_answers"] == 1
    custom = [q for q in client.get("/api/interview/questions?include_hidden=true").json()
              if not q["builtin"]]
    assert [(q["text"], q["category"]) for q in custom] == [
        ("Padded question", "Leadership"), ("Odd category", "Mine")]
    assert [a["situation"] for a in client.get("/api/interview/answers").json()] == ["kept"]


def test_import_cleans_card_and_job_extra(client):
    doc = {"schema_version": 2, "profile": {},
           "jobs": [{"id": 1, "company": "A", "title": "T",
                     "extra": {"currently_here": "Yes", "ok_to_contact": "maybe",
                               "salary": " 90k ", "custom": "keep"}}],
           "cards": [{"id": 2, "job_id": None, "kind": "education", "title": "U",
                      "extra": {"gpa": " 3.7 ", "minor": "x" * 300, "notes": "", "zzz": 1}}]}
    assert client.post("/api/import", json=doc).status_code == 200
    assert client.get("/api/jobs").json()[0]["extra"] == {
        "currently_here": "yes", "salary": "90k", "custom": "keep"}
    extra = client.get("/api/cards").json()[0]["extra"]
    assert extra["gpa"] == "3.7" and len(extra["minor"]) == 100
    assert "notes" not in extra and extra["zzz"] == 1
