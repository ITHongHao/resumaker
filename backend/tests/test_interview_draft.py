import json

import pytest
from sqlmodel import Session, func, select

from app import cater, db, interview
from app.ai.provider import AIError
from app.interview import DRAFT_SCHEMA, DRAFT_SYSTEM_PROMPT, Draft, DraftError, draft_answer
from app.main import app
from app.models import Card, InterviewAnswer, Job
from app.routes.ai import llm_dep

QUESTION = "Tell me about a time you improved the performance of a system."


class StubLLM:
    """Scripted LLM: returns `reply` (a dict is JSON-encoded); raises if `reply` is an exception
    or if it was built with no reply at all."""

    def __init__(self, reply=None):
        self.reply = reply
        self.calls = []

    def complete(self, system, user, images=[], json_schema=None):
        self.calls.append({"system": system, "user": user, "schema": json_schema})
        if self.reply is None:
            raise AssertionError("unexpected LLM call")
        if isinstance(self.reply, Exception):
            raise self.reply
        return self.reply if isinstance(self.reply, str) else json.dumps(self.reply)


def reply(ids, situation="", task="", action="", result=""):
    return {"situation": situation, "task": task, "action": action, "result": result,
            "source_card_ids": ids}


JOB = Job(id=7, company="Acme", title="Backend Engineer", start_date="2021", end_date="2023")
PERF = Card(id=1, job_id=7, kind="accomplishment", title="Faster checkout",
            description="Profiled the checkout service and cut p95 latency by 40%.",
            tags=["Python", "PostgreSQL"])
K8S = Card(id=2, job_id=7, kind="project", title="Cluster migration",
           description="Moved the batch jobs onto a new cluster.", tags=["Kubernetes"])
SKILL_GO = Card(id=3, kind="skill", title="Go")
BEHAVIORAL = Card(id=4, kind="behavioral", title="Conflict story",
                  description="SECRET-BEHAVIORAL I argued with Dana about Terraform.")
STORED = Card(id=5, job_id=7, kind="project", title="Reporting",
              description="Rebuilt the reporting pipeline.",
              extra={"notes": "saved 75% STORED-ONLY", "role": "Snowflake lead"})
CARDS = [PERF, K8S, SKILL_GO, BEHAVIORAL, STORED]


def draft(llm, cards=CARDS, jobs=(JOB,)):
    return draft_answer(llm, QUESTION, list(cards), list(jobs))


# --- unit: verification ------------------------------------------------------------


def test_valid_draft_passes():
    llm = StubLLM(reply([1], situation="Our checkout service was slow.",
                        task="I had to speed it up.",
                        action="I profiled the checkout service in Python and PostgreSQL.",
                        result="I cut p95 latency by 40%."))
    d = draft(llm)
    assert isinstance(d, Draft)
    assert d.source_card_ids == [1]
    assert d.result == "I cut p95 latency by 40%."
    call = llm.calls[0]
    assert call["system"] == DRAFT_SYSTEM_PROMPT and call["schema"] == DRAFT_SCHEMA
    assert QUESTION in call["user"]


def test_prompt_asks_to_cite_the_card_with_each_term():
    assert "cite the card that contains" in DRAFT_SYSTEM_PROMPT
    assert "card's own wording" in DRAFT_SYSTEM_PROMPT


def test_schema_is_strict():
    assert DRAFT_SCHEMA["additionalProperties"] is False
    assert set(DRAFT_SCHEMA["required"]) == {"situation", "task", "action", "result",
                                             "source_card_ids"}
    assert set(DRAFT_SCHEMA["properties"]) == set(DRAFT_SCHEMA["required"])


def test_rejects_uncited_id():
    llm = StubLLM(reply([1, 99], action="I profiled the checkout service."))
    with pytest.raises(DraftError):
        draft(llm)


@pytest.mark.parametrize("ids", [[4], [5, 4]])
def test_rejects_citing_an_entry_that_was_not_supplied(ids):
    # The behavioral card is never offered to the model, so citing it is citing an unknown id.
    with pytest.raises(DraftError):
        draft(StubLLM(reply(ids, action="I rebuilt the reporting pipeline.")))


