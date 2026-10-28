from datetime import datetime, timezone
from typing import Literal

from pydantic import Field as PydanticField
from pydantic import field_validator
from sqlalchemy import JSON, Column, String, UniqueConstraint
from sqlmodel import Field, SQLModel

from app import recordfields

CardKind = Literal[
    "project", "accomplishment", "education", "skill", "certificate", "behavioral"
]



def known_extra(kind: str | None, extra) -> dict[str, str]:
    """Only the registry's known `extra` keys for `kind`, cleaned (see recordfields.clean_extra).
    Unknown keys and non-string values are dropped."""
    if not isinstance(extra, dict):
        return {}
    known = recordfields.extra_keys(kind or "")
    cleaned = recordfields.clean_extra(kind or "", extra)
    return {k: v for k, v in cleaned.items() if k in known}


class JobBase(SQLModel):
    company: str
    title: str
    location: str = ""
    employment_type: str = ""
    start_date: str = ""
    end_date: str = ""
    manager_contact: str = ""
    reason_for_leaving: str = ""


class Job(JobBase, table=True):
    id: int | None = Field(default=None, primary_key=True)
    extra: dict = Field(default_factory=dict, sa_column=Column(JSON, nullable=False))


class JobCreate(JobBase):
    extra: dict = {}


class JobUpdate(SQLModel):
    company: str | None = None
    title: str | None = None
    location: str | None = None
    employment_type: str | None = None
    start_date: str | None = None
    end_date: str | None = None
    manager_contact: str | None = None
    reason_for_leaving: str | None = None
    extra: dict | None = None


class CardBase(SQLModel):
    job_id: int | None = Field(default=None, foreign_key="job.id", ondelete="CASCADE")
    kind: CardKind
    title: str
    description: str = ""
    details: str = ""


class Card(CardBase, table=True):
    # AUTOINCREMENT: a deleted card's id is never given to a new card, so an interview answer
    # citing it keeps showing "source removed" rather than an unrelated card.
    __table_args__ = {"sqlite_autoincrement": True}

    id: int | None = Field(default=None, primary_key=True)
    # SQLModel cannot infer a column type from a Literal, so declare it explicitly.
    kind: CardKind = Field(sa_column=Column(String, nullable=False, index=True))
    tags: list[str] = Field(default_factory=list, sa_column=Column(JSON, nullable=False))
    extra: dict = Field(default_factory=dict, sa_column=Column(JSON, nullable=False))


class CardCreate(CardBase):
    tags: list[str] = []
    extra: dict = {}


class CardUpdate(SQLModel):
    job_id: int | None = None
    kind: CardKind | None = None
    title: str | None = None
    description: str | None = None
    details: str | None = None
    tags: list[str] | None = None
    extra: dict | None = None


class ProfileBase(SQLModel):
    name: str = ""
    email: str = ""
    phone: str = ""
    links: list[str] = Field(default_factory=list, sa_column=Column(JSON, nullable=False))
    work_authorization: str = ""


class Profile(ProfileBase, table=True):
    """Singleton row, always id=1."""

    id: int = Field(default=1, primary_key=True)


Provider = Literal["anthropic", "openai", "custom"]


class AppSettings(SQLModel, table=True):
    """Singleton row, always id=1. Holds no secrets; keys live in the KeyStore."""

    id: int = Field(default=1, primary_key=True)
    provider: Provider = Field(
        default="anthropic", sa_column=Column(String, nullable=False)
    )
    model: str = ""
    # Only used by the "custom" provider (an OpenAI-compatible server, e.g. a local model).
    base_url: str = ""


class Requirement(SQLModel):
    @field_validator("term", mode="before")
    @classmethod
    def _strip_term(cls, v):
        return v.strip() if isinstance(v, str) else v

    term: str = PydanticField(min_length=1)
    kind: Literal["skill", "tool", "responsibility", "qualification"]
    weight: int = PydanticField(ge=1, le=3)


class PostingBase(SQLModel):
    source_kind: Literal["url", "text", "html", "image"]
    raw_text: str = ""
    title: str = ""
    company: str = ""


class Posting(PostingBase, table=True):
    id: int | None = Field(default=None, primary_key=True)
    source_kind: Literal["url", "text", "html", "image"] = Field(
        sa_column=Column(String, nullable=False)
    )
    # List of Requirement dicts.
    requirements: list[dict] = Field(default_factory=list, sa_column=Column(JSON, nullable=False))


ApplicationStatus = Literal["not_applied", "applied", "interview", "offer", "rejected"]


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Application(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    posting_id: int = Field(foreign_key="posting.id", index=True)
    status: ApplicationStatus = Field(
        default="not_applied", sa_column=Column(String, nullable=False, index=True)
    )
    created_at: datetime = Field(default_factory=_utcnow)


class ResumeVersion(SQLModel, table=True):
    """A snapshot of one resume. `bullets` are Bullet dicts in render order (bullet i is the
    i-th \\resumeItem line of the generated tex). `record_hash` is the Record's hash when the
    resume was generated; `suggestions` are Suggestion dicts proposed at generation time."""

    __table_args__ = (UniqueConstraint("application_id", "version"),)

    id: int | None = Field(default=None, primary_key=True)
    application_id: int = Field(foreign_key="application.id", ondelete="CASCADE", index=True)
    version: int
    tex: str
    bullets: list[dict] = Field(default_factory=list, sa_column=Column(JSON, nullable=False))
    suggestions: list[dict] = Field(default_factory=list, sa_column=Column(JSON, nullable=False))
    record_hash: str
    created_at: datetime = Field(default_factory=_utcnow)


class InterviewQuestion(SQLModel, table=True):
    """A user-written interview question (built-in ones live in app.interview, not here)."""

    id: int | None = Field(default=None, primary_key=True)
    text: str
    category: str = "Mine"


class InterviewAnswer(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    # "b:<key>" for a built-in question, "c:<id>" for a custom one.
    question_ref: str = Field(index=True)
    situation: str = ""
    task: str = ""
    action: str = ""
    result: str = ""
    source_card_ids: list[int] = Field(default_factory=list, sa_column=Column(JSON, nullable=False))
    job_id: int | None = Field(default=None, foreign_key="job.id", ondelete="SET NULL")
    created_at: str = ""


class HiddenQuestion(SQLModel, table=True):
    ref: str = Field(primary_key=True)
