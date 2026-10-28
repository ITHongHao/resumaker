import re
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, field_validator
from sqlmodel import Session, col, delete, func, select

from app import interview
from app.ai.provider import LLM, AIError
from app.db import get_session
from app.models import Card, HiddenQuestion, InterviewAnswer, InterviewQuestion, Job
from app.routes.ai import llm_dep

router = APIRouter(prefix="/api/interview")


_ID = re.compile(r"^[0-9]{1,9}$")  # ASCII digits only; also bounds the integer size


def _clean_text(v):
    if isinstance(v, str):
        v = v.strip()
        if not v:
            raise ValueError("text cannot be blank")
    return v


def _check_category(v):
    if v is not None and v not in interview.ALLOWED_CATEGORIES:
        raise ValueError("unknown category")
    return v


class QuestionIn(BaseModel):
    text: str
    category: str = "Mine"

    _t = field_validator("text")(classmethod(lambda cls, v: _clean_text(v)))
    _c = field_validator("category")(classmethod(lambda cls, v: _check_category(v)))


class QuestionPatch(BaseModel):
    text: str | None = None
    category: str | None = None

    _t = field_validator("text")(classmethod(lambda cls, v: _clean_text(v)))
    _c = field_validator("category")(classmethod(lambda cls, v: _check_category(v)))


class HiddenIn(BaseModel):
    hidden: bool


class AnswerIn(BaseModel):
    question_ref: str
    situation: str = ""
    task: str = ""
    action: str = ""
    result: str = ""
    source_card_ids: list[int] = []
    job_id: int | None = None


class DraftIn(BaseModel):
    question_ref: str


class AnswerPatch(BaseModel):
    situation: str | None = None
    task: str | None = None
    action: str | None = None
    result: str | None = None
    source_card_ids: list[int] | None = None
    job_id: int | None = None


def _ref_exists(session: Session, ref: str) -> bool:
    return _question_text(session, ref) is not None


def _question_text(session: Session, ref: str) -> str | None:
    if b := interview.builtin_for_ref(ref):
        return b.text
    if ref.startswith("c:") and _ID.match(ref[2:]):
        q = session.get(InterviewQuestion, int(ref[2:]))
        return q.text if q is not None else None
    return None


def _custom(session: Session, qid: str) -> InterviewQuestion:
    # The path segment is a string so a built-in ref ("b:...") is a 404, not a 422.
    q = session.get(InterviewQuestion, int(qid)) if _ID.match(qid) else None
    if q is None:
        raise HTTPException(404, f"Question {qid} not found")
    return q


def _clean_sources(session: Session, ids: list[int]) -> list[int]:
    seen: list[int] = []
    for i in ids:
        if i not in seen:
            seen.append(i)
    if not seen:
        return []
    found = set(session.exec(select(Card.id).where(col(Card.id).in_(seen))).all())
    return [i for i in seen if i in found]


def _check_job(session: Session, job_id: int | None) -> None:
    if job_id is not None and session.get(Job, job_id) is None:
        raise HTTPException(404, f"Job {job_id} not found")


def _counts(session: Session, ref: str | None = None) -> dict[str, int]:
    stmt = select(InterviewAnswer.question_ref, func.count()).group_by(InterviewAnswer.question_ref)
    if ref is not None:
        stmt = stmt.where(InterviewAnswer.question_ref == ref)
    return {r: n for r, n in session.exec(stmt).all()}


def _custom_json(q: InterviewQuestion, count: int) -> dict:
    return {"ref": f"c:{q.id}", "id": q.id, "text": q.text, "category": q.category,
            "builtin": False, "hidden": False, "answer_count": count}


def _titles(session: Session, answers: list[InterviewAnswer]) -> dict[int, str]:
    ids = {i for a in answers for i in (a.source_card_ids or [])}
    if not ids:
        return {}
    rows = session.exec(select(Card.id, Card.title).where(col(Card.id).in_(ids))).all()
    return dict(rows)


def _answer_json(session: Session, a: InterviewAnswer, titles: dict[int, str] | None = None) -> dict:
    ids = list(a.source_card_ids or [])
    if titles is None:
        titles = _titles(session, [a])
    sources = [{"id": i, "title": titles[i]} if i in titles else {"id": i, "removed": True}
               for i in ids]
    return {"id": a.id, "question_ref": a.question_ref, "situation": a.situation, "task": a.task,
            "action": a.action, "result": a.result, "source_card_ids": ids, "job_id": a.job_id,
            "created_at": a.created_at, "source_cards": sources}


@router.get("/questions")
def list_questions(include_hidden: bool = False, session: Session = Depends(get_session)):
    counts = _counts(session)
    hidden = {h.ref for h in session.exec(select(HiddenQuestion)).all()}
    rows = []
    for b in interview.BUILTIN:
        ref = f"b:{b.key}"
        if ref in hidden and not include_hidden:
            continue
        rows.append({"ref": ref, "text": b.text, "category": b.category, "builtin": True,
                     "hidden": ref in hidden, "answer_count": counts.get(ref, 0)})
    for q in session.exec(select(InterviewQuestion).order_by(InterviewQuestion.id)).all():
        rows.append(_custom_json(q, counts.get(f"c:{q.id}", 0)))
    return rows


