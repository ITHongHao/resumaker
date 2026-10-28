import json
import re

import pytest
from sqlmodel import Session, select

from app import db
from app.ai.provider import AIError
from app.cater import (
    card_supports,
    CATER_SYSTEM_PROMPT,
    SUGGEST_SYSTEM_PROMPT,
    RecordTooSmallError,
    Suggestion,
    auto_cater,
    suggest,
    uncovered,
)
from app.latex.template import Bullet
from app.main import app
from app.models import Application, Card, Job, Posting, Requirement, ResumeVersion
from app.routes.ai import llm_dep

# --- helpers -------------------------------------------------------------------


class FakeLLM:
    """Replies are consumed in order; an Exception instance is raised instead of returned."""

    def __init__(self, *replies):
        self.replies = list(replies)
        self.calls = []

    def complete(self, system, user, images=[], json_schema=None):
        self.calls.append({"system": system, "user": user, "schema": json_schema})
        if not self.replies:
            raise AssertionError("unexpected LLM call")
        reply = self.replies.pop(0)
        if isinstance(reply, Exception):
            raise reply
        return reply if isinstance(reply, str) else json.dumps(reply)


@pytest.fixture
def use_llm(client):
    def _use(llm):
        app.dependency_overrides[llm_dep] = lambda: llm
        return llm

    yield _use
    app.dependency_overrides.clear()


def req(term, weight=2, kind="skill"):
    return Requirement(term=term, kind=kind, weight=weight)


def card(client, **body):
    r = client.post("/api/cards", json=body)
    assert r.status_code == 201, r.text
    return r.json()


def add_posting(reqs, title="ML Engineer", company="Globex"):
    with Session(db.get_engine()) as s:
        p = Posting(
            source_kind="text",
            raw_text="posting",
            title=title,
            company=company,
            requirements=[r.model_dump() for r in reqs],
        )
        s.add(p)
        s.commit()
        return p.id


def rows(model):
    with Session(db.get_engine()) as s:
        return s.exec(select(model)).all()


POSTING_REQS = [
    req("Python", 3),
    req("Airflow", 2, "tool"),
    req("PostgreSQL", 1, "tool"),
    req("Kubernetes", 2, "tool"),  # nothing in the Record mentions it
]


@pytest.fixture
def record(client):
    job = client.post(
        "/api/jobs",
        json={"company": "Acme", "title": "Data Engineer", "start_date": "2020", "end_date": "2023"},
    ).json()
    pipelines = card(
        client,
        job_id=job["id"],
        kind="project",
        title="Reporting pipelines",
        description="Built Airflow pipelines in Python that cut report time by 40%.",
        tags=["Airflow", "Python"],
    )
    webapp = card(
        client,
        kind="project",
        title="Recipe site",
        description="A web app backed by Postgres, written in TypeScript.",
        tags=["TypeScript"],
    )
    edu = card(
        client,
        kind="education",
        title="State University",
        description="BSc Computer Science",
        extra={"location": "Springfield", "start_date": "2016", "end_date": "2020"},
    )
    skill = card(client, kind="skill", title="Python", extra={"category": "Languages"})
    return {"job": job, "pipelines": pipelines, "webapp": webapp, "edu": edu, "skill": skill}


def cater_reply(*bullets):
    return {"bullets": [{"source_card_id": cid, "text": text} for cid, text in bullets]}


def suggest_reply(*suggestions):
    return {
        "suggestions": [
            {"bullet_index": i, "new": new, "terms": terms, "source_card_id": cid}
            for i, new, terms, cid in suggestions
        ]
    }


def good_replies(record):
    p, w = record["pipelines"]["id"], record["webapp"]["id"]
    return (
        cater_reply(
            (w, "Built a TypeScript web app"),
            (p, "Built Python Airflow pipelines that cut report time by 40%"),
        ),
        # Bullets are stored in render order: experience (pipelines) first, then projects.
        suggest_reply((1, "Built a TypeScript web app backed by PostgreSQL", ["PostgreSQL"], w)),
    )


def resume_items(tex):
    body = tex.split("\\begin{document}", 1)[1]
    return re.findall(r"^\s*\\resumeItem\{(.*)\}$", body, re.MULTILINE)


# --- auto_cater ----------------------------------------------------------------