def test_rejects_no_citation():
    with pytest.raises(DraftError):
        draft(StubLLM(reply([], action="I profiled the checkout service.")))


def test_rejects_invented_number():
    llm = StubLLM(reply([2], action="I moved the batch jobs onto a new cluster.",
                        result="I cut costs 40%."))
    with pytest.raises(DraftError, match="number"):
        draft(llm)


def test_number_in_an_uncited_card_does_not_count():
    # 40% is in card 1, but the draft cites only card 2.
    with pytest.raises(DraftError):
        draft(StubLLM(reply([2], result="Latency fell 40%.")))


@pytest.mark.parametrize("claim", [
    "I tripled throughput.", "I doubled throughput.", "I halved the run time.",
    "I cut the run time in half.", "The jobs ran twice as fast.", "I helped double throughput.",
    "I moved ten jobs.", "I cut costs forty percent.", "I moved fifty jobs.",
    "I moved thirty-five jobs.", "I cut the run time by a third.", "I cut the run time by a quarter.",
])
def test_rejects_number_word(claim):
    llm = StubLLM(reply([2], action="I moved the batch jobs onto a new cluster.", result=claim))
    with pytest.raises(DraftError, match="number"):
        draft(llm)


def test_number_word_in_cited_card_is_allowed():
    card = Card(id=9, kind="project", title="Batch", description="Tripled batch throughput.")
    d = draft(StubLLM(reply([9], result="I tripled batch throughput.")), cards=[card], jobs=[])
    assert d.result == "I tripled batch throughput."


@pytest.mark.parametrize("claim,card_text", [
    ("I cut costs forty percent.", "Cut costs 40%."),
    ("I cut costs 40%.", "Cut costs forty percent."),
    ("I moved thirty-five jobs.", "Moved 35 jobs."),
    ("I cut the run time by a third.", "Cut the run time by a third."),
    ("I cut the run time by a quarter.", "Cut the run time by a quarter."),
])
def test_tens_and_fraction_words_in_cited_card_are_allowed(claim, card_text):
    card = Card(id=9, kind="project", title="Batch", description=card_text)
    assert draft(StubLLM(reply([9], result=claim)), cards=[card], jobs=[]).result == claim


def test_double_check_is_not_a_number():
    d = draft(StubLLM(reply([2], action="I double-checked the batch jobs on the new cluster.")))
    assert d.source_card_ids == [2]


def test_job_dates_give_years_only():
    job = Job(id=8, company="Acme", title="Engineer", start_date="2021-03", end_date="2023-12")
    card = Card(id=9, job_id=8, kind="project", title="Batch", description="Moved batch jobs.")
    ok = draft(StubLLM(reply([9], situation="From 2021 to 2023 I moved batch jobs.")),
               cards=[card], jobs=[job])
    assert ok.source_card_ids == [9]
    for claim in ("I led 12 engineers.", "I led 3 engineers."):
        with pytest.raises(DraftError, match="number"):
            draft(StubLLM(reply([9], result=claim)), cards=[card], jobs=[job])


def test_rejects_skill_from_another_card():
    llm = StubLLM(reply([1], action="I profiled the checkout service on Kubernetes."))
    with pytest.raises(DraftError, match="Kubernetes"):
        draft(llm)


def test_skill_card_title_is_a_record_term():
    # "Go" is a skill card's title; an ambiguous term counts in canonical casing ...
    with pytest.raises(DraftError, match="Go"):
        draft(StubLLM(reply([1], action="I rewrote the checkout service in Go.")))
    # ... but the everyday word does not.
    d = draft(StubLLM(reply([1], action="I had to go and profile the checkout service.")))
    assert d.source_card_ids == [1]


def test_term_from_the_cited_card_is_allowed():
    d = draft(StubLLM(reply([1, 2], action="I used Python, then moved jobs to Kubernetes.")))
    assert d.source_card_ids == [1, 2]