@router.post("/questions", status_code=201)
def create_question(body: QuestionIn, session: Session = Depends(get_session)):
    q = InterviewQuestion(text=body.text, category=body.category)
    session.add(q)
    session.commit()
    session.refresh(q)
    return _custom_json(q, 0)


@router.patch("/questions/{question_id}")
def patch_question(question_id: str, body: QuestionPatch, session: Session = Depends(get_session)):
    q = _custom(session, question_id)
    data = body.model_dump(exclude_unset=True)
    if any(v is None for v in data.values()):
        raise HTTPException(422, "fields cannot be null")
    for k, v in data.items():
        setattr(q, k, v)
    session.add(q)
    session.commit()
    session.refresh(q)
    return _custom_json(q, _counts(session, f"c:{q.id}").get(f"c:{q.id}", 0))


@router.delete("/questions/{question_id}", status_code=204)
def delete_question(question_id: str, session: Session = Depends(get_session)):
    q = _custom(session, question_id)
    # question_ref is a plain string, not an FK, so the answers are removed explicitly.
    session.exec(delete(InterviewAnswer).where(col(InterviewAnswer.question_ref) == f"c:{q.id}"))
    session.exec(delete(HiddenQuestion).where(col(HiddenQuestion.ref) == f"c:{q.id}"))
    session.delete(q)
    session.commit()
    return Response(status_code=204)


@router.put("/questions/{ref}/hidden")
def set_hidden(ref: str, body: HiddenIn, session: Session = Depends(get_session)):
    if not _ref_exists(session, ref):
        raise HTTPException(404, f"Question {ref} not found")
    row = session.get(HiddenQuestion, ref)
    if body.hidden and row is None:
        session.add(HiddenQuestion(ref=ref))
    elif not body.hidden and row is not None:
        session.delete(row)
    session.commit()
    return {"ref": ref, "hidden": body.hidden}


@router.get("/answers")
def list_answers(question_ref: str | None = None, session: Session = Depends(get_session)):
    stmt = select(InterviewAnswer).order_by(InterviewAnswer.id)
    if question_ref is not None:
        stmt = stmt.where(InterviewAnswer.question_ref == question_ref)
    answers = session.exec(stmt).all()
    titles = _titles(session, answers)
    return [_answer_json(session, a, titles) for a in answers]


@router.post("/answers", status_code=201)
def create_answer(body: AnswerIn, session: Session = Depends(get_session)):
    if not _ref_exists(session, body.question_ref):
        raise HTTPException(404, f"Question {body.question_ref} not found")
    _check_job(session, body.job_id)
    a = InterviewAnswer(
        question_ref=body.question_ref, situation=body.situation, task=body.task,
        action=body.action, result=body.result, job_id=body.job_id,
        source_card_ids=_clean_sources(session, body.source_card_ids),
        created_at=datetime.now(timezone.utc).isoformat(),
    )
    session.add(a)
    session.commit()
    session.refresh(a)
    return _answer_json(session, a)


def _answer(session: Session, answer_id: int) -> InterviewAnswer:
    a = session.get(InterviewAnswer, answer_id)
    if a is None:
        raise HTTPException(404, f"Answer {answer_id} not found")
    return a


@router.patch("/answers/{answer_id}")
def patch_answer(answer_id: int, body: AnswerPatch, session: Session = Depends(get_session)):
    a = _answer(session, answer_id)
    data = body.model_dump(exclude_unset=True)
    bad = sorted(k for k, v in data.items() if v is None and k != "job_id")
    if bad:
        raise HTTPException(422, f"fields cannot be null: {', '.join(bad)}")
    if "job_id" in data:
        _check_job(session, data["job_id"])
    if "source_card_ids" in data:
        data["source_card_ids"] = _clean_sources(session, data["source_card_ids"])
    for k, v in data.items():
        setattr(a, k, v)
    session.add(a)
    session.commit()
    session.refresh(a)
    return _answer_json(session, a)


@router.delete("/answers/{answer_id}", status_code=204)
def delete_answer(answer_id: int, session: Session = Depends(get_session)):
    session.delete(_answer(session, answer_id))
    session.commit()
    return Response(status_code=204)


@router.post("/draft", response_model=interview.Draft)
def draft(body: DraftIn, session: Session = Depends(get_session), llm: LLM = Depends(llm_dep)):
    """Proposes a STAR answer drawn from the Record. Never writes; the client saves an accepted
    draft via POST /answers."""
    question = _question_text(session, body.question_ref)
    if question is None:
        raise HTTPException(404, f"Question {body.question_ref} not found")
    cards = list(session.exec(select(Card).order_by(Card.id)).all())
    jobs = list(session.exec(select(Job).order_by(Job.id)).all())
    try:
        return interview.draft_answer(llm, question, cards, jobs)
    except interview.DraftError as e:
        raise HTTPException(422, str(e)) from None
    except AIError as e:
        raise HTTPException(502, str(e)) from None