def _cards():
    return [
        Card(id=1, job_id=10, kind="project", title="Pipelines",
             description="Built Airflow pipelines in Python that cut report time by 40%.",
             tags=["Airflow"]),
        Card(id=2, kind="project", title="Recipe site", description="A Postgres web app in TypeScript."),
        Card(id=3, kind="education", title="State University", description="BSc"),
    ]


def _jobs():
    return [Job(id=10, company="Acme", title="Data Engineer")]


def _posting(reqs=None):
    return Posting(id=1, source_kind="text", title="ML Engineer", company="Globex",
                   requirements=[r.model_dump() for r in (reqs or POSTING_REQS)])


def test_every_bullet_traces_to_an_existing_card(client, use_llm, record):
    use_llm(FakeLLM(*good_replies(record)))
    r = client.post("/api/applications", json={"posting_id": add_posting(POSTING_REQS)})
    assert r.status_code == 201, r.text
    body = r.json()
    card_ids = {c["id"] for c in client.get("/api/cards").json()}
    bullets = body["version"]["bullets"]
    assert len(bullets) == 2
    assert all(b["source_card_id"] in card_ids for b in bullets)
    exp, proj = bullets
    assert exp == {
        "section": "experience",
        "job_id": record["job"]["id"],
        "text": "Built Python Airflow pipelines that cut report time by 40%",
        "source_card_id": record["pipelines"]["id"],
    }
    assert proj["section"] == "projects" and proj["job_id"] is None
    assert proj["source_card_id"] == record["webapp"]["id"]
    # bullet_index i is the i-th \resumeItem line of the generated tex.
    tex = body["version"]["tex"]
    assert resume_items(tex) == [
        r"Built Python Airflow pipelines that cut report time by 40\%",
        "Built a TypeScript web app",
    ]
    assert "State University" in tex and "Languages" in tex
    assert body["version"]["version"] == 1
    assert body["status"] == "not_applied"


def test_bullet_with_unknown_card_id_is_dropped():
    llm = FakeLLM(cater_reply(
        (999, "Led a team of engineers"),  # unknown card
        (3, "Studied computer science"),  # known card, but education cards are not bullet sources
        (1, "Built Airflow pipelines in Python"),
    ))
    bullets = auto_cater(llm, _jobs(), _cards(), _posting())
    assert bullets == [Bullet(section="experience", job_id=10,
                              text="Built Airflow pipelines in Python", source_card_id=1)]


def test_bullet_with_number_not_in_card_is_dropped():
    llm = FakeLLM(cater_reply(
        (1, "Cut report time by 60% with Airflow"),  # card says 40%
        (1, "Saved $2,000 a month"),  # card has no dollar figure
        (2, "Served 10,000 users with a TypeScript app"),  # invented count
        (1, "Cut report time by 40% with Airflow pipelines"),
    ))
    bullets = auto_cater(llm, _jobs(), _cards(), _posting())
    assert [b.text for b in bullets] == ["Cut report time by 40% with Airflow pipelines"]


def test_bullet_mentioning_requirement_its_card_lacks_is_dropped():
    # The recipe card never mentions Airflow, even though another card does.
    llm = FakeLLM(cater_reply((2, "Built a TypeScript app orchestrated with Airflow"),
                              (2, "Built a TypeScript web app on Postgres")))
    bullets = auto_cater(llm, _jobs(), _cards(), _posting())
    assert [b.text for b in bullets] == ["Built a TypeScript web app on Postgres"]


def test_cater_limits_bullets_per_card_and_job():
    llm = FakeLLM(cater_reply(*[(1, f"Built Airflow pipelines in Python, take {w}")
                                for w in ("alpha", "beta", "gamma")]))
    bullets = auto_cater(llm, _jobs(), _cards(), _posting())
    assert len(bullets) == 2  # MAX_BULLETS_PER_CARD


def test_cater_malformed_output_is_ai_error():
    with pytest.raises(AIError, match="could not be understood"):
        auto_cater(FakeLLM("not json"), _jobs(), _cards(), _posting())


def test_cater_with_no_traceable_bullets_is_ai_error():
    with pytest.raises(AIError, match="trace"):
        auto_cater(FakeLLM(cater_reply((999, "Invented"))), _jobs(), _cards(), _posting())