def test_term_alias_counts_as_mention():
    # PostgreSQL is a tag of card 1 only; the draft cites card 2 and says "postgres".
    with pytest.raises(DraftError, match="PostgreSQL"):
        draft(StubLLM(reply([2], action="I moved the batch jobs onto postgres.")))


def test_behavioral_card_terms_still_checked():
    # Behavioral cards are never evidence, but their tags are Record terms like any other.
    cards = [PERF, Card(id=8, kind="behavioral", title="Story", description="x", tags=["Terraform"])]
    with pytest.raises(DraftError, match="Terraform"):
        draft(StubLLM(reply([1], action="I used Terraform.")), cards=cards)


def test_stored_only_extras_are_not_evidence():
    with pytest.raises(DraftError, match="number"):
        draft(StubLLM(reply([5], action="I rebuilt the reporting pipeline.", result="I saved 75%.")))


def test_cited_cards_job_counts_as_evidence():
    d = draft(StubLLM(reply([2], situation="In 2021 I was a Backend Engineer at Acme.",
                            action="I moved the batch jobs onto a new cluster.")))
    assert d.source_card_ids == [2]


def test_empty_record_gives_message_and_no_model_call():
    llm = StubLLM()  # raises if called
    for cards in ([], [BEHAVIORAL], [Card(id=6, kind="accomplishment", title="No job", description="x")]):
        with pytest.raises(DraftError, match="Record"):
            draft(llm, cards=cards)
    assert llm.calls == []


def test_model_input_is_citable_cards_only():
    llm = StubLLM(reply([1], action="I profiled the checkout service."))
    draft(llm)
    user = llm.calls[0]["user"]
    assert "SECRET-BEHAVIORAL" not in user and "Conflict story" not in user
    assert "STORED-ONLY" not in user and "Snowflake" not in user
    assert "Faster checkout" in user and "Cluster migration" in user and '"Go"' in user


def test_empty_star_parts_allowed():
    d = draft(StubLLM(reply([1], action="I profiled the checkout service.", result="  ")))
    assert (d.situation, d.task, d.result) == ("", "", "")
    assert d.action == "I profiled the checkout service."


def test_all_parts_empty_rejected():
    with pytest.raises(DraftError):
        draft(StubLLM(reply([1], situation=" ", result="\n")))


def test_duplicate_ids_are_collapsed():
    d = draft(StubLLM(reply([1, 1], action="I profiled the checkout service.")))
    assert d.source_card_ids == [1]


@pytest.mark.parametrize("raw", ["not json", "[]", json.dumps({"situation": "x"}),
                                 json.dumps(reply(["1"], action="x"))])
def test_malformed_reply_is_ai_error(raw):
    with pytest.raises(AIError):
        draft(StubLLM(raw))


def test_draft_error_is_value_error():
    assert issubclass(DraftError, ValueError)


# --- route ---------------------------------------------------------------------------


@pytest.fixture
def use_llm(client):
    def _use(llm):
        app.dependency_overrides[llm_dep] = lambda: llm
        return llm

    yield _use
    app.dependency_overrides.clear()


def _seed(client):
    job = client.post("/api/jobs", json={"company": "Acme", "title": "Backend Engineer"}).json()
    r = client.post("/api/cards", json={
        "job_id": job["id"], "kind": "accomplishment", "title": "Faster checkout",
        "description": "Profiled the checkout service and cut p95 latency by 40%.",
        "tags": ["Python"]})
    assert r.status_code == 201, r.text
    return r.json()


def _answer_count():
    with Session(db.get_engine()) as s:
        return s.exec(select(func.count()).select_from(InterviewAnswer)).one()


def test_route_returns_draft_and_never_writes(client, use_llm):
    card = _seed(client)
    client.post("/api/interview/answers", json={"question_ref": "b:most-technical", "action": "a"})
    before = _answer_count()
    llm = use_llm(StubLLM(reply([card["id"]], action="I profiled the checkout service.",
                                result="I cut p95 latency by 40%.")))
    r = client.post("/api/interview/draft", json={"question_ref": "b:most-technical"})
    assert r.status_code == 200, r.text
    assert r.json() == {"situation": "", "task": "", "action": "I profiled the checkout service.",
                        "result": "I cut p95 latency by 40%.", "source_card_ids": [card["id"]]}
    assert "What is the most technical thing you have built?" in llm.calls[0]["user"]
    assert _answer_count() == before == 1


