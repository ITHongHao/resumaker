import hashlib
import json
import os
from collections.abc import Iterator
from functools import lru_cache
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import Engine, event
from sqlmodel import Session, create_engine, select

from app import recordfields
from app.datadir import private_dir, private_file
from app.models import Card, Job

BACKEND_DIR = Path(__file__).resolve().parent.parent


def db_path() -> Path:
    return Path(os.environ.get("RESUMAKER_DB") or Path.home() / ".resumaker" / "resumaker.db")


def db_url() -> str:
    return f"sqlite:///{db_path()}"


@lru_cache
def get_engine() -> Engine:
    private_dir(db_path().parent)
    engine = create_engine(db_url(), connect_args={"check_same_thread": False})

    @event.listens_for(engine, "connect")
    def _fk_on(dbapi_conn, _):  # SQLite ignores FKs unless enabled per connection
        dbapi_conn.execute("PRAGMA foreign_keys=ON")

    return engine


def init_db() -> None:
    """Apply Alembic migrations to the configured database."""
    # First run: ~/.resumaker may not exist. The file is created 0600 before SQLite opens it, so
    # the Record is never readable by other users, even briefly; SQLite's journal files copy
    # the database file's permissions.
    private_file(db_path())
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "migrations"))
    command.upgrade(cfg, "head")


def get_session() -> Iterator[Session]:
    with Session(get_engine()) as session:
        yield session


def _hashed_card(card: Card) -> dict:
    """A card for record_hash: without its stored-only fields (known keys the resume never
    prints), which cannot make a resume out of date."""
    stored_only = recordfields.extra_keys(card.kind) - set(recordfields.printed_keys(card.kind))
    out = card.model_dump()
    out["extra"] = {k: v for k, v in (card.extra or {}).items() if k not in stored_only}
    return out


def record_hash(session: Session) -> str:
    """Stable hash of every job and card, for staleness detection. Job extras (nothing on a
    resume prints them) and stored-only card fields are left out, which also keeps the hash of
    a Record that has none of them identical to the hash from before those fields existed."""
    jobs = [j.model_dump(exclude={"extra"}) for j in session.exec(select(Job).order_by(Job.id))]
    cards = [_hashed_card(c) for c in session.exec(select(Card).order_by(Card.id))]
    blob = json.dumps({"jobs": jobs, "cards": cards}, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(blob.encode()).hexdigest()