def test_cater_prompt_forbids_invention_and_sends_the_record():
    llm = FakeLLM(cater_reply((1, "Built Airflow pipelines in Python")))
    auto_cater(llm, _jobs(), _cards(), _posting())
    system = llm.calls[0]["system"].lower()
    assert system == CATER_SYSTEM_PROMPT.lower()
    for phrase in ("only facts", "never add employers", "numbers", "reword rather than invent"):
        assert phrase in system
    user = llm.calls[0]["user"]
    assert "Built Airflow pipelines in Python that cut report time by 40%." in user
    assert '"id": 1' in user and '"id": 2' in user
    assert "State University" not in user  # education is rendered by the template, not reworded
    assert "Kubernetes" in user.split("Not in the Record")[1]
    assert llm.calls[0]["schema"] is not None


def test_empty_record_returns_clear_error_not_empty_resume(client, use_llm):
    llm = use_llm(FakeLLM())
    posting_id = add_posting(POSTING_REQS)

    r = client.post("/api/applications", json={"posting_id": posting_id})
    assert r.status_code == 422
    assert "Record" in r.json()["detail"] and "project or accomplishment" in r.json()["detail"]

    # Tiny Record: a job, a skill and a title-only project give nothing honest to write.
    job = client.post("/api/jobs", json={"company": "Acme", "title": "Engineer"}).json()
    card(client, kind="skill", title="Python")
    card(client, job_id=job["id"], kind="project", title="Stuff")
    r = client.post("/api/applications", json={"posting_id": posting_id})
    assert r.status_code == 422 and "Record" in r.json()["detail"]

    assert llm.calls == []
    assert rows(Application) == [] and rows(ResumeVersion) == []


def test_record_too_small_raised_before_any_ai_call():
    llm = FakeLLM()
    with pytest.raises(RecordTooSmallError):
        auto_cater(llm, [], [Card(id=1, kind="skill", title="Python")], _posting())
    assert llm.calls == []


# --- suggest / uncovered ---------------------------------------------------------


def _bullets():
    return [
        Bullet(section="experience", job_id=10, text="Built pipelines", source_card_id=1),
        Bullet(section="projects", job_id=None, text="Built a TypeScript web app", source_card_id=2),
    ]


def test_suggestions_only_use_existing_cards():
    llm = FakeLLM(suggest_reply(
        (0, "Built Airflow pipelines", ["Airflow"], 999),  # unknown card
        (0, "Built Airflow pipelines", ["Airflow"], 2),  # not the bullet's card
        (7, "Built Airflow pipelines", ["Airflow"], 1),  # no such bullet
        (1, "Built a TypeScript web app on PostgreSQL", ["PostgreSQL", "Kubernetes"], 2),
        (0, "Built Airflow pipelines in Python", ["Airflow", "Python"], 1),
    ))
    missing = [req("Airflow"), req("PostgreSQL"), req("Python")]
    out = suggest(llm, _cards(), _bullets(), missing)
    assert out == [
        Suggestion(bullet_index=1, old="Built a TypeScript web app",
                   new="Built a TypeScript web app on PostgreSQL",
                   terms=["PostgreSQL"], source_card_id=2, score_delta=0),
        Suggestion(bullet_index=0, old="Built pipelines", new="Built Airflow pipelines in Python",
                   terms=["Airflow", "Python"], source_card_id=1, score_delta=0),
    ]
    assert out[0].old_tex == "Built a TypeScript web app"
    system = llm.calls[0]["system"].lower()
    assert system == SUGGEST_SYSTEM_PROMPT.lower()
    assert "only facts" in system and "never add" in system


def test_suggestion_with_invented_number_or_no_real_term_is_dropped():
    llm = FakeLLM(suggest_reply(
        (0, "Built Airflow pipelines serving 300 teams", ["Airflow"], 1),  # invented number
        (0, "Built data pipelines", ["Airflow"], 1),  # claims a term the text lacks
        (1, "Built a TypeScript web app", ["PostgreSQL"], 2),  # no change
    ))
    assert suggest(llm, _cards(), _bullets(), [req("Airflow"), req("PostgreSQL")]) == []


