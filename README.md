# Resumaker

Local, single-user resume tailoring app (FastAPI + React/TypeScript). LaTeX only. See `docs/superpowers/specs/2026-10-27-resumaker-design.md`.

## Prerequisites

- Python 3.12+
- Node 20+ and npm
- Tectonic (LaTeX engine): `brew install tectonic`

## Setup

    make setup

## Run

    make dev      # backend on :8000, frontend on :5173 (proxies /api to :8000)
    make test     # backend pytest + frontend vitest

Open http://localhost:5173. Health check: http://localhost:5173/api/health
