import os
import sys
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.db import init_db
from app.hostguard import HostOriginGuard
from app.routes import ai, applications, latex, portability, postings, profile, record, settings


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    if os.environ.get("RESUMAKER_FAKE_LLM") == "1":
        # Startup only, on stderr; never in an API response.
        print("WARNING: RESUMAKER_FAKE_LLM=1 is set. Resumaker is using its built-in fake AI "
              "(canned, deterministic output) instead of a real provider. For tests and demos only.",
              file=sys.stderr, flush=True)
    yield


app = FastAPI(title="Resumaker", lifespan=lifespan)
# Outermost check: refuses foreign Host / cross-site Origin before any route runs.
app.add_middleware(HostOriginGuard)


@app.exception_handler(RequestValidationError)
async def validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
    # Drop `input`/`ctx`: they echo the request body, which may hold an API key.
    detail = [{k: e[k] for k in ("type", "loc", "msg") if k in e} for e in exc.errors()]
    return JSONResponse({"detail": detail}, status_code=422)


app.include_router(ai.router)
app.include_router(applications.router)
app.include_router(latex.router)
app.include_router(postings.router)
app.include_router(record.router)
app.include_router(profile.router)
app.include_router(settings.router)
app.include_router(portability.router)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
