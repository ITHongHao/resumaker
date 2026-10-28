from sqlmodel import Session

from app import db, recordfields
from app.models import Card


def test_printed_keys_match_today():
    assert recordfields.printed_keys("education") == (
        "location", "start_date", "end_date", "degree_type", "field_of_study")
    assert recordfields.printed_keys("skill") == ("category",)
    assert recordfields.printed_keys("certificate") == ("date",)
    assert recordfields.printed_keys("project") == ("start_date", "end_date")
    assert recordfields.printed_keys("accomplishment") == ()
    assert recordfields.printed_keys("job") == ()


def test_job_columns_are_in_keys_but_not_extra():
    assert {"manager_contact", "reason_for_leaving", "company"} <= set(recordfields.keys("job"))
    cleaned = recordfields.clean_extra("job", {"salary": " 90k ", "manager_contact": "x"})
    assert cleaned["salary"] == "90k"


def test_clean_extra_caps_strips_and_keeps_unknown():
    out = recordfields.clean_extra(
        "education", {"gpa": " 3.7 ", "minor": "x" * 300, "zzz": "keep", "notes": ""})
    assert out["gpa"] == "3.7"
    assert len(out["minor"]) == 100
    assert out["zzz"] == "keep"
    assert "notes" not in out


def test_yesno_rejects_other_values():
    assert recordfields.clean_extra("job", {"ok_to_contact": "yes"}) == {"ok_to_contact": "yes"}
    assert recordfields.clean_extra("job", {"ok_to_contact": "no"}) == {"ok_to_contact": "no"}
    assert recordfields.clean_extra("job", {"ok_to_contact": "maybe", "currently_here": "true"}) == {}


def test_post_card_cleans_extra(client):
    r = client.post("/api/cards", json={"kind": "education", "title": "State U",
                    "extra": {"gpa": " 3.7 ", "minor": "x" * 300, "notes": "", "zzz": "keep"}})
    assert r.status_code == 201, r.text
    extra = r.json()["extra"]
    assert extra["gpa"] == "3.7" and len(extra["minor"]) == 100
    assert extra["zzz"] == "keep" and "notes" not in extra


def test_patch_card_cleans_extra(client):
    cid = client.post("/api/cards", json={"kind": "skill", "title": "Rust"}).json()["id"]
    r = client.patch(f"/api/cards/{cid}", json={"extra": {"level": " Expert ", "years": ""}})
    assert r.status_code == 200
    assert r.json()["extra"] == {"level": "Expert"}


def test_new_behavioral_card_is_422_but_existing_row_readable(client):
    with Session(db.get_engine()) as s:
        s.add(Card(kind="behavioral", title="Tell me about a conflict"))
        s.commit()
    r = client.get("/api/cards")
    assert [c["kind"] for c in r.json()] == ["behavioral"]
    r = client.post("/api/cards", json={"kind": "behavioral", "title": "Q"})
    assert r.status_code == 422 and "Interview" in r.text
    cid = client.post("/api/cards", json={"kind": "project", "title": "P"}).json()["id"]
    r = client.patch(f"/api/cards/{cid}", json={"kind": "behavioral"})
    assert r.status_code == 422 and "Interview" in r.text


def test_job_extra_roundtrip(client):
    r = client.post("/api/jobs", json={"company": "Acme", "title": "SRE",
                                       "extra": {"salary": " 90k ", "ok_to_contact": "maybe"}})
    assert r.status_code == 201, r.text
    jid = r.json()["id"]
    assert r.json()["extra"] == {"salary": "90k"}
    r = client.patch(f"/api/jobs/{jid}", json={"extra": {"salary": "95k", "manager_name": "Bo"}})
    assert r.json()["extra"] == {"salary": "95k", "manager_name": "Bo"}
    assert client.get(f"/api/jobs/{jid}").json()["extra"] == {"salary": "95k", "manager_name": "Bo"}
    assert client.post("/api/jobs", json={"company": "B", "title": "T"}).json()["extra"] == {}