def test_suggest_without_missing_terms_makes_no_ai_call():
    llm = FakeLLM()
    assert suggest(llm, _cards(), _bullets(), []) == []
    # Uncovered terms cannot be suggested, so they do not justify a call either.
    assert suggest(llm, _cards(), _bullets(), [req("Kubernetes")]) == []
    assert llm.calls == []


def test_uncovered_is_deterministic_and_uses_tags_and_aliases():
    cards = [
        Card(id=1, kind="project", title="Infra", description="Ran clusters", tags=["k8s"]),
        Card(id=2, kind="skill", title="Rust"),
    ]
    missing = [req("Kubernetes"), req("Rust"), req("Haskell"), req("Terraform")]
    assert [r.term for r in uncovered(missing, cards)] == ["Haskell", "Terraform"]
    assert uncovered(missing, []) == missing


def test_uncovered_requirement_listed_not_invented(client, use_llm, record):
    p, w = record["pipelines"]["id"], record["webapp"]["id"]
    llm = use_llm(FakeLLM(
        cater_reply(
            (p, "Deployed Airflow pipelines on Kubernetes"),  # card never mentions Kubernetes
            (p, "Built Python Airflow pipelines"),
            (w, "Built a TypeScript web app"),
        ),
        suggest_reply(
            (1, "Built a TypeScript web app on Kubernetes", ["Kubernetes"], w),
            (1, "Built a TypeScript web app backed by PostgreSQL", ["PostgreSQL"], w),
        ),
    ))
    app_id = client.post("/api/applications", json={"posting_id": add_posting(POSTING_REQS)}).json()["id"]
    body = client.get(f"/api/applications/{app_id}").json()
    assert [u["term"] for u in body["uncovered"]] == ["Kubernetes"]
    assert "kubernetes" not in body["version"]["tex"].lower()
    assert all("kubernetes" not in b["text"].lower() for b in body["version"]["bullets"])
    assert [s["terms"] for s in body["suggestions"]] == [["PostgreSQL"]]
    assert all("kubernetes" not in s["new"].lower() for s in body["suggestions"])
    # The suggestion prompt is never asked to work an uncovered term in.
    assert "Kubernetes" not in llm.calls[1]["user"]


# --- application routes ------------------------------------------------------------


def test_posting_must_exist(client, use_llm, record):
    llm = use_llm(FakeLLM())
    r = client.post("/api/applications", json={"posting_id": 999})
    assert r.status_code == 404
    assert llm.calls == []


def test_get_returns_latest_version_score_and_suggestions(client, use_llm, record):
    use_llm(FakeLLM(*good_replies(record)))
    app_id = client.post("/api/applications", json={"posting_id": add_posting(POSTING_REQS)}).json()["id"]
    body = client.get(f"/api/applications/{app_id}").json()
    assert body["posting"] == {"id": body["posting_id"], "title": "ML Engineer", "company": "Globex"}
    assert body["stale"] is False
    statuses = {m["term"]: m["status"] for m in body["matches"]}
    assert statuses == {"Python": "matched", "Airflow": "matched", "PostgreSQL": "missing",
                        "Kubernetes": "missing"}
    (s,) = body["suggestions"]
    assert s["old"] == "Built a TypeScript web app" and s["terms"] == ["PostgreSQL"]
    assert s["score_delta"] > 0
    assert body["potential"] == body["score"] + s["score_delta"]
    assert client.get("/api/applications/999").status_code == 404


def test_version_marked_stale_after_record_edit(client, use_llm, record):
    llm = use_llm(FakeLLM(*good_replies(record)))
    app_id = client.post("/api/applications", json={"posting_id": add_posting(POSTING_REQS)}).json()["id"]
    before = client.get(f"/api/applications/{app_id}").json()
    assert before["stale"] is False

    client.patch(f"/api/cards/{record['webapp']['id']}", json={"description": "Changed."})
    after = client.get(f"/api/applications/{app_id}").json()
    assert after["stale"] is True
    # A snapshot: nothing was regenerated.
    assert after["version"] == before["version"]
    assert len(llm.calls) == 2
    assert len(rows(ResumeVersion)) == 1


