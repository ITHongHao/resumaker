import json

import pytest

from app.ai.askai import propose_cards
from app.ai.provider import AIError, NoKeyError, get_llm
from app.main import app
from app.models import Job
from app.routes.ai import llm_dep


class FakeLLM:
    def __init__(self, reply=None, error=None):
        self.reply = reply
        self.error = error
        self.calls = []

    def complete(self, system, user, images=[], json_schema=None):
        self.calls.append({"system": system, "user": user, "schema": json_schema})
        if self.error:
            raise self.error
        return self.reply if isinstance(self.reply, str) else json.dumps(self.reply)


GOOD = {
    "reply": "Nice work. Here is a draft.",
    "proposals": [
        {"kind": "accomplishment", "title": "Cut report time", "description": "Automated the weekly report.", "tags": ["python"]}
    ],
    "followups": ["By how much did the report time drop?"],
}


@pytest.fixture
def use_llm():
    def _use(llm):
        app.dependency_overrides[llm_dep] = lambda: llm
    yield _use
    app.dependency_overrides.clear()


def test_propose_returns_drafts_and_followups():
    r = propose_cards(FakeLLM(GOOD), "I automated the weekly report", None, [])
    assert r.reply.startswith("Nice")
    assert r.proposals[0].kind == "accomplishment"
    assert r.proposals[0].tags == ["python"]
    assert r.proposals[0].extra == {}
    assert r.followups == ["By how much did the report time drop?"]


def test_prompt_forbids_inventing_and_includes_context():
    llm = FakeLLM(GOOD)
    job = Job(id=1, company="Acme", title="Engineer")
    propose_cards(llm, "I did X", job, [{"role": "user", "content": "earlier"}])
    call = llm.calls[0]
    low = call["system"].lower()
    assert "only" in low and "invent" in low and "follow-up" in low
    assert "Acme" in call["user"] and "I did X" in call["user"] and "earlier" in call["user"]
    assert call["schema"]


def test_followup_asks_for_missing_numbers():
    reply = {"reply": "Need a number.", "proposals": [], "followups": ["How many users did it serve?"]}
    r = propose_cards(FakeLLM(reply), "I built a dashboard", None, [])
    assert r.proposals == []
    assert "How many" in r.followups[0]


@pytest.mark.parametrize("bad", ["not json", '{"reply": 1}', json.dumps({**GOOD, "proposals": [{"kind": "bogus", "title": "t"}]}), "[]"])
def test_malformed_json_raises_aierror(bad):
    with pytest.raises(AIError):
        propose_cards(FakeLLM(bad), "hi", None, [])


def test_propose_does_not_create_cards(client, use_llm):
    use_llm(FakeLLM(GOOD))
    r = client.post("/api/ai/propose", json={"message": "I automated reports", "history": []})
    assert r.status_code == 200
    body = r.json()
    assert body["proposals"][0]["title"] == "Cut report time"
    assert client.get("/api/cards").json() == []


def test_no_key_returns_400_with_message(client):
    r = client.post("/api/ai/propose", json={"message": "hi", "history": []})
    assert r.status_code == 400
    assert "Settings" in r.json()["detail"]


def test_provider_error_returns_502_and_changes_nothing(client, use_llm):
    use_llm(FakeLLM(error=AIError("The AI provider request failed.")))
    r = client.post("/api/ai/propose", json={"message": "secret resume text", "history": []})
    assert r.status_code == 502
    assert "secret resume text" not in r.text
    assert client.get("/api/cards").json() == []


def test_malformed_model_output_returns_502(client, use_llm):
    use_llm(FakeLLM("garbage"))
    r = client.post("/api/ai/propose", json={"message": "hi", "history": []})
    assert r.status_code == 502
    assert "garbage" not in r.text


def test_unknown_job_is_404(client, use_llm):
    use_llm(FakeLLM(GOOD))
    r = client.post("/api/ai/propose", json={"job_id": 999, "message": "hi", "history": []})
    assert r.status_code == 404


def test_model_extra_is_sanitized_to_known_string_fields_per_kind():
    reply = {
        "reply": "ok",
        "proposals": [
            {"kind": "education", "title": "MIT", "description": "BS CS", "tags": [],
             "extra": {"location": "  Cambridge, MA ", "start_date": "2016", "end_date": 2020,
                       "category": "should not be here", "gpa": "4.0", "date": "x" * 10_000,
                       "evil": {"nested": True}}},
            {"kind": "skill", "title": "Go", "description": "", "tags": [],
             "extra": {"category": "L" * 5000, "start_date": "2020"}},
            {"kind": "accomplishment", "title": "Shipped", "description": "d", "tags": [],
             "extra": {"location": "NYC", "notes": "secret"}},
            {"kind": "certificate", "title": "AWS SA", "description": "", "tags": [],
             "extra": "not a dict"},
        ],
        "followups": [],
    }
    r = propose_cards(FakeLLM(reply), "hi", None, [])
    edu, skill, acc, cert = r.proposals
    assert edu.extra == {"location": "Cambridge, MA", "start_date": "2016"}
    assert set(skill.extra) == {"category"} and len(skill.extra["category"]) <= 100
    assert acc.extra == {}
    assert cert.extra == {}


def test_propose_route_never_returns_unknown_extra(client, use_llm):
    reply = {"reply": "ok", "followups": [], "proposals": [
        {"kind": "project", "title": "P", "description": "d", "tags": [],
         "extra": {"start_date": "2021", "injected": "x" * 100_000}}]}
    use_llm(FakeLLM(reply))
    r = client.post("/api/ai/propose", json={"message": "hi", "history": []})
    assert r.status_code == 200
    assert r.json()["proposals"][0]["extra"] == {"start_date": "2021"}
    assert len(r.text) < 2000


def test_prompt_without_job_steers_away_from_jobless_accomplishments():
    llm = FakeLLM(GOOD)
    propose_cards(llm, "I ran a cluster", None, [])
    assert "not about a specific job" in llm.calls[0]["user"].lower()
    llm = FakeLLM(GOOD)
    propose_cards(llm, "I ran a cluster", Job(id=1, company="Acme", title="SRE"), [])
    assert "not about a specific job" not in llm.calls[0]["user"].lower()
