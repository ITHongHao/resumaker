from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, SQLModel

from app.ai.askai import ProposalReply, propose_cards
from app.ai.provider import LLM, AIError, NoKeyError, get_llm
from app.db import get_session
from app.keystore import KeyStore, get_keystore
from app.models import AppSettings, Job

router = APIRouter(prefix="/api/ai")


def llm_dep(
    session: Session = Depends(get_session), keys: KeyStore = Depends(get_keystore)
) -> LLM:
    try:
        return get_llm(session.get(AppSettings, 1) or AppSettings(), keys)
    except NoKeyError:
        raise HTTPException(
            400, "No API key saved for the selected AI provider. Add one in Settings."
        ) from None


class ProposeIn(SQLModel):
    job_id: int | None = None
    message: str
    history: list[dict] = []


@router.post("/propose", response_model=ProposalReply)
def propose(
    body: ProposeIn,
    session: Session = Depends(get_session),
    llm: LLM = Depends(llm_dep),
):
    """Proposes cards only. Never writes; the client accepts via POST /api/cards."""
    job = None
    if body.job_id is not None:
        job = session.get(Job, body.job_id)
        if job is None:
            raise HTTPException(404, "Job not found")
    try:
        return propose_cards(llm, body.message, job, body.history)
    except AIError as e:
        raise HTTPException(502, str(e)) from None