def test_saving_edited_tex_creates_new_version(client, use_llm, record):
    use_llm(FakeLLM(*good_replies(record)))
    app_id = client.post("/api/applications", json={"posting_id": add_posting(POSTING_REQS)}).json()["id"]
    v1 = client.get(f"/api/applications/{app_id}").json()["version"]
    edited = v1["tex"].replace("Built a TypeScript web app", "Built a TypeScript web app on Kubernetes")

    r = client.post(f"/api/applications/{app_id}/versions", json={"tex": edited})
    assert r.status_code == 201
    assert r.json()["version"] == 2

    body = client.get(f"/api/applications/{app_id}").json()
    assert body["version"]["version"] == 2 and body["version"]["tex"] == edited
    assert body["version"]["bullets"] == v1["bullets"]
    assert body["version"]["record_hash"] == v1["record_hash"]
    assert {m["term"]: m["status"] for m in body["matches"]}["Kubernetes"] == "matched"
    # The edited line no longer holds the suggestion's old text, so the suggestion is gone.
    assert body["suggestions"] == []
    assert len(rows(ResumeVersion)) == 2

    assert client.post("/api/applications/999/versions", json={"tex": "x"}).status_code == 404
    assert client.post(f"/api/applications/{app_id}/versions", json={"tex": "x" * 200_001}).status_code == 422


def test_score_endpoint_scores_posted_tex_without_ai(client, use_llm, record):
    llm = use_llm(FakeLLM(*good_replies(record)))
    app_id = client.post("/api/applications", json={"posting_id": add_posting(POSTING_REQS)}).json()["id"]
    tex = client.get(f"/api/applications/{app_id}").json()["version"]["tex"]

    r = client.post(f"/api/applications/{app_id}/score", json={"tex": tex})
    assert r.status_code == 200
    body = r.json()
    assert set(body) == {"score", "matches", "potential"}
    assert body["potential"] > body["score"]

    applied = tex.replace("Built a TypeScript web app", "Built a TypeScript web app backed by PostgreSQL")
    after = client.post(f"/api/applications/{app_id}/score", json={"tex": applied}).json()
    assert after["score"] == body["potential"] and after["potential"] == after["score"]

    bare = client.post(f"/api/applications/{app_id}/score", json={"tex": "Python only"}).json()
    assert bare["score"] < body["score"]
    assert client.post("/api/applications/999/score", json={"tex": tex}).status_code == 404
    assert len(llm.calls) == 2


def test_status_filter_and_search(client, use_llm, record):
    p, w = record["pipelines"]["id"], record["webapp"]["id"]
    use_llm(FakeLLM(
        # First resume: the only gap its bullets' cards could fill is none, so no suggestion call.
        cater_reply((p, "Built Python Airflow pipelines")),
        # Second resume: the web app card mentions Postgres, so suggestions are requested.
        cater_reply((w, "Built a TypeScript web app")), suggest_reply(),
    ))
    a = client.post("/api/applications",
                    json={"posting_id": add_posting(POSTING_REQS, "ML Engineer", "Globex")}).json()
    b = client.post("/api/applications",
                    json={"posting_id": add_posting(POSTING_REQS, "Data Analyst", "Initech")}).json()

    r = client.patch(f"/api/applications/{b['id']}", json={"status": "interview"})
    assert r.status_code == 200 and r.json()["status"] == "interview"

    def ids(**params):
        r = client.get("/api/applications", params=params)
        assert r.status_code == 200
        return [x["id"] for x in r.json()]

    assert sorted(ids()) == sorted([a["id"], b["id"]])
    assert ids(status="interview") == [b["id"]]
    assert ids(status="not_applied") == [a["id"]]
    assert ids(q="globex") == [a["id"]]
    assert ids(q="ANALYST") == [b["id"]]
    assert ids(q="initech", status="not_applied") == []
    item = client.get("/api/applications", params={"q": "globex"}).json()[0]
    assert item["title"] == "ML Engineer" and item["company"] == "Globex"
    assert item["version"] == 1 and isinstance(item["score"], int) and item["updated_at"]

    assert client.get("/api/applications", params={"status": "ghosted"}).status_code == 422
    assert client.patch(f"/api/applications/{a['id']}", json={"status": None}).status_code == 422
    assert client.patch(f"/api/applications/{a['id']}", json={"status": "hired"}).status_code == 422
    assert client.patch("/api/applications/999", json={"status": "applied"}).status_code == 404


