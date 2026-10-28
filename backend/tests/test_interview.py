from app import interview


def test_builtin_keys_unique_and_stable():
    keys = [q.key for q in interview.BUILTIN]
    assert len(keys) == len(set(keys))
    assert 25 <= len(keys) <= 40
    assert all(q.category in interview.CATEGORIES for q in interview.BUILTIN)
    assert set(interview.CATEGORIES) == {q.category for q in interview.BUILTIN}
    mt = next(q for q in interview.BUILTIN if q.key == "most-technical")
    assert mt.text == "What is the most technical thing you have built?"


def _q(client, text="Tell me about a deadline", category="Mine"):
    r = client.post("/api/interview/questions", json={"text": text, "category": category})
    assert r.status_code == 201
    return r.json()


def _ans(client, ref, **kw):
    body = {"question_ref": ref, "situation": "s", "task": "t", "action": "a", "result": "r",
            "source_card_ids": [], "job_id": None}
    body.update(kw)
    return client.post("/api/interview/answers", json=body)


def test_list_questions_merges_builtin_and_custom_and_counts_answers(client):
    q = _q(client)
    ref = f"c:{q['id']}"
    _ans(client, ref)
    _ans(client, "b:most-technical")
    rows = client.get("/api/interview/questions").json()
    by = {r["ref"]: r for r in rows}
    assert len(rows) == len(interview.BUILTIN) + 1
    assert by[ref]["builtin"] is False and by[ref]["answer_count"] == 1
    assert by["b:most-technical"]["builtin"] is True and by["b:most-technical"]["answer_count"] == 1
    assert by["b:lead-project"]["answer_count"] == 0 and by["b:lead-project"]["hidden"] is False


def test_hide_and_unhide_builtin(client):
    r = client.put("/api/interview/questions/b:most-technical/hidden", json={"hidden": True})
    assert r.status_code == 200
    refs = [x["ref"] for x in client.get("/api/interview/questions").json()]
    assert "b:most-technical" not in refs
    allq = client.get("/api/interview/questions?include_hidden=true").json()
    assert next(x for x in allq if x["ref"] == "b:most-technical")["hidden"] is True
    client.put("/api/interview/questions/b:most-technical/hidden", json={"hidden": False})
    refs = [x["ref"] for x in client.get("/api/interview/questions").json()]
    assert "b:most-technical" in refs
    assert client.put("/api/interview/questions/b:nope/hidden", json={"hidden": True}).status_code == 404


def test_custom_question_crud_and_cascade_delete(client):
    q = _q(client)
    ref = f"c:{q['id']}"
    r = client.patch(f"/api/interview/questions/{q['id']}", json={"text": "New", "category": "X"})
    assert r.status_code == 200 and r.json()["text"] == "New"
    a = _ans(client, ref).json()
    other = _ans(client, "b:most-technical").json()
    assert client.delete(f"/api/interview/questions/{q['id']}").status_code == 204
    assert client.get(f"/api/interview/answers?question_ref={ref}").json() == []
    assert client.get("/api/interview/answers?question_ref=b:most-technical").json()[0]["id"] == other["id"]
    assert client.patch(f"/api/interview/answers/{a['id']}", json={"action": "x"}).status_code == 404


def test_cannot_edit_builtin(client):
    assert client.patch("/api/interview/questions/b:most-technical", json={"text": "x"}).status_code == 404
    assert client.delete("/api/interview/questions/b:most-technical").status_code == 404


def test_answer_requires_existing_question(client):
    assert _ans(client, "c:999").status_code == 404
    assert _ans(client, "b:nope").status_code == 404


def test_many_answers_per_question(client):
    for i in range(3):
        assert _ans(client, "b:most-technical", action=f"a{i}").status_code == 201
    rows = client.get("/api/interview/answers?question_ref=b:most-technical").json()
    assert len(rows) == 3
    a = rows[0]
    r = client.patch(f"/api/interview/answers/{a['id']}", json={"result": "better"})
    assert r.json()["result"] == "better"
    assert client.delete(f"/api/interview/answers/{a['id']}").status_code == 204
    assert len(client.get("/api/interview/answers?question_ref=b:most-technical").json()) == 2


def test_deleting_a_cited_card_marks_source_removed(client):
    job = client.post("/api/jobs", json={"company": "Co", "title": "Dev"}).json()
    card = client.post("/api/cards", json={"kind": "project", "title": "Proj"}).json()
    a = _ans(client, "b:most-technical", source_card_ids=[card["id"], 98765, card["id"]]).json()
    assert a["source_card_ids"] == [card["id"]]
    rows = client.get("/api/interview/answers?question_ref=b:most-technical").json()
    assert rows[0]["source_cards"] == [{"id": card["id"], "title": "Proj"}]
    client.delete(f"/api/cards/{card['id']}")
    rows = client.get("/api/interview/answers?question_ref=b:most-technical").json()
    assert rows[0]["source_cards"] == [{"id": card["id"], "removed": True}]
    assert job["id"]


def test_deleting_job_nulls_answer_job_id(client):
    job = client.post("/api/jobs", json={"company": "Co", "title": "Dev"}).json()
    a = _ans(client, "b:most-technical", job_id=job["id"]).json()
    assert a["job_id"] == job["id"]
    assert client.delete(f"/api/jobs/{job['id']}").status_code == 204
    rows = client.get("/api/interview/answers?question_ref=b:most-technical").json()
    assert rows[0]["id"] == a["id"] and rows[0]["job_id"] is None
