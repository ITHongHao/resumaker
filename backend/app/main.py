from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.db import init_db
from app.routes import ai, latex, portability, postings, profile, record, settings


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    yield


app = FastAPI(title="Resumaker", lifespan=lifespan)


@app.exception_handler(RequestValidationError)
async def validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
    # Drop `input`/`ctx`: they echo the request body, which may hold an API key.
    detail = [{k: e[k] for k in ("type", "loc", "msg") if k in e} for e in exc.errors()]
    return JSONResponse({"detail": detail}, status_code=422)


app.include_router(ai.router)
app.include_router(latex.router)
app.include_router(postings.router)
app.include_router(record.router)
app.include_router(profile.router)
app.include_router(settings.router)
app.include_router(portability.router)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