def test_list_items_carry_stale_format_and_aware_updated_at(client, use_llm, record):
    from datetime import datetime

    use_llm(FakeLLM(*good_replies(record)))
    app_id = client.post("/api/applications", json={"posting_id": add_posting(POSTING_REQS)}).json()["id"]

    def item():
        (only,) = [x for x in client.get("/api/applications").json() if x["id"] == app_id]
        return only

    first = item()
    assert first["stale"] is False
    assert first["format"] == "tex"
    parsed = datetime.fromisoformat(first["updated_at"].replace("Z", "+00:00"))
    assert parsed.tzinfo is not None and parsed.utcoffset().total_seconds() == 0
    assert first["updated_at"].endswith(("Z", "+00:00"))

    # A Record change makes the snapshot stale, exactly as GET /api/applications/{id} reports.
    client.patch(f"/api/cards/{record['webapp']['id']}", json={"description": "Changed."})
    assert item()["stale"] is True
    assert client.get(f"/api/applications/{app_id}").json()["stale"] is True

    # A hand-edited version keeps the old snapshot hash, so it is still stale.
    tex = client.get(f"/api/applications/{app_id}").json()["version"]["tex"]
    assert client.post(f"/api/applications/{app_id}/versions", json={"tex": tex + "%"}).status_code == 201
    after = item()
    assert after["version"] == 2 and after["stale"] is True and after["format"] == "tex"


def test_cater_calls_llm_once_per_action(client, use_llm, record):
    llm = use_llm(FakeLLM(*good_replies(record)))
    app_id = client.post("/api/applications", json={"posting_id": add_posting(POSTING_REQS)}).json()["id"]
    # Auto cater = one cater call plus one suggestion call.
    assert [c["system"] for c in llm.calls] == [CATER_SYSTEM_PROMPT, SUGGEST_SYSTEM_PROMPT]

    tex = client.get(f"/api/applications/{app_id}").json()["version"]["tex"]
    client.get("/api/applications")
    client.post(f"/api/applications/{app_id}/score", json={"tex": tex})
    client.post(f"/api/applications/{app_id}/versions", json={"tex": tex})
    client.patch(f"/api/applications/{app_id}", json={"status": "applied"})
    client.get(f"/api/applications/{app_id}")
    assert len(llm.calls) == 2


def test_cater_skips_suggestion_call_when_nothing_to_suggest(client, use_llm, record):
    llm = use_llm(FakeLLM(cater_reply((record["pipelines"]["id"], "Built Python Airflow pipelines"))))
    posting_id = add_posting([req("Python"), req("Airflow"), req("Kubernetes")])
    assert client.post("/api/applications", json={"posting_id": posting_id}).status_code == 201
    assert len(llm.calls) == 1


@pytest.mark.parametrize("stage", ["cater", "suggest", "malformed"])
def test_ai_failure_returns_502_and_creates_nothing(client, use_llm, record, stage):
    cater, sugg = good_replies(record)
    replies = {
        "cater": [AIError("The AI provider request failed (APIError).")],
        "suggest": [cater, AIError("The AI provider request failed (APIError).")],
        "malformed": ["{not json"],
    }[stage]
    use_llm(FakeLLM(*replies))
    r = client.post("/api/applications", json={"posting_id": add_posting(POSTING_REQS)})
    assert r.status_code == 502
    assert r.json()["detail"].startswith("The AI")
    assert rows(Application) == [] and rows(ResumeVersion) == []


def test_no_key_returns_400_and_creates_nothing(client, record):
    r = client.post("/api/applications", json={"posting_id": add_posting(POSTING_REQS)})
    assert r.status_code == 400
    assert "API key" in r.json()["detail"]
    assert rows(Application) == [] and rows(ResumeVersion) == []


def test_posting_with_applications_cannot_be_deleted(client, use_llm, record):
    use_llm(FakeLLM(*good_replies(record)))
    posting_id = add_posting(POSTING_REQS)
    app_id = client.post("/api/applications", json={"posting_id": posting_id}).json()["id"]
    r = client.delete(f"/api/postings/{posting_id}")
    assert r.status_code == 409 and "application" in r.json()["detail"]
    assert client.get(f"/api/applications/{app_id}").status_code == 200


