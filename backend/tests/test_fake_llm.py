
import pytest

from app import cater
from app.ai import askai
from app.ai.fake import FakeLLM
from app.ai.provider import AnthropicLLM, NoKeyError, get_llm
from app.keystore import KeyStore
from app.models import AppSettings, Card, Job, Posting, Requirement
from app.postings import extract


class MemKeys(KeyStore):
    def __init__(self, keys):
        self.keys = keys

    def get(self, provider):
        return self.keys.get(provider)


def test_flag_unset_keeps_real_behavior(monkeypatch):
    monkeypatch.delenv("RESUMAKER_FAKE_LLM", raising=False)
    with pytest.raises(NoKeyError):
        get_llm(AppSettings(provider="openai"), MemKeys({}))
    assert isinstance(get_llm(AppSettings(provider="anthropic"), MemKeys({"anthropic": "k"})), AnthropicLLM)


@pytest.mark.parametrize("value", ["", "0", "true", "yes"])
def test_flag_must_be_exactly_one(monkeypatch, value):
    monkeypatch.setenv("RESUMAKER_FAKE_LLM", value)
    with pytest.raises(NoKeyError):
        get_llm(AppSettings(), MemKeys({}))


def test_flag_set_returns_fake_without_key_and_is_read_at_call_time(monkeypatch):
    monkeypatch.setenv("RESUMAKER_FAKE_LLM", "1")
    assert isinstance(get_llm(AppSettings(), MemKeys({})), FakeLLM)
    monkeypatch.delenv("RESUMAKER_FAKE_LLM")
    with pytest.raises(NoKeyError):
        get_llm(AppSettings(), MemKeys({}))


def test_request_cannot_enable_fake(client, monkeypatch):
    monkeypatch.delenv("RESUMAKER_FAKE_LLM", raising=False)
    r = client.post("/api/ai/propose?RESUMAKER_FAKE_LLM=1&fake=1", json={"message": "x"},
                    headers={"RESUMAKER_FAKE_LLM": "1"})
    assert r.status_code == 400


def test_askai_proposals_and_followup():
    llm = FakeLLM()
    out = askai.propose_cards(llm, "I built a billing service in Python for our invoices", None, [])
    assert len(out.proposals) == 1 and out.proposals[0].description
    assert out.followups  # no number given -> asks, never invents one
    assert not any(ch.isdigit() for ch in out.proposals[0].description)
    empty = askai.propose_cards(llm, "hi", None, [])
    assert empty.proposals == [] and empty.followups


def test_extract_requirements():
    text = "Title: Backend Engineer\nCompany: Acme\nRequired: Python and SQL.\nNice to have: Docker"
    out = extract.extract_requirements(FakeLLM(), text, [])
    assert (out.title, out.company) == ("Backend Engineer", "Acme")
    by = {r.term: r for r in out.requirements}
    assert by["Python"].weight == 3 and by["Docker"].weight == 1
    assert set(by) == {"Python", "SQL", "Docker"}
    assert extract.extract_requirements(FakeLLM(), None, [b"\x89PNG"]).requirements == []


def _data():
    job = Job(id=1, title="Engineer", company="Acme", start_date="2022", end_date="")
    cards = [
        Card(id=1, job_id=1, kind="accomplishment", title="Billing service",
             description="Built a Python API with Docker for invoices, cutting errors 40%."),
        Card(id=2, job_id=None, kind="project", title="Dashboard",
             description="Wrote a React dashboard.", tags=["React"]),
        Card(id=3, job_id=1, kind="skill", title="Rust", description=""),
    ]
    posting = Posting(title="BE", company="Acme", requirements=[
        Requirement(term="Python", kind="skill", weight=3).model_dump(),
        Requirement(term="Docker", kind="tool", weight=2).model_dump(),
        Requirement(term="React", kind="tool", weight=2).model_dump(),
        Requirement(term="Kubernetes", kind="tool", weight=3).model_dump(),
    ])
    return job, cards, posting


def test_cater_and_suggest_pass_real_provenance_checks():
    job, cards, posting = _data()
    llm = FakeLLM()
    bullets = cater.auto_cater(llm, [job], cards, posting)
    assert {b.source_card_id for b in bullets} == {1, 2}
    assert all("Kubernetes" not in b.text for b in bullets)  # gap never claimed
    reqs = cater.requirements_of(posting)
    sugg = cater.suggest(llm, cards, bullets, reqs)
    assert sugg and all(s.source_card_id in (1, 2) for s in sugg)
    assert any("Python" in s.terms for s in sugg)
    # Every output was accepted by the real checks, not bypassed: re-run them directly.
    by_id = {c.id: c for c in cards}
    for s in sugg:
        assert cater._traceable(s.new, by_id[s.source_card_id], reqs)


def test_output_is_deterministic():
    job, cards, posting = _data()
    a = cater.auto_cater(FakeLLM(), [job], cards, posting)
    b = cater.auto_cater(FakeLLM(), [job], cards, posting)
    assert [x.text for x in a] == [x.text for x in b]


def test_unknown_prompt_is_an_error():
    with pytest.raises(ValueError):
        FakeLLM().complete("something else", "x")
