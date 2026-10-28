from fastapi import APIRouter, Depends
from sqlmodel import Session

from app.db import get_session
from app.models import Profile, ProfileBase

router = APIRouter(prefix="/api")


@router.get("/profile", response_model=ProfileBase)
def get_profile(session: Session = Depends(get_session)):
    return session.get(Profile, 1) or ProfileBase()


@router.put("/profile", response_model=ProfileBase)
def put_profile(body: ProfileBase, session: Session = Depends(get_session)):
    # Full replace; null on any field is rejected by validation (422).
    profile = Profile(id=1, **body.model_dump())
    session.merge(profile)
    session.commit()
    return body