def test_route_custom_question(client, use_llm):
    card = _seed(client)
    q = client.post("/api/interview/questions", json={"text": "Why do you like checkout work?"}).json()
    llm = use_llm(StubLLM(reply([card["id"]], action="I profiled the checkout service.")))
    r = client.post("/api/interview/draft", json={"question_ref": f"c:{q['id']}"})
    assert r.status_code == 200, r.text
    assert "Why do you like checkout work?" in llm.calls[0]["user"]


@pytest.mark.parametrize("ref", ["b:nope", "c:999", "c:abc", "x:1", ""])
def test_route_unknown_question_is_404(client, use_llm, ref):
    _seed(client)
    use_llm(StubLLM())
    assert client.post("/api/interview/draft", json={"question_ref": ref}).status_code == 404


def test_route_draft_error_is_422(client, use_llm):
    card = _seed(client)
    use_llm(StubLLM(reply([card["id"]], result="I cut costs 90%.")))
    r = client.post("/api/interview/draft", json={"question_ref": "b:most-technical"})
    assert r.status_code == 422 and "number" in r.json()["detail"]
    assert _answer_count() == 0


def test_route_empty_record_is_422_without_model_call(client, use_llm):
    llm = use_llm(StubLLM())
    r = client.post("/api/interview/draft", json={"question_ref": "b:most-technical"})
    assert r.status_code == 422 and "Record" in r.json()["detail"]
    assert llm.calls == []


def test_route_ai_error_is_502(client, use_llm):
    _seed(client)
    use_llm(StubLLM(AIError("The AI provider is having trouble right now. Try again in a minute.")))
    r = client.post("/api/interview/draft", json={"question_ref": "b:most-technical"})
    assert r.status_code == 502 and "trouble" in r.json()["detail"]


def test_route_without_key_is_400(client, monkeypatch):
    monkeypatch.delenv("RESUMAKER_FAKE_LLM", raising=False)
    _seed(client)
    r = client.post("/api/interview/draft", json={"question_ref": "b:most-technical"})
    assert r.status_code == 400 and "API key" in r.json()["detail"]


def test_fake_llm_draft_is_deterministic(client, monkeypatch):
    monkeypatch.setenv("RESUMAKER_FAKE_LLM", "1")
    client.post("/api/cards", json={"kind": "skill", "title": "Python"})  # not first: id order
    first = _seed(client)
    with Session(db.get_engine()) as s:
        ids = sorted(c.id for c in s.exec(select(Card)).all())
    body = {"question_ref": "b:most-technical"}
    a = client.post("/api/interview/draft", json=body)
    b = client.post("/api/interview/draft", json=body)
    assert a.status_code == 200, a.text
    assert a.json() == b.json()
    assert a.json()["source_card_ids"] == [ids[0]]
    # It passes verification again when replayed through draft_answer.
    with Session(db.get_engine()) as s:
        cards, jobs = s.exec(select(Card)).all(), s.exec(select(Job)).all()
    replay = StubLLM({k: a.json()[k] for k in ("situation", "task", "action", "result",
                                               "source_card_ids")})
    assert draft_answer(replay, QUESTION, list(cards), list(jobs)).model_dump() == a.json()
    assert first["id"] != ids[0]


def test_fake_llm_draft_uses_first_citable_card(client, monkeypatch):
    monkeypatch.setenv("RESUMAKER_FAKE_LLM", "1")
    card = _seed(client)
    r = client.post("/api/interview/draft", json={"question_ref": "b:lead-project"})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["source_card_ids"] == [card["id"]]
    assert "Faster checkout" in d["situation"] + d["action"]


def test_fake_llm_unknown_prompt_still_raises():
    from app.ai.fake import FakeLLM

    with pytest.raises(ValueError):
        FakeLLM().complete("something else", "x")
    assert cater.CATER_SYSTEM_PROMPT != interview.DRAFT_SYSTEM_PROMPT
