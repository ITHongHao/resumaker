from typing import Literal

from pydantic import Field as PydanticField
from pydantic import field_validator
from sqlalchemy import JSON, Column, String
from sqlmodel import Field, SQLModel

CardKind = Literal[
    "project", "accomplishment", "education", "skill", "certificate", "behavioral"
]


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


class JobCreate(JobBase):
    pass


class JobUpdate(SQLModel):
    company: str | None = None
    title: str | None = None
    location: str | None = None
    employment_type: str | None = None
    start_date: str | None = None
    end_date: str | None = None
    manager_contact: str | None = None
    reason_for_leaving: str | None = None


class CardBase(SQLModel):
    job_id: int | None = Field(default=None, foreign_key="job.id", ondelete="CASCADE")
    kind: CardKind
    title: str
    description: str = ""
    details: str = ""


class Card(CardBase, table=True):
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


Provider = Literal["anthropic", "openai"]


class AppSettings(SQLModel, table=True):
    """Singleton row, always id=1. Holds no secrets; keys live in the KeyStore."""

    id: int = Field(default=1, primary_key=True)
    provider: Provider = Field(
        default="anthropic", sa_column=Column(String, nullable=False)
    )
    model: str = ""


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
