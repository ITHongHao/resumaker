# Resumaker

Local, single-user resume tailoring app (FastAPI + React/TypeScript). LaTeX only. See `docs/superpowers/specs/2026-10-27-resumaker-design.md`.

## How it works

You keep a **Record**: your jobs, projects, accomplishments, education, skills and certificates, written once and edited by hand. When you paste a job posting under **New application**, Resumaker reads out its requirements, and **Auto cater** drafts a one-page LaTeX resume from your Record cards that speaks to those requirements. You land in the **Editor**: the `.tex` source beside a live PDF preview, a match score with per-requirement chips, and inline suggested rewrites you accept or reject one by one. Save keeps a numbered version; each tailored resume appears as a tile in the **Resumes** gallery. A resume is a snapshot: if you change the Record afterwards, it is flagged "Record changed since this was made" but never rewritten for you.

### Provenance and AI opt-in

- The AI is opt-in. Nothing calls it until you press a button that says so: Read posting (to extract requirements from a posting), Auto cater, or Send in an Ask AI drawer. Typing in the editor, scoring and the live preview never call the AI. The match score is computed by plain code, not by a model.
- The AI only proposes. Ask AI shows suggested cards, and nothing is saved until you click Add. Suggested rewrites in the editor change nothing until you click Accept.
- Every generated bullet must trace back to a Record card. The code checks this after the model answers, and drops anything that does not pass: a bullet must cite a real card, may only use numbers that are in that card, and may only mention a requirement (a tool, skill, and so on) that the card itself supports. Requirements nothing in your Record supports are listed as "Not in your record yet" instead of being claimed.
- Your data and your API key stay on your machine (see below). The only thing that leaves it is the text of the request you trigger, sent to the AI provider you chose.

## Getting started

### Prerequisites

- Python 3.12+
- Node 20+ and npm
- Tectonic (LaTeX engine, needed for the PDF preview and export): `brew install tectonic`. Without it the app still runs, and the editor shows how to install it where the preview would be.

### Install

    make setup    # backend virtualenv + dependencies, frontend and e2e npm packages

### Run

    make dev      # backend on :8000, frontend on :5173 (proxies /api to :8000)

Open http://localhost:5173. Health check: http://localhost:5173/api/health

### Where your data lives

Everything is stored under `~/.resumaker/`: the SQLite database (`resumaker.db`) and your API keys (`keys.json`, readable only by you). Override the locations with environment variables:

    RESUMAKER_HOME=/path/to/dir   # keys.json lives here
    RESUMAKER_DB=/path/to/file.db # the database file (default: ~/.resumaker/resumaker.db)

Set them in the same shell that starts the backend, for example `RESUMAKER_HOME=/tmp/rm RESUMAKER_DB=/tmp/rm/r.db make dev`. The Record and Profile can be backed up and restored as JSON from the Profile page.

### Which requests the backend answers

The API has no login, so the backend refuses (HTTP 403) anything a web page on another site could send it: a request whose `Host` is not `localhost`, `127.0.0.1` or `[::1]` (any port; this blocks DNS rebinding), and any non-GET request whose `Origin` is another site, or that has no `Origin` but is marked `Sec-Fetch-Site: cross-site`. Requests with no `Origin` at all (curl, scripts) are allowed. No CORS headers are sent. If you reach the app under another local host name, add it (host names only, comma-separated; they are added to the loopback names, never replace them):

    RESUMAKER_ALLOWED_HOSTS=resumaker.local make dev

### Add an API key

Open Settings, choose a provider (Anthropic or OpenAI), optionally set a model name, and paste your key. The key is saved only in `keys.json` on this machine, is never sent back to the browser, and is used only for the requests you trigger.

### Tests

    make test     # backend pytest + frontend vitest
    make e2e      # Playwright browser test of the whole flow

The end-to-end test starts its own backend (port 8100) and frontend (port 5273) on a fresh temporary database and `RESUMAKER_HOME`, deleted afterwards, so it never touches your data and can run beside `make dev`. It needs a Chromium for Playwright; on a new machine run `cd e2e && npx playwright install chromium` once. The PDF download step is skipped when `tectonic` is not on your PATH.

`RESUMAKER_FAKE_LLM=1` makes the backend use a built-in deterministic fake instead of a real AI provider. It is for tests and demos only: it is read from the process environment alone (no request, setting or header can turn it on), it needs no API key, and its output is canned. Do not set it when you want real tailoring.

## Known limitations

- Tectonic must be installed locally; PDF preview and export do not work without it.
- LaTeX only (Jake's template); no Word/docx output.
- Localhost and single user only: no accounts, no hosting or deployment, and no authentication on the API, so do not expose the port to a network.
- Tailored resumes (applications and their versions) are not part of the JSON export; only the Record and Profile are. Back up `resumaker.db` to keep them.

## Third-party: resume template

The LaTeX preamble and macros in `backend/app/latex/template.py` are vendored from
"Jake's Resume" (https://github.com/jakegut/resume, by Jake Gutierrez, based on
https://github.com/sb2nov/resume), licensed MIT. The only change is that
`glyphtounicode` is guarded with `\ifdefined\pdfgentounicode` so it is skipped under
Tectonic's XeTeX engine.
