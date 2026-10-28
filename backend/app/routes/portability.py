from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, SQLModel, delete, select

from app.db import get_session
from app import interview
from app.models import (
    Card, CardBase, HiddenQuestion, InterviewAnswer, InterviewQuestion, Job, JobBase, Profile,
    ProfileBase,
)

router = APIRouter(prefix="/api")

SCHEMA_VERSION = 2
SUPPORTED_VERSIONS = {1, 2}


class JobDoc(JobBase):
    id: int
    extra: dict = {}


class CardDoc(CardBase):
    id: int
    tags: list[str] = []
    extra: dict = {}


class InterviewQuestionDoc(SQLModel):
    id: int
    text: str
    category: str = "Mine"


class InterviewAnswerDoc(SQLModel):
    id: int | None = None
    question_ref: str
    situation: str = ""
    task: str = ""
    action: str = ""
    result: str = ""
    source_card_ids: list[int] = []
    job_id: int | None = None
    created_at: str = ""


class ExportDoc(SQLModel):
    schema_version: int
    jobs: list[JobDoc]
    cards: list[CardDoc]
    profile: ProfileBase
    interview_questions: list[InterviewQuestionDoc] = []
    interview_answers: list[InterviewAnswerDoc] = []
    hidden_questions: list[str] = []


@router.get("/export", response_model=ExportDoc)
def export_all(session: Session = Depends(get_session)):
    profile = session.get(Profile, 1)
    return ExportDoc(
        schema_version=SCHEMA_VERSION,
        jobs=[JobDoc(**j.model_dump()) for j in session.exec(select(Job).order_by(Job.id))],
        cards=[CardDoc(**c.model_dump()) for c in session.exec(select(Card).order_by(Card.id))],
        profile=ProfileBase(**profile.model_dump(exclude={"id"})) if profile else ProfileBase(),
        interview_questions=[
            InterviewQuestionDoc(**q.model_dump())
            for q in session.exec(select(InterviewQuestion).order_by(InterviewQuestion.id))
        ],
        interview_answers=[
            InterviewAnswerDoc(**a.model_dump())
            for a in session.exec(select(InterviewAnswer).order_by(InterviewAnswer.id))
        ],
        hidden_questions=sorted(h.ref for h in session.exec(select(HiddenQuestion))),
    )


def _resolve_ref(ref: str, qmap: dict[int, int]) -> str | None:
    """Map an imported question ref to a ref valid in this database, or None to drop it."""
    if ref.startswith("b:"):
        return ref if interview.builtin_for_ref(ref) is not None else None
    if ref.startswith("c:") and ref[2:].isascii() and ref[2:].isdigit():
        new = qmap.get(int(ref[2:]))
        return f"c:{new}" if new is not None else None
    return None


@router.post("/import")
def import_all(doc: ExportDoc, session: Session = Depends(get_session)):
    if doc.schema_version not in SUPPORTED_VERSIONS:
        raise HTTPException(422, f"unsupported schema_version {doc.schema_version}")
    job_ids = {j.id for j in doc.jobs}
    if (
        len(job_ids) != len(doc.jobs)
        or len({c.id for c in doc.cards}) != len(doc.cards)
        or len({q.id for q in doc.interview_questions}) != len(doc.interview_questions)
    ):
        raise HTTPException(422, "duplicate ids in import")
    missing = sorted({c.job_id for c in doc.cards if c.job_id is not None} - job_ids)
    if missing:
        raise HTTPException(422, f"cards reference unknown job ids: {missing}")
    card_ids = {c.id for c in doc.cards}
    try:
        session.exec(delete(HiddenQuestion))
        session.exec(delete(InterviewAnswer))
        session.exec(delete(InterviewQuestion))
        session.exec(delete(Card))
        session.exec(delete(Job))
        session.exec(delete(Profile))
        session.add_all(Job(**j.model_dump()) for j in doc.jobs)
        session.flush()  # jobs before the cards that reference them
        session.add_all(Card(**c.model_dump()) for c in doc.cards)
        session.add(Profile(id=1, **doc.profile.model_dump()))
        # Custom questions get fresh ids; refs in answers and hidden are rewritten to match.
        qmap: dict[int, int] = {}
        for qd in doc.interview_questions:
            row = InterviewQuestion(text=qd.text, category=qd.category)
            session.add(row)
            session.flush()
            qmap[qd.id] = row.id
        n_answers = 0
        for ad in doc.interview_answers:
            ref = _resolve_ref(ad.question_ref, qmap)
            if ref is None:
                continue
            session.add(InterviewAnswer(
                question_ref=ref, situation=ad.situation, task=ad.task, action=ad.action,
                result=ad.result, created_at=ad.created_at,
                source_card_ids=[i for i in ad.source_card_ids if i in card_ids],
                job_id=ad.job_id if ad.job_id in job_ids else None,
            ))
            n_answers += 1
        if doc.schema_version == 1:
            # A v1 document predates the Interview tab: its behavioral cards become questions
            # and answers, as the upgrade migration does for a database. A v2 document carries
            # its own Interview data, so nothing is converted there.
            now = datetime.now(timezone.utc).isoformat()
            for cd in sorted(doc.cards, key=lambda c: c.id):
                if cd.kind != "behavioral":
                    continue
                question, answer = interview.behavioral_to_interview(Card(**cd.model_dump()), now)
                session.add(question)
                session.flush()
                answer.question_ref = f"c:{question.id}"
                session.add(answer)
                n_answers += 1
        hidden = {r for r in (_resolve_ref(h, qmap) for h in doc.hidden_questions) if r}
        session.add_all(HiddenQuestion(ref=r) for r in sorted(hidden))
        session.commit()
    except Exception:
        session.rollback()
        raise
    return {"jobs": len(doc.jobs), "cards": len(doc.cards), "interview_answers": n_answers}
