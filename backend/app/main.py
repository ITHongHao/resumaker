from fastapi import FastAPI

app = FastAPI(title="Resumaker")


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
