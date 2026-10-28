"""record_hash decides whether a resume is out of date. It must stay what it was before job
extras and stored-only card fields existed, so upgrading never makes every resume look stale,
and it must not change for edits nothing on a resume shows."""
from sqlmodel import Session

from app import db
from app.models import Card, Job

# record_hash of the fixture below, computed with the code at commit 70d13d0 (before job extras
# and stored-only fields).
PRE_UPGRADE_HASH = "7dfd44cbc23ae450bc08bb5585966ec60043aa284ced7d8f1e50ae750a61cebd"


def _seed():
    with Session(db.get_engine()) as s:
        s.add(Job(id=1, company="Acme", title="Engineer", location="Remote",
                  employment_type="Full-time", start_date="2021", end_date="2024"))
        s.flush()
        s.add(Card(id=1, job_id=1, kind="project", title="Search", description="Built search",
                   details="10x faster", tags=["python", "es"], extra={}))
        s.add(Card(id=2, kind="education", title="State U", description="BS CS",
                   extra={"location": "Boston", "start_date": "2016", "end_date": "2020"}))
        s.add(Card(id=3, kind="skill", title="Python", extra={"category": "Languages"}))
        s.add(Card(id=4, kind="certificate", title="AWS SA",
                   extra={"date": "2023", "imported_key": "x"}))
        s.commit()


def _hash():
    with Session(db.get_engine()) as s:
        return db.record_hash(s)


def _set(model, id, **kw):
    with Session(db.get_engine()) as s:
        row = s.get(model, id)
        for k, v in kw.items():
            setattr(row, k, v)
        s.add(row)
        s.commit()


def test_hash_is_unchanged_from_before_the_upgrade(client):
    _seed()
    assert _hash() == PRE_UPGRADE_HASH


def test_job_extra_does_not_change_the_hash(client):
    _seed()
    _set(Job, 1, extra={"salary": "100k", "currently_here": "yes"})
    assert _hash() == PRE_UPGRADE_HASH


def test_stored_only_card_extra_does_not_change_the_hash(client):
    _seed()
    _set(Card, 2, extra={"location": "Boston", "start_date": "2016", "end_date": "2020",
                         "gpa": "3.9", "minor": "Math"})
    _set(Card, 3, extra={"category": "Languages", "level": "Expert"})
    assert _hash() == PRE_UPGRADE_HASH


def test_printed_card_extra_changes_the_hash(client):
    _seed()
    _set(Card, 2, extra={"location": "Boston", "start_date": "2016", "end_date": "2020",
                         "degree_type": "Bachelor's"})
    assert _hash() != PRE_UPGRADE_HASH
