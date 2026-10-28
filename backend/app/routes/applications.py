"""Applications and resume versions.

Only POST /api/applications calls the AI (Auto cater: one cater call, plus one suggestion
call when some bullet's card could cover a missing requirement). Every other endpoint here
is deterministic and makes no AI call. All AI work finishes before anything is written, so
a failure leaves no Application or ResumeVersion behind.
"""

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlmodel import Session, SQLModel, col, select

from app.ai.provider import LLM, AIError
from app.cater import (
    RecordTooSmallError,
    Suggestion,
    active_suggestions,
    auto_cater,
    build_resume,
    bullet_dicts,
    potential,
    requirements_of,
    suggest,
    uncovered,
    with_deltas,
)
from app.db import get_session, record_hash
from app.models import (
    Application,
    ApplicationStatus,
    Card,
    Job,
    Posting,
    Profile,
    Requirement,
    ResumeVersion,
)
from app.routes.ai import llm_dep
from app.routes.latex import MAX_TEX_CHARS
from app.routes.record import _patch_data
from app.scoring import RequirementMatch, score

router = APIRouter(prefix="/api/applications")


class CreateIn(BaseModel):
    posting_id: int


class TexIn(BaseModel):
    tex: str = Field(max_length=MAX_TEX_CHARS)


class StatusPatch(SQLModel):
    status: ApplicationStatus | None = None


class BulletOut(BaseModel):
    section: str
    job_id: int | None
    text: str
    source_card_id: int


class VersionOut(BaseModel):
    id: int
    version: int
    tex: str
    bullets: list[BulletOut]
    record_hash: str
    created_at: datetime


class PostingRef(BaseModel):
    id: int
    title: str
    company: str


class ApplicationOut(BaseModel):
    id: int
    posting_id: int
    status: ApplicationStatus
    created_at: datetime
    posting: PostingRef
    version: VersionOut
    score: int
    matches: list[RequirementMatch]
    potential: int
    suggestions: list[Suggestion]
    uncovered: list[Requirement]
    stale: bool


class ApplicationSummary(BaseModel):
    id: int
    posting_id: int
    status: ApplicationStatus
    created_at: datetime
    updated_at: datetime
    title: str
    company: str
    score: int
    version: int


class ScoreOut(BaseModel):
    score: int
    matches: list[RequirementMatch]
    potential: int


def _application(session: Session, app_id: int) -> Application:
    application = session.get(Application, app_id)
    if application is None:
        raise HTTPException(404, "Application not found")
    return application


def _latest(session: Session, app_id: int) -> ResumeVersion:
    version = session.exec(
        select(ResumeVersion)
        .where(ResumeVersion.application_id == app_id)
        .order_by(col(ResumeVersion.version).desc())
    ).first()
    if version is None:  # versions are created with the application, so this is a broken row
        raise HTTPException(404, "Application has no resume")
    return version


def _suggestions(version: ResumeVersion) -> list[Suggestion]:
    return [Suggestion.model_validate(s) for s in version.suggestions or []]


def _all(session: Session, model) -> list:
    return list(session.exec(select(model).order_by(model.id)))


def _detail(session: Session, application: Application) -> ApplicationOut:
    latest = _latest(session, application.id)
    posting = session.get(Posting, application.posting_id)
    reqs = requirements_of(posting)
    result = score(reqs, latest.tex)
    active = with_deltas(active_suggestions(_suggestions(latest), latest.tex), reqs, latest.tex)
    missing = [r for r, m in zip(reqs, result.matches) if m.status == "missing"]
    return ApplicationOut(
        id=application.id,
        posting_id=application.posting_id,
        status=application.status,
        created_at=application.created_at,
        posting=PostingRef(id=posting.id, title=posting.title, company=posting.company),
        version=VersionOut.model_validate(latest, from_attributes=True),
        score=result.score,
        matches=result.matches,
        potential=potential(reqs, latest.tex, active),
        suggestions=active,
        uncovered=uncovered(missing, _all(session, Card)),
        stale=latest.record_hash != record_hash(session),
    )


