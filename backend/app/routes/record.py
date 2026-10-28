from fastapi import APIRouter, Depends, HTTPException, Response
from sqlmodel import Session, col, delete, select

from app.db import get_session
from app.models import (
    Card,
    CardCreate,
    CardKind,
    CardUpdate,
    Job,
    JobCreate,
    JobUpdate,
)

router = APIRouter(prefix="/api")


def _get(session: Session, model, id: int):
    obj = session.get(model, id)
    if obj is None:
        raise HTTPException(404, f"{model.__name__} {id} not found")
    return obj


def _check_job(session: Session, job_id: int | None) -> None:
    if job_id is not None:
        _get(session, Job, job_id)


@router.get("/jobs", response_model=list[Job])
def list_jobs(session: Session = Depends(get_session)):
    return session.exec(select(Job).order_by(Job.id)).all()


@router.post("/jobs", response_model=Job, status_code=201)
def create_job(body: JobCreate, session: Session = Depends(get_session)):
    job = Job.model_validate(body)
    session.add(job)
    session.commit()
    session.refresh(job)
    return job


@router.get("/jobs/{job_id}", response_model=Job)
def get_job(job_id: int, session: Session = Depends(get_session)):
    return _get(session, Job, job_id)


@router.patch("/jobs/{job_id}", response_model=Job)
def update_job(job_id: int, body: JobUpdate, session: Session = Depends(get_session)):
    job = _get(session, Job, job_id)
    job.sqlmodel_update(body.model_dump(exclude_unset=True))
    session.add(job)
    session.commit()
    session.refresh(job)
    return job


@router.delete("/jobs/{job_id}", status_code=204)
def delete_job(job_id: int, session: Session = Depends(get_session)):
    job = _get(session, Job, job_id)
    session.exec(delete(Card).where(col(Card.job_id) == job_id))
    session.delete(job)
    session.commit()
    return Response(status_code=204)


@router.get("/cards", response_model=list[Card])
def list_cards(
    job_id: int | None = None,
    kind: CardKind | None = None,
    tag: str | None = None,
    session: Session = Depends(get_session),
):
    q = select(Card).order_by(Card.id)
    if job_id is not None:
        q = q.where(Card.job_id == job_id)
    if kind is not None:
        q = q.where(Card.kind == kind)
    cards = session.exec(q).all()
    if tag is not None:
        cards = [c for c in cards if tag in c.tags]
    return cards


@router.post("/cards", response_model=Card, status_code=201)
def create_card(body: CardCreate, session: Session = Depends(get_session)):
    _check_job(session, body.job_id)
    card = Card.model_validate(body)
    session.add(card)
    session.commit()
    session.refresh(card)
    return card


@router.patch("/cards/{card_id}", response_model=Card)
def update_card(card_id: int, body: CardUpdate, session: Session = Depends(get_session)):
    card = _get(session, Card, card_id)
    data = body.model_dump(exclude_unset=True)
    _check_job(session, data.get("job_id"))
    card.sqlmodel_update(data)
    session.add(card)
    session.commit()
    session.refresh(card)
    return card


@router.delete("/cards/{card_id}", status_code=204)
def delete_card(card_id: int, session: Session = Depends(get_session)):
    session.delete(_get(session, Card, card_id))
    session.commit()
    return Response(status_code=204)
