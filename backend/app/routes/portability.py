from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, SQLModel, delete, select

from app.db import get_session
from app.models import Card, CardBase, Job, JobBase, Profile, ProfileBase

router = APIRouter(prefix="/api")

SCHEMA_VERSION = 1


class JobDoc(JobBase):
    id: int
    extra: dict = {}


class CardDoc(CardBase):
    id: int
    tags: list[str] = []
    extra: dict = {}


class ExportDoc(SQLModel):
    schema_version: int
    jobs: list[JobDoc]
    cards: list[CardDoc]
    profile: ProfileBase


@router.get("/export", response_model=ExportDoc)
def export_all(session: Session = Depends(get_session)):
    profile = session.get(Profile, 1)
    return ExportDoc(
        schema_version=SCHEMA_VERSION,
        jobs=[JobDoc(**j.model_dump()) for j in session.exec(select(Job).order_by(Job.id))],
        cards=[CardDoc(**c.model_dump()) for c in session.exec(select(Card).order_by(Card.id))],
        profile=ProfileBase(**profile.model_dump(exclude={"id"})) if profile else ProfileBase(),
    )


@router.post("/import")
def import_all(doc: ExportDoc, session: Session = Depends(get_session)):
    if doc.schema_version != SCHEMA_VERSION:
        raise HTTPException(422, f"unsupported schema_version {doc.schema_version}")
    job_ids = {j.id for j in doc.jobs}
    if len(job_ids) != len(doc.jobs) or len({c.id for c in doc.cards}) != len(doc.cards):
        raise HTTPException(422, "duplicate ids in import")
    missing = sorted({c.job_id for c in doc.cards if c.job_id is not None} - job_ids)
    if missing:
        raise HTTPException(422, f"cards reference unknown job ids: {missing}")
    try:
        session.exec(delete(Card))
        session.exec(delete(Job))
        session.exec(delete(Profile))
        session.add_all(Job(**j.model_dump()) for j in doc.jobs)
        session.flush()  # jobs before the cards that reference them
        session.add_all(Card(**c.model_dump()) for c in doc.cards)
        session.add(Profile(id=1, **doc.profile.model_dump()))
        session.commit()
    except Exception:
        session.rollback()
        raise
    return {"jobs": len(doc.jobs), "cards": len(doc.cards)}