def test_build_resume_orders_recent_jobs_first_and_bullets_by_render_order():
    old = Job(id=1, company="Old Co", title="Analyst", start_date="2015", end_date="2018")
    cur = Job(id=2, company="New Co", title="Engineer", start_date="2021")
    cards = [
        Card(id=10, job_id=1, kind="project", title="A", description="a"),
        Card(id=11, job_id=2, kind="project", title="B", description="b"),
        Card(id=12, kind="project", title="Side", description="c"),
        *[Card(id=20 + i, kind="education", title=f"School {i}") for i in range(5)],
        *[Card(id=30 + i, kind="certificate", title=f"Cert {i}") for i in range(6)],
        Card(id=40, kind="skill", title="Go", extra={"category": "Languages"}),
        Card(id=41, kind="skill", title="Python", extra={"category": "Languages"}),
    ]
    bullets = [
        Bullet("projects", None, "Side bullet", 12),
        Bullet("experience", 1, "Old bullet", 10),
        Bullet("experience", 2, "New bullet", 11),
    ]
    from app.cater import MAX_CERTIFICATIONS, MAX_EDUCATION, build_resume
    from app.models import Profile

    tex, ordered = build_resume(Profile(name="Ann"), [old, cur], cards, bullets, [req("Python")])
    assert [b.text for b in ordered] == ["New bullet", "Old bullet", "Side bullet"]
    assert resume_items(tex) == ["New bullet", "Old bullet", "Side bullet"]
    assert tex.index("New Co") < tex.index("Old Co")
    assert tex.count("School ") == MAX_EDUCATION and tex.count("Cert ") == MAX_CERTIFICATIONS
    assert "Python, Go" in tex  # skills the posting asks for come first


# --- fix round 1: strict support and number words -------------------------------------

# (card text, requirement, kind, a bullet that claims the requirement)
PROBES = [
    ("Reacted quickly to production incidents", "React", "skill", "Built React frontends"),
    ("Sparked a team discussion", "Spark", "tool", "Ran Spark jobs"),
    ("Removed rusted legacy code", "Rust", "skill", "Rewrote services in Rust"),
    ("Labeled flasks in the lab", "Flask", "tool", "Built Flask APIs"),
    ("Worked at the docks", "Docker", "tool", "Containerized apps with Docker"),
    ("Go-to person for on-call", "Go", "skill", "Wrote Go services"),
    ("Ruby anniversary party planning", "Ruby", "skill", "Built Ruby services"),
    ("Shipped the spring release", "Spring", "tool", "Built Spring services"),
]


def _probe_cards(text):
    return [
        Card(id=1, kind="project", title="Work", description=text, tags=["Python"]),
        Card(id=2, kind="project", title="Docs", description="Wrote documentation"),
    ]


@pytest.mark.parametrize("text,term,kind,claim", PROBES)
def test_word_collisions_are_not_support(text, term, kind, claim):
    requirement = Requirement(term=term, kind=kind, weight=2)
    cards = _probe_cards(text)
    # (a) the requirement is still uncovered
    assert card_supports(cards[0], requirement) is False
    assert uncovered([requirement], cards) == [requirement]

    # (b) the cater prompt lists it as not in the Record; (c) a bullet claiming it is dropped
    llm = FakeLLM(cater_reply((1, claim), (2, "Wrote documentation")))
    bullets = auto_cater(llm, [], cards, _posting([requirement]))
    assert [b.text for b in bullets] == ["Wrote documentation"]
    not_in_record = llm.calls[0]["user"].split("Not in the Record")[1].split("Jobs")[0]
    assert f"- {term}\n" in not_in_record + "\n"

    # (d) the suggest prompt never offers it, and a suggestion claiming it is dropped
    bullet = [Bullet("projects", None, "Handled the work", 1)]
    llm = FakeLLM(suggest_reply((0, f"{claim} in Python", [term, "Python"], 1)))
    out = suggest(llm, cards, bullet, [requirement, req("Python")])
    assert out == []
    user = llm.calls[0]["user"]
    missing_section = user.split("Bullets that could cover them")[0]
    assert f"- {term}\n" not in missing_section + "\n"
    rows = json.loads(user.split("Bullets that could cover them:\n")[1].split("\n\nTheir source cards")[0])
    assert rows[0]["terms_its_card_supports"] == ["Python"]


