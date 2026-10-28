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

from app.models import Card, Job

BACKEND_DIR = Path(__file__).resolve().parent.parent


def db_path() -> Path:
    return Path(os.environ.get("RESUMAKER_DB") or Path.home() / ".resumaker" / "resumaker.db")


def db_url() -> str:
    return f"sqlite:///{db_path()}"


@lru_cache
def get_engine() -> Engine:
    db_path().parent.mkdir(parents=True, exist_ok=True)
    engine = create_engine(db_url(), connect_args={"check_same_thread": False})

    @event.listens_for(engine, "connect")
    def _fk_on(dbapi_conn, _):  # SQLite ignores FKs unless enabled per connection
        dbapi_conn.execute("PRAGMA foreign_keys=ON")

    return engine


def init_db() -> None:
    """Apply Alembic migrations to the configured database."""
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "migrations"))
    command.upgrade(cfg, "head")


def get_session() -> Iterator[Session]:
    with Session(get_engine()) as session:
        yield session


def record_hash(session: Session) -> str:
    """Stable hash of every job and card, for staleness detection."""
    jobs = [j.model_dump() for j in session.exec(select(Job).order_by(Job.id))]
    cards = [c.model_dump() for c in session.exec(select(Card).order_by(Card.id))]
    blob = json.dumps({"jobs": jobs, "cards": cards}, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(blob.encode()).hexdigest()