@router.post("", response_model=ApplicationOut, status_code=201)
def create_application(
    body: CreateIn, session: Session = Depends(get_session), llm: LLM = Depends(llm_dep)
):
    """Auto cater: build version 1 from the whole Record. The user pressed Auto cater."""
    posting = session.get(Posting, body.posting_id)
    if posting is None:
        raise HTTPException(404, "Posting not found")
    jobs, cards = _all(session, Job), _all(session, Card)
    profile = session.get(Profile, 1) or Profile()
    snapshot = record_hash(session)  # the Record this resume is generated from
    reqs = requirements_of(posting)
    try:
        bullets = auto_cater(llm, jobs, cards, posting)
        tex, ordered = build_resume(profile, jobs, cards, bullets, reqs)
        result = score(reqs, tex)
        missing = [r for r, m in zip(reqs, result.matches) if m.status != "matched"]
        suggestions = suggest(llm, cards, ordered, missing, reqs)
    except RecordTooSmallError as e:
        raise HTTPException(422, str(e)) from None
    except AIError as e:
        raise HTTPException(502, str(e)) from None
    # A rewrite that lowers the score (drops a term matched nowhere else) is not offered.
    suggestions = [s for s in with_deltas(suggestions, reqs, tex) if s.score_delta >= 0]

    try:
        application = Application(posting_id=posting.id)
        session.add(application)
        session.flush()
        session.add(ResumeVersion(
            application_id=application.id,
            version=1,
            tex=tex,
            bullets=bullet_dicts(ordered),
            suggestions=[s.model_dump(exclude={"old_tex", "new_tex"}) for s in suggestions],
            record_hash=snapshot,
        ))
        session.commit()
    except Exception:
        session.rollback()
        raise
    session.refresh(application)
    return _detail(session, application)


@router.get("", response_model=list[ApplicationSummary])
def list_applications(
    q: str | None = None,
    status: ApplicationStatus | None = None,
    session: Session = Depends(get_session),
):
    """Newest-edited first. `q` matches posting title or company, case-insensitively."""
    stmt = select(Application, Posting).join(Posting, col(Application.posting_id) == Posting.id)
    if status is not None:
        stmt = stmt.where(Application.status == status)
    pairs = list(session.exec(stmt))
    needle = (q or "").strip().casefold()
    if needle:
        pairs = [(a, p) for a, p in pairs
                 if needle in p.title.casefold() or needle in p.company.casefold()]
    latest: dict[int, ResumeVersion] = {}
    if pairs:
        versions = session.exec(
            select(ResumeVersion)
            .where(col(ResumeVersion.application_id).in_([a.id for a, _ in pairs]))
            .order_by(col(ResumeVersion.version))
        )
        for v in versions:
            latest[v.application_id] = v
    out = [
        ApplicationSummary(
            id=a.id,
            posting_id=p.id,
            status=a.status,
            created_at=a.created_at,
            updated_at=latest[a.id].created_at,
            title=p.title,
            company=p.company,
            score=score(requirements_of(p), latest[a.id].tex).score,
            version=latest[a.id].version,
        )
        for a, p in pairs
        if a.id in latest
    ]
    return sorted(out, key=lambda s: (s.updated_at, s.id), reverse=True)


@router.get("/{app_id}", response_model=ApplicationOut)
def get_application(app_id: int, session: Session = Depends(get_session)):
    """Latest version with live score, suggestions and staleness. Never regenerates."""
    return _detail(session, _application(session, app_id))


@router.patch("/{app_id}", response_model=Application)
def update_application(app_id: int, body: StatusPatch, session: Session = Depends(get_session)):
    application = _application(session, app_id)
    application.sqlmodel_update(_patch_data(body))
    session.add(application)
    session.commit()
    session.refresh(application)
    return application


@router.post("/{app_id}/versions", response_model=VersionOut, status_code=201)
def save_version(app_id: int, body: TexIn, session: Session = Depends(get_session)):
    """A hand-edited tex becomes version N+1. Bullets, suggestions and the Record hash are
    carried over: the edit does not regenerate from the Record, so staleness is unchanged."""
    _application(session, app_id)
    prev = _latest(session, app_id)
    version = ResumeVersion(
        application_id=app_id,
        version=prev.version + 1,
        tex=body.tex,
        bullets=list(prev.bullets),
        suggestions=list(prev.suggestions),
        record_hash=prev.record_hash,
    )
    session.add(version)
    session.commit()
    session.refresh(version)
    return VersionOut.model_validate(version, from_attributes=True)


@router.post("/{app_id}/score", response_model=ScoreOut)
def score_tex(app_id: int, body: TexIn, session: Session = Depends(get_session)):
    """Live score of an unsaved tex for the editor. Deterministic; no AI call."""
    application = _application(session, app_id)
    reqs = requirements_of(session.get(Posting, application.posting_id))
    result = score(reqs, body.tex)
    suggestions = _suggestions(_latest(session, app_id))
    return ScoreOut(score=result.score, matches=result.matches,
                    potential=potential(reqs, body.tex, suggestions))