@pytest.mark.parametrize("card,term,kind,claim", [
    (Card(id=1, kind="project", title="UI", description="Built React frontends"), "React", "skill",
     "Built React frontends for the shop"),
    (Card(id=1, kind="project", title="Infra", description="Ran clusters", tags=["k8s"]), "Kubernetes",
     "tool", "Ran Kubernetes clusters"),
    (Card(id=1, kind="project", title="API", description="Wrote services", tags=["Go"]), "Go", "skill",
     "Wrote Go services"),
    (Card(id=1, kind="project", title="API", description="Wrote services in Go and Python"), "Go",
     "skill", "Wrote Go services"),
    (Card(id=1, kind="skill", title="Rust"), "Rust", "skill", None),
])
def test_real_mentions_still_support(card, term, kind, claim):
    requirement = Requirement(term=term, kind=kind, weight=2)
    assert card_supports(card, requirement) is True
    assert uncovered([requirement], [card]) == []
    if claim:
        bullets = auto_cater(FakeLLM(cater_reply((1, claim))), [], [card], _posting([requirement]))
        assert [b.text for b in bullets] == [claim]


def test_stems_support_responsibilities_but_not_tools():
    card = Card(id=1, kind="project", title="Team", description="Mentored juniors and reacted to alerts")
    assert card_supports(card, Requirement(term="mentoring", kind="responsibility", weight=2))
    assert not card_supports(card, Requirement(term="React", kind="skill", weight=2))
    # The card's own wording is not a claim, even when the scorer would credit it.
    bullets = auto_cater(FakeLLM(cater_reply((1, "Mentored juniors and reacted to alerts"))), [], [card],
                         _posting([Requirement(term="React", kind="skill", weight=2)]))
    assert [b.text for b in bullets] == ["Mentored juniors and reacted to alerts"]


NUMBER_WORD_BULLETS = [
    "Tripled revenue for the team",
    "Doubled pipeline throughput",
    "Halved report latency",
    "Quadrupled test coverage",
    "Served two million users",
    "Reviewed a dozen designs",
    "Fixed hundreds of bugs",
    "Led ten engineers",
    "Made queries 10x faster",
    "Cut costs threefold",
    "Grew usage 3-fold",
    "Onboarded thousands of customers",
    "Processed billions of events",
]


@pytest.mark.parametrize("claim", NUMBER_WORD_BULLETS)
def test_number_words_not_in_card_are_dropped(claim):
    cards = [Card(id=1, kind="project", title="Pipelines", description="Built pipelines for users"),
             Card(id=2, kind="project", title="Docs", description="Wrote documentation")]
    llm = FakeLLM(cater_reply((1, claim), (2, "Wrote documentation")))
    assert [b.text for b in auto_cater(llm, [], cards, _posting([req("Python")]))] == ["Wrote documentation"]


@pytest.mark.parametrize("claim", NUMBER_WORD_BULLETS)
def test_number_words_in_card_are_allowed(claim):
    card = Card(id=1, kind="project", title="Growth", description=(
        "Tripled revenue, doubled throughput, halved latency and quadrupled coverage. Served two "
        "million users, reviewed a dozen designs, fixed hundreds of bugs, led ten engineers, made "
        "queries 10x faster, cut costs threefold, grew usage 3-fold, onboarded thousands of "
        "customers and processed billions of events."))
    bullets = auto_cater(FakeLLM(cater_reply((1, claim))), [], [card], _posting([req("Python")]))
    assert [b.text for b in bullets] == [claim]


@pytest.mark.parametrize("text,kept", [
    ("Led ten engineers", True),  # ten == 10
    ("Led 2 teams of ten", True),
    ("Was one of the engineers who led a team", True),  # "one" and "a" are not quantities here
    ("Served one million users", False),  # "one million" is a quantity the card lacks
    ("Led three teams", False),
    ("Led 3 teams", False),
])
def test_number_words_and_digits_are_interchangeable_and_one_is_not_a_number_alone(text, kept):
    cards = [Card(id=1, kind="project", title="Team", description="Led 10 engineers on 2 teams"),
             Card(id=2, kind="project", title="Docs", description="Wrote documentation")]
    llm = FakeLLM(cater_reply((1, text), (2, "Wrote documentation")))
    texts = [b.text for b in auto_cater(llm, [], cards, _posting([req("Python")]))]
    assert texts == ([text] if kept else []) + ["Wrote documentation"]
