from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.db import init_db
from app.routes import portability, profile, record, settings


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    yield


app = FastAPI(title="Resumaker", lifespan=lifespan)
app.include_router(record.router)
app.include_router(profile.router)
app.include_router(settings.router)
app.include_router(portability.router)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
