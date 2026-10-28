from collections.abc import Iterator

import httpx
from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile
from fastapi.responses import JSONResponse
from sqlmodel import Session, select

from app.ai.provider import LLM, AIError
from app.db import get_session
from app.models import Posting
from app.postings.extract import extract_requirements
from app.postings.fetch import FetchError, fetch_url, html_to_text
from app.routes.ai import llm_dep

router = APIRouter(prefix="/api/postings")

MAX_IMAGE_BYTES = 8 * 1024 * 1024


def http_client_dep() -> Iterator[httpx.Client | None]:
    """None means fetch_url builds its own client; tests override this with a mock."""
    yield None


def _image_ok(data: bytes) -> bool:
    return (
        data.startswith(b"\x89PNG")
        or data.startswith(b"\xff\xd8\xff")
        or (data[:4] == b"RIFF" and data[8:12] == b"WEBP")
    )


def _fallback(message: str) -> JSONResponse:
    return JSONResponse({"detail": message, "fallback": "paste_text"}, status_code=422)


@router.post("", response_model=Posting)
def create_posting(
    url: str | None = Form(None),
    text: str | None = Form(None),
    html: str | None = Form(None),
    image: UploadFile | None = File(None),
    session: Session = Depends(get_session),
    llm: LLM = Depends(llm_dep),
    client: httpx.Client | None = Depends(http_client_dep),
):
    """multipart/form-data with EXACTLY ONE of: url, text, html, image (png/jpeg/webp).
    Fetch failures and postings with no extractable requirements return 422 with
    {"fallback": "paste_text", "detail": ...} and save nothing."""
    given = {
        k: v
        for k, v in {"url": url, "text": text, "html": html, "image": image}.items()
        if (v.filename if hasattr(v, "filename") else (v or "").strip())
    }
    if len(given) != 1:
        raise HTTPException(422, "Provide exactly one of: url, text, html, or image.")
    kind = next(iter(given))

    images: list[bytes] = []
    raw_text: str | None = None
    if kind == "image":
        data = image.file.read(MAX_IMAGE_BYTES + 1)  # type: ignore[union-attr]
        if len(data) > MAX_IMAGE_BYTES:
            raise HTTPException(422, "That image is too large (8 MB max).")
        if not _image_ok(data):
            raise HTTPException(422, "Images must be PNG, JPEG, or WebP.")
        images = [data]
    elif kind == "url":
        try:
            raw_text = fetch_url(url, client=client)  # type: ignore[arg-type]
        except FetchError as e:
            return _fallback(f"{e} Paste the posting text instead.")
    elif kind == "html":
        raw_text = html_to_text(html)  # type: ignore[arg-type]
        if not raw_text:
            return _fallback("No readable text found in that HTML. Paste the posting text instead.")
    else:
        raw_text = text.strip()  # type: ignore[union-attr]

    try:
        extracted = extract_requirements(llm, raw_text, images)
    except AIError as e:
        raise HTTPException(502, str(e)) from None
    if not extracted.requirements:
        return _fallback("No requirements could be found in that posting. Paste the posting text instead.")

    posting = Posting(
        source_kind=kind,  # type: ignore[arg-type]
        raw_text=raw_text or "",
        title=extracted.title,
        company=extracted.company,
        requirements=[r.model_dump() for r in extracted.requirements],
    )
    session.add(posting)
    session.commit()
    session.refresh(posting)
    return posting


@router.get("", response_model=list[Posting])
def list_postings(session: Session = Depends(get_session)):
    return session.exec(select(Posting).order_by(Posting.id.desc())).all()


@router.get("/{posting_id}", response_model=Posting)
def get_posting(posting_id: int, session: Session = Depends(get_session)):
    posting = session.get(Posting, posting_id)
    if posting is None:
        raise HTTPException(404, "Posting not found")
    return posting


@router.delete("/{posting_id}", status_code=204)
def delete_posting(posting_id: int, session: Session = Depends(get_session)):
    posting = session.get(Posting, posting_id)
    if posting is None:
        raise HTTPException(404, "Posting not found")
    session.delete(posting)
    session.commit()
    return Response(status_code=204)
