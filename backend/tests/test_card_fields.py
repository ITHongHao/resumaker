"""Card fields set in the Record form (per-kind `extra`, and `details`) round-trip through the
API and reach the rendered .tex; `details` never does."""

from sqlmodel import Session, select

from app import db
from app.cater import build_resume
from app.latex.template import Bullet
from app.models import Card, Profile


def test_card_form_fields_round_trip_and_render(client):
    posts = [
        {"kind": "education", "title": "State University", "description": "BSc Computer Science",
         "details": "Thesis on schedulers", "extra": {"location": "Springfield, IL", "start_date": "Sep 2016", "end_date": "May 2020"}},
        {"kind": "project", "title": "Ledger", "description": "Built a ledger in Rust.",
         "details": "SECRET-DETAIL", "extra": {"start_date": "Jan 2021", "end_date": "Jun 2021"}},
        {"kind": "skill", "title": "Rust", "extra": {"category": "Languages"}},
        {"kind": "certificate", "title": "AWS Solutions Architect", "extra": {"date": "Mar 2023"}},
    ]
    ids = []
    for body in posts:
        r = client.post("/api/cards", json=body)
        assert r.status_code == 201, r.text
        assert r.json()["extra"] == body["extra"] and r.json()["details"] == body.get("details", "")
        ids.append(r.json()["id"])
    # Edit round-trip
    r = client.patch(f"/api/cards/{ids[3]}", json={"extra": {"date": "Apr 2023"}, "details": "renewed"})
    assert r.json()["extra"] == {"date": "Apr 2023"} and r.json()["details"] == "renewed"

    with Session(db.get_engine()) as s:
        cards = list(s.exec(select(Card).order_by(Card.id)))
    tex, _ = build_resume(Profile(name="Ann"), [], cards,
                          [Bullet("projects", None, "Built a ledger in Rust", ids[1])], [])
    body = tex.split("\\begin{document}", 1)[1]
    for text in ("Springfield, IL", "Sep 2016 -- May 2020", "Jan 2021 -- Jun 2021",
                 "\\textbf{Languages}{: Rust}", "Apr 2023"):
        assert text in body, text
    assert "SECRET-DETAIL" not in tex and "Thesis on schedulers" not in tex
