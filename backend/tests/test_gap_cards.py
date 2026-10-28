"""Gap cards: a card nobody can cite never silences a "Not in your record yet" gap, and the
API refuses to create the one card shape (a job-less accomplishment) that nothing can cite."""

from sqlmodel import Session

from app import db
from app.cater import uncovered
from app.models import Card, Requirement
from tests.test_cater import FakeLLM, add_posting, cater_reply, use_llm  # noqa: F401

K8S = Requirement(term="Kubernetes", kind="tool", weight=2)
TEXT = "Operated a Kubernetes cluster"


def _job(client):
    return client.post("/api/jobs", json={"company": "Acme", "title": "SRE"}).json()


def test_post_jobless_accomplishment_is_rejected(client):
    r = client.post("/api/cards", json={"kind": "accomplishment", "title": TEXT, "description": TEXT})
    assert r.status_code == 422
    assert "job" in r.json()["detail"].lower()
    assert client.get("/api/cards").json() == []


def test_same_text_as_project_or_under_a_job_is_saved_and_listed(client):
    job = _job(client)
    p = client.post("/api/cards", json={"kind": "project", "title": TEXT, "description": TEXT})
    a = client.post("/api/cards", json={"kind": "accomplishment", "title": TEXT, "description": TEXT,
                                        "job_id": job["id"]})
    assert p.status_code == 201 and a.status_code == 201
    assert {c["id"] for c in client.get("/api/cards").json()} == {p.json()["id"], a.json()["id"]}


def test_patch_cannot_make_a_jobless_accomplishment(client):
    job = _job(client)
    proj = client.post("/api/cards", json={"kind": "project", "title": "P", "description": "d"}).json()
    r = client.patch(f"/api/cards/{proj['id']}", json={"kind": "accomplishment"})
    assert r.status_code == 422
    acc = client.post("/api/cards", json={"kind": "accomplishment", "title": "A", "description": "d",
                                          "job_id": job["id"]}).json()
    r = client.patch(f"/api/cards/{acc['id']}", json={"job_id": None})
    assert r.status_code == 422
    # Moving it to a job together with the kind change is fine.
    r = client.patch(f"/api/cards/{proj['id']}", json={"kind": "accomplishment", "job_id": job["id"]})
    assert r.status_code == 200


def test_uncovered_ignores_cards_nothing_can_cite():
    cases = [
        (Card(id=1, kind="accomplishment", title=TEXT, description=TEXT), True),  # job-less: never a bullet
        (Card(id=1, kind="behavioral", title="Tell me about...", description=TEXT), True),  # never printed
        (Card(id=1, kind="project", title="Cluster", description=""), True),  # title only: never a bullet
        (Card(id=1, kind="skill", title="Python", description=TEXT), True),  # skills print the title only
        (Card(id=1, kind="skill", title="Python", tags=["Kubernetes"]), True),
        (Card(id=1, kind="project", title="Cluster", description=TEXT), False),
        (Card(id=1, job_id=5, kind="accomplishment", title="Ops", description=TEXT), False),
        (Card(id=1, kind="skill", title="Kubernetes"), False),
        (Card(id=1, kind="skill", title="k8s"), False),
        (Card(id=1, kind="certificate", title="Certified Kubernetes Administrator"), False),
        (Card(id=1, kind="education", title="State U", description="BSc, Kubernetes track"), False),
    ]
    for c, gap in cases:
        assert (uncovered([K8S], [c]) == [K8S]) is gap, (c.kind, c.job_id, c.title, c.description)


def test_reviewer_scenario_end_to_end(client, use_llm):  # noqa: F811
    """An existing job-less accomplishment (e.g. from an older import) mentioning Kubernetes
    does not hide the gap; the same text as a project does."""
    job = _job(client)
    base = client.post("/api/cards", json={"kind": "accomplishment", "job_id": job["id"],
                                           "title": "Wrote Python", "description": "Wrote Python services"}).json()
    with Session(db.get_engine()) as s:  # bypasses the API's check, as an old import could
        orphan = Card(kind="accomplishment", title=TEXT, description=TEXT)
        s.add(orphan)
        s.commit()
        orphan_id = orphan.id
    assert orphan_id in {c["id"] for c in client.get("/api/cards").json()}

    posting = add_posting([Requirement(term="Python", kind="skill", weight=2), K8S])
    use_llm(FakeLLM(cater_reply((base["id"], "Wrote Python services"))))
    app_id = client.post("/api/applications", json={"posting_id": posting}).json()["id"]
    body = client.get(f"/api/applications/{app_id}").json()
    assert [u["term"] for u in body["uncovered"]] == ["Kubernetes"]

    # Converting it to a project makes it citable, so the gap is no longer reported.
    r = client.patch(f"/api/cards/{orphan_id}", json={"kind": "project"})
    assert r.status_code == 200
    body = client.get(f"/api/applications/{app_id}").json()
    assert body["uncovered"] == []
