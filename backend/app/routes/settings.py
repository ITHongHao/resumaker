from fastapi import APIRouter, Depends
from sqlmodel import Session, SQLModel

from app.db import get_session
from app.keystore import KeyStore, get_keystore
from app.models import AppSettings, Provider

router = APIRouter(prefix="/api")


class SettingsIn(SQLModel):
    provider: Provider
    model: str
    api_key: str | None = None  # optional: omitted means keep the stored key


class SettingsOut(SQLModel):
    provider: Provider
    model: str
    has_key: bool


def _out(s: AppSettings, keys: KeyStore) -> SettingsOut:
    return SettingsOut(provider=s.provider, model=s.model, has_key=bool(keys.get(s.provider)))


@router.get("/settings", response_model=SettingsOut)
def get_settings(
    session: Session = Depends(get_session), keys: KeyStore = Depends(get_keystore)
):
    return _out(session.get(AppSettings, 1) or AppSettings(), keys)


@router.put("/settings", response_model=SettingsOut)
def put_settings(
    body: SettingsIn,
    session: Session = Depends(get_session),
    keys: KeyStore = Depends(get_keystore),
):
    if body.api_key:
        keys.set(body.provider, body.api_key)
    s = AppSettings(id=1, provider=body.provider, model=body.model)
    session.merge(s)
    session.commit()
    return _out(s, keys)
