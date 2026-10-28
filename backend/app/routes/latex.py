from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field

from app.latex.compile import CompileError, CompilerBusy, compile_pdf

router = APIRouter(prefix="/api")

MAX_TEX_CHARS = 200_000


class CompileBody(BaseModel):
    tex: str = Field(max_length=MAX_TEX_CHARS)


@router.post("/latex/compile")
def compile_latex(body: CompileBody):
    # Sync def: the compiler blocks, so FastAPI runs this in its threadpool.
    try:
        pdf = compile_pdf(body.tex)
    except CompilerBusy:
        raise HTTPException(
            503, "The PDF compiler is busy with other previews. Try again in a moment.") from None
    except CompileError as e:
        raise HTTPException(
            422, {"message": "LaTeX compilation failed", "log": e.log}) from None
    return Response(pdf, media_type="application/pdf")
