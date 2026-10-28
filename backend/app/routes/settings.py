from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, SQLModel

from app.db import get_session
from app.keystore import KeyStore, get_keystore
from app.models import AppSettings, Provider

router = APIRouter(prefix="/api")


class SettingsIn(SQLModel):
    provider: Provider
    model: str
    base_url: str = ""
    api_key: str | None = None  # optional: omitted means keep the stored key


class SettingsOut(SQLModel):
    provider: Provider
    model: str
    base_url: str
    has_key: bool


def _out(s: AppSettings, keys: KeyStore) -> SettingsOut:
    return SettingsOut(
        provider=s.provider, model=s.model, base_url=s.base_url, has_key=bool(keys.get(s.provider)))


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
    base_url = body.base_url.strip().rstrip("/")
    if base_url:
        parts = urlsplit(base_url)
        if parts.scheme not in ("http", "https") or not parts.hostname:
            raise HTTPException(422, "Base URL must start with http:// or https://")
    elif body.provider == "custom":
        raise HTTPException(422, "Custom provider needs a base URL, such as http://localhost:11434/v1")
    if body.provider == "custom" and not body.model.strip():
        raise HTTPException(422, "Custom provider needs a model name")
    if body.api_key:
        keys.set(body.provider, body.api_key)
    s = AppSettings(id=1, provider=body.provider, model=body.model, base_url=base_url)
    session.merge(s)
    session.commit()
    return _out(s, keys)
