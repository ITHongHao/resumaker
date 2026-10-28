# Resumaker MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A local, single-user app that keeps a full record of a person's work history, then turns a job posting into a tailored LaTeX resume with an ATS match score and accept/reject suggestions.

**Architecture:** A FastAPI backend with SQLite holds the Record, Profile, Settings, postings, and resume versions. A provider-agnostic AI layer is called only on explicit user actions. A React + TypeScript (Vite) frontend serves the gallery, Record, and editor. The backend renders Jake's resume template to `.tex` and compiles it to PDF with Tectonic.

**Tech Stack:** Python 3.12, FastAPI, SQLModel, Alembic, pytest, httpx; React, TypeScript, Vite, Tailwind, shadcn/ui, CodeMirror 6, Vitest; Tectonic.

**Spec:** `docs/superpowers/specs/2026-10-27-resumaker-design.md`

## Global Constraints

- MVP runs on localhost, single-user, in local development. Nothing is deployed. No accounts.
- Source format is LaTeX only, using Jake's resume template (single column, standard section headings, plain-text keywords).
- The AI is opt-in and proposes only. It never writes to the Record or a resume without an explicit user accept.
- The AI may be called only when the user submits a posting, opens Ask AI, presses Auto cater, or asks about a gap. Editing a resume never triggers an AI call.
- The match score is deterministic. The AI extracts requirements once and does not judge the score.
- Every generated bullet stores the id of the Record card it came from. The AI must not invent or inflate experience.
- The API key and user data stay on the user's machine, and the key goes only to the provider the user chose.
- AI providers: Anthropic and OpenAI behind one interface. The model must accept images.
- Storage and key handling sit behind interfaces so a web version stays possible. SQLite for the MVP; Alembic migrations from the start.
- The Record can be exported and imported as JSON.
- A resume is a snapshot. If the Record changes later, it is flagged as possibly out of date and never updates silently.
- LaTeX engine (Tectonic) is a documented local prerequisite. macOS is the first target.
- URL fetching is best effort. Failures fall back to pasting text.
- Suggestions must render inline on the document as tracked changes, not as a bullet-point sidebar.

## Review Focus

Failure modes the spec implies but no feature task would otherwise exercise, most likely first. Each has a test in the task that owns the code.

1. User text containing LaTeX special characters (`& % $ # _ { } ~ ^ \`) must render and compile, not break the PDF. (Task 8)
2. Auto cater on an empty or tiny Record must say so plainly instead of producing an empty or invented resume. (Task 9)
3. The AI returning malformed JSON, an invalid key, or a provider error must show a readable error and change nothing. (Task 4)
4. A posting with no extractable requirements, or a URL that cannot be fetched, must offer the paste-text fallback. (Task 6)
5. A hand-edited `.tex` that no longer compiles must show the compiler error and keep the last good PDF. (Task 8)

---

## File Structure

```
backend/
  pyproject.toml
  alembic.ini, migrations/
  app/
    main.py              FastAPI app, routers, static frontend
    db.py                engine, session dependency
    models.py            SQLModel tables and shared enums
    keystore.py          KeyStore protocol + FileKeyStore
    ai/provider.py       LLM protocol, AnthropicLLM, OpenAILLM, get_llm
    ai/askai.py          propose_cards()
    postings/fetch.py    fetch_url()
    postings/extract.py  extract_requirements()
    scoring.py           score()
    cater.py             auto_cater(), suggest()
    latex/escape.py      escape_latex()
    latex/template.py    render_tex()
    latex/compile.py     compile_pdf()
    routes/              record.py profile.py settings.py ai.py
                         postings.py applications.py portability.py
  tests/
frontend/
  src/api.ts             typed client
  src/pages/             Gallery, NewApplication, Record, Profile, Settings, Editor
  src/components/        AskAIDrawer, CriteriaChips, ScoreMeter, SourceEditor, PdfPreview
```

---

### Task 1: Project scaffold

**Files:**
- Create: `.gitignore` (ignore `.superpowers/`, `node_modules`, `.venv`, `*.db`), `backend/pyproject.toml`, `backend/app/main.py`, `backend/tests/test_health.py`, `frontend/` (Vite React TS, Tailwind, shadcn/ui, Vitest), `README.md` (setup, Tectonic prerequisite, run commands)

**Interfaces:**
- Produces: `app = FastAPI()` in `backend/app/main.py` with `GET /api/health -> {"status": "ok"}`; `make dev` (or documented commands) runs backend on 8000 and frontend on 5173 with `/api` proxied.

- [ ] **Step 1:** Run `git init` in the project root and add `.gitignore`.
- [ ] **Step 2: Write failing test** `test_health_ok` in `backend/tests/test_health.py`: `TestClient(app).get("/api/health").json() == {"status": "ok"}`.
- [ ] **Step 3:** Run `cd backend && pytest tests/test_health.py -v`. Expected: FAIL (no app).
- [ ] **Step 4:** Create the backend package and `app/main.py` with the health route; scaffold the frontend with Vite, Tailwind, shadcn/ui, Vitest; add a frontend smoke test that renders `<App />`.
- [ ] **Step 5:** Run `pytest` and `npm test`. Expected: PASS.
- [ ] **Step 6:** Commit `chore: scaffold backend and frontend`.

### Task 2: Database and Record API

**Files:**
- Create: `backend/app/db.py`, `backend/app/models.py`, `backend/app/routes/record.py`, `backend/migrations/` (Alembic), `backend/tests/test_record.py`

**Interfaces:**
- Produces (`models.py`):
  - `Job(id, company, title, location, employment_type, start_date, end_date, manager_contact, reason_for_leaving)`
  - `Card(id, job_id: int | None, kind: CardKind, title, description, details, tags: list[str], extra: dict)`
  - `CardKind = Literal["project","accomplishment","education","skill","certificate","behavioral"]` (my call: one card table covers every non-job section; education/certificate dates and org go in `extra`)
- Produces (API): `GET/POST /api/jobs`, `GET/PATCH/DELETE /api/jobs/{id}`, `GET/POST /api/cards` (filter `?job_id=&kind=&tag=`), `PATCH/DELETE /api/cards/{id}`, `get_session()` dependency, `record_hash(session) -> str` in `db.py` (stable hash of all jobs and cards, used for staleness).

- [ ] **Step 1: Write failing tests** in `test_record.py` using a temp SQLite file: `test_create_job_then_list`, `test_card_belongs_to_job_and_filters_by_tag`, `test_delete_job_cascades_cards`, `test_education_card_has_no_job`, `test_record_hash_changes_when_card_edited`.
- [ ] **Step 2:** Run `pytest tests/test_record.py -v`. Expected: FAIL.
- [ ] **Step 3:** Implement models, Alembic initial migration, session dependency, routes, and `record_hash`.
- [ ] **Step 4:** Run the tests. Expected: PASS. Also run `alembic upgrade head` on a fresh DB.
- [ ] **Step 5:** Commit `feat: record data model and CRUD`.

### Task 3: Profile, Settings, key store, JSON export/import

**Files:**
- Create: `backend/app/keystore.py`, `backend/app/routes/profile.py`, `backend/app/routes/settings.py`, `backend/app/routes/portability.py`, `backend/tests/test_profile_settings.py`, `backend/tests/test_portability.py`
- Modify: `backend/app/models.py` (add `Profile`, `AppSettings`)

**Interfaces:**
- Produces: `Profile(id=1, name, email, phone, links: list[str], work_authorization)`; `AppSettings(id=1, provider: Literal["anthropic","openai"], model: str)`; `KeyStore` protocol with `get(provider) -> str | None`, `set(provider, key) -> None`; `FileKeyStore(path)` writing a `0600` file under `~/.resumaker/`.
- API: `GET/PUT /api/profile`; `GET/PUT /api/settings` (the key is write-only: responses return `has_key: bool`, never the key); `GET /api/export` returns all Record and Profile data as JSON; `POST /api/import` replaces them from that JSON.

- [ ] **Step 1: Write failing tests:** `test_settings_never_returns_key`, `test_filekeystore_file_mode_is_0600`, `test_profile_roundtrip`, `test_export_then_import_restores_record`, `test_import_rejects_unknown_schema_version`.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement. Export JSON carries a `schema_version` field.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit `feat: profile, settings, key store, json portability`.

### Task 4: AI provider layer and Ask AI proposals

**Files:**
- Create: `backend/app/ai/provider.py`, `backend/app/ai/askai.py`, `backend/app/routes/ai.py`, `backend/tests/test_provider.py`, `backend/tests/test_askai.py`

**Interfaces:**
- Consumes: `KeyStore`, `AppSettings` (Task 3), `Card` (Task 2).
- Produces:
  - `class LLM(Protocol): def complete(self, system: str, user: str, images: list[bytes] = [], json_schema: dict | None = None) -> str`
  - `AnthropicLLM(api_key, model)`, `OpenAILLM(api_key, model)`, `get_llm(settings, keystore) -> LLM` raising `NoKeyError` if no key is saved
  - `class AIError(Exception)` wrapping provider failures and malformed JSON
  - `CardDraft(kind, title, description, tags, extra)`; `propose_cards(llm, message, job: Job | None, history: list[dict]) -> ProposalReply(reply: str, proposals: list[CardDraft], followups: list[str])`
  - `POST /api/ai/propose {job_id, message, history}`. It never writes cards; the client accepts via `POST /api/cards`.
- Check the current SDK docs for both providers before implementing (use the `ctx7` CLI).

- [ ] **Step 1: Write failing tests** with a `FakeLLM`: `test_propose_returns_drafts_and_followups`, `test_propose_does_not_create_cards`, `test_followup_asks_for_missing_numbers`, `test_malformed_json_raises_aierror`, `test_no_key_returns_400_with_message`, `test_provider_error_returns_502_and_changes_nothing`.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement. The prompt tells the model to propose only what the user said and to ask about missing results or numbers rather than inventing them.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit `feat: ai provider layer and ask-ai proposals`.

### Task 5: Frontend shell, Profile, Settings, Record, Ask AI drawer

**Files:**
- Create: `frontend/src/api.ts`, `frontend/src/pages/{Record,Profile,Settings}.tsx`, `frontend/src/components/AskAIDrawer.tsx`, tests beside each

**Interfaces:**
- Consumes: Task 2-4 endpoints.
- Produces: top nav `Resumes | Record | Profile` plus Settings; Record page with job pages, project/accomplishment cards, tag chips, "Add project or accomplishment" (manual first), sections for education, skills, certificates; `AskAIDrawer({jobId})` showing the proposed card with Add and Edit buttons.

- [ ] **Step 1: Write failing tests (Vitest + Testing Library):** `adds a card manually`, `Ask AI drawer is closed until the button is pressed`, `a proposal is not saved until Add is clicked`, `Edit opens the card form prefilled`, `settings never displays the saved key`.
- [ ] **Step 2:** Run `npm test`. Expected: FAIL.
- [ ] **Step 3:** Build the pages and drawer to match the approved mockups (`.superpowers/brainstorm/*/content/form-with-ai-drawer-v3.html`, `home-gallery-v1.html`).
- [ ] **Step 4:** Run `npm test`. Expected: PASS. Manually walk the Record in the browser.
- [ ] **Step 5:** Commit `feat: record, profile, settings ui and ask-ai drawer`.

### Task 6: Posting intake and requirement extraction

**Files:**
- Create: `backend/app/postings/fetch.py`, `backend/app/postings/extract.py`, `backend/app/routes/postings.py`, `backend/tests/test_postings.py`
- Modify: `backend/app/models.py` (add `Posting`)

**Interfaces:**
- Consumes: `LLM`, `AIError` (Task 4).
- Produces:
  - `Requirement(term: str, kind: Literal["skill","tool","responsibility","qualification"], weight: int)` where weight is 1-3
  - `Posting(id, source_kind: Literal["url","text","html","image"], raw_text, title, company, requirements: list[Requirement])`
  - `fetch_url(url: str) -> str` raising `FetchError`; strips HTML to text
  - `extract_requirements(llm, text: str | None, images: list[bytes]) -> ExtractedPosting(title, company, requirements)`
  - `POST /api/postings` accepts exactly one of `url`, `text`, `html`, or an uploaded image. On `FetchError` returns 422 `{"fallback": "paste_text"}`.

- [ ] **Step 1: Write failing tests:** `test_text_posting_extracts_requirements`, `test_html_is_stripped_before_extraction`, `test_url_fetch_failure_returns_paste_text_fallback`, `test_image_is_passed_to_llm`, `test_no_requirements_found_returns_fallback_not_empty_posting`, `test_two_inputs_rejected`.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement. Use `httpx` with a timeout and a browser-like user agent. Do not follow redirects to non-http schemes.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit `feat: posting intake and requirement extraction`.

### Task 7: Deterministic match score

**Files:**
- Create: `backend/app/scoring.py`, `backend/tests/test_scoring.py`

**Interfaces:**
- Consumes: `Requirement` (Task 6).
- Produces: `RequirementMatch(term, status: Literal["matched","partial","missing"])`; `ScoreResult(score: int, matches: list[RequirementMatch])`; `score(requirements: list[Requirement], resume_text: str) -> ScoreResult` (score 0-100, weighted by `weight`); `potential_score(requirements, resume_text, replacements: list[tuple[str, str]]) -> int`, the score if each `(old, new)` text replacement were applied.
- Matching rules (my call): case-insensitive whole-word match is `matched`; a stem or alias hit (for example "PyTorch" vs "torch") is `partial`; otherwise `missing`.

- [ ] **Step 1: Write failing tests:** `test_all_matched_scores_100`, `test_none_matched_scores_0`, `test_weight_changes_score`, `test_case_insensitive_whole_word` ("Java" must not match "JavaScript"), `test_empty_requirements_scores_0_without_error`, `test_potential_score_applies_replacements`, `test_score_is_deterministic`.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit `feat: deterministic match score`.

### Task 8: LaTeX rendering and PDF compile

**Files:**
- Create: `backend/app/latex/escape.py`, `backend/app/latex/template.py`, `backend/app/latex/compile.py`, `backend/tests/test_latex.py`

**Interfaces:**
- Consumes: `Profile`, `Job`, `Card` (Tasks 2-3).
- Produces:
  - `escape_latex(s: str) -> str`
  - `Bullet(section: str, job_id: int | None, text: str, source_card_id: int)`
  - `render_tex(profile: Profile, jobs: list[Job], bullets: list[Bullet], cards_by_section: dict) -> str` producing Jake's resume template with sections Education, Experience, Projects, Technical Skills (each bullet on its own `\resumeItem{}` line so suggestions map to lines)
  - `compile_pdf(tex: str) -> bytes`, raising `CompileError(log: str)`; calls the `tectonic` binary in a temp dir with a timeout
  - `POST /api/latex/compile {tex}` returns the PDF, or 422 with the compiler log

- [ ] **Step 1: Write failing tests:** `test_escape_all_specials` (`& % $ # _ { } ~ ^ \` each escaped), `test_render_escapes_user_text` (a bullet containing `R&D at 50% # of $ _x_` appears escaped), `test_each_bullet_on_own_line`, `test_compile_valid_tex_returns_pdf_bytes` (starts with `%PDF`, skipped with a clear message if `tectonic` is missing), `test_compile_broken_tex_raises_with_log`, `test_compile_route_422_on_error`.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement. Vendor Jake's template as a string constant in `template.py`; check its licence and note it in the README.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit `feat: latex rendering and pdf compile`.

### Task 9: Auto cater, suggestions, applications and resume versions

**Files:**
- Create: `backend/app/cater.py`, `backend/app/routes/applications.py`, `backend/tests/test_cater.py`
- Modify: `backend/app/models.py` (add `Application`, `ResumeVersion`)

**Interfaces:**
- Consumes: `LLM`, `Posting`, `Requirement`, `score`, `Bullet`, `render_tex`, `record_hash`.
- Produces:
  - `Application(id, posting_id, status: Literal["not_applied","applied","interview","offer","rejected"], created_at)`
  - `ResumeVersion(id, application_id, version: int, tex, bullets: list[Bullet], record_hash, created_at)`
  - `auto_cater(llm, jobs, cards, posting) -> list[Bullet]`. Select and reword cards for the posting; every returned bullet must have a `source_card_id` that exists in `cards`, otherwise it is dropped.
  - `Suggestion(bullet_index, old, new, terms: list[str], source_card_id, score_delta)`; `suggest(llm, cards, bullets, missing: list[Requirement]) -> list[Suggestion]`, built only from existing cards
  - `uncovered(missing, cards) -> list[Requirement]`, the requirements nothing in the Record mentions
  - `POST /api/applications {posting_id}` runs Auto cater and creates version 1; `GET /api/applications` (with `?q=&status=` filters); `GET /api/applications/{id}` returns the latest version, `score`, `matches`, `suggestions`, `uncovered`, and `stale: bool`; `POST /api/applications/{id}/versions {tex}` saves a hand-edited version; `PATCH /api/applications/{id} {status}`.

- [ ] **Step 1: Write failing tests with a `FakeLLM`:** `test_every_bullet_traces_to_an_existing_card`, `test_bullet_with_unknown_card_id_is_dropped`, `test_empty_record_returns_clear_error_not_empty_resume`, `test_suggestions_only_use_existing_cards`, `test_uncovered_requirement_listed_not_invented`, `test_version_marked_stale_after_record_edit`, `test_saving_edited_tex_creates_new_version`, `test_status_filter_and_search`, `test_cater_calls_llm_once_per_action`.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement. The prompt forbids adding facts not in the cards and requires numbers only when the card has them.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit `feat: auto cater, suggestions and resume versions`.

### Task 10: Gallery and New Application UI

**Files:**
- Create: `frontend/src/pages/{Gallery,NewApplication}.tsx`, tests beside each

**Interfaces:**
- Consumes: Tasks 6 and 9 endpoints.
- Produces: Gallery of resume tiles (thumbnail, role, company, last edited, format, score badge, status) with a first "New application" tile and filters for role, company, and status; New Application screen with URL / paste / HTML / screenshot input, the extracted requirements list, format selector showing LaTeX only, and an Auto cater button.

- [ ] **Step 1: Write failing tests:** `gallery shows new-application tile first`, `filter by status narrows tiles`, `url fetch failure shows the paste-text fallback`, `Auto cater is disabled until a posting is read`, `no requirements found shows a message and keeps the input`.
- [ ] **Step 2:** Run `npm test`. Expected: FAIL.
- [ ] **Step 3:** Build to match `home-gallery-v1.html` and screen 4 of `user-flow-v1.html`.
- [ ] **Step 4:** Run `npm test`. Expected: PASS.
- [ ] **Step 5:** Commit `feat: gallery and new application ui`.

### Task 11: Editor with criteria chips, inline suggestions and PDF preview

**Files:**
- Create: `frontend/src/pages/Editor.tsx`, `frontend/src/components/{SourceEditor,CriteriaChips,ScoreMeter,PdfPreview}.tsx`, tests beside each

**Interfaces:**
- Consumes: `GET /api/applications/{id}`, `POST /api/latex/compile`, `POST /api/applications/{id}/versions`.
- Produces: `SourceEditor` (CodeMirror 6 with a `.tex` mode, suggestion decorations on the bullet's line showing the struck old text and the new text with Accept and Reject, rendered as widgets in the document); `CriteriaChips` (matched / partial / missing; clicking a chip scrolls to and highlights its lines); `ScoreMeter` (current score and "→ N if all accepted", recomputed on the client or via the API as the user types, with no AI call); `PdfPreview` (keeps the last good PDF and shows the compiler error beside it when a compile fails); "Not in your record yet" panel with an "Ask AI about it" button that opens the drawer; Export saves a version.
- Hand edits to a line drop that line's suggestion decoration instead of mis-placing it.

- [ ] **Step 1: Write failing tests:** `accepting a suggestion replaces the line and updates the score`, `rejecting removes the decoration only`, `clicking a chip highlights its lines`, `editing a suggested line removes its suggestion`, `compile error keeps previous pdf and shows the log`, `typing never calls an AI endpoint`, `uncovered requirement offers Ask AI`.
- [ ] **Step 2:** Run `npm test`. Expected: FAIL.
- [ ] **Step 3:** Build to match screen 5 of `user-flow-v1.html` and Option A of `auto-cater-ats-v1.html`, with the match score from the owner's feedback.
- [ ] **Step 4:** Run `npm test`. Expected: PASS.
- [ ] **Step 5:** Commit `feat: resume editor with criteria and inline suggestions`.

### Task 12: End to end pass and README

**Files:**
- Create: `e2e/` (Playwright), `e2e/mvp.spec.ts`
- Modify: `README.md`

- [ ] **Step 1: Write the test** `mvp.spec.ts` against a backend started with `FakeLLM` (env flag): add a job and a project by hand → paste a posting → Auto cater → accept one suggestion → score rises → export → PDF downloads → edit a card in the Record → the resume shows "possibly out of date".
- [ ] **Step 2:** Run `npx playwright test`. Expected: FAIL.
- [ ] **Step 3:** Fix any gaps the test surfaces; document the fake-LLM flag, setup, Tectonic install, and the template licence in `README.md`.
- [ ] **Step 4:** Run backend, frontend, and e2e suites. Expected: PASS.
- [ ] **Step 5:** Commit `test: end to end mvp flow and docs`.

---

## Self-review notes

- **Spec coverage:** Gallery (10), Record (2, 5), Ask AI (4, 5), Profile and Settings (3, 5), New application (6, 10), Editor with chips, score, suggestions, and "ask about a gap" (7, 9, 11), Finish and versions (9, 11), JSON backup (3), staleness (2, 9), local-only and key handling (1, 3). Not in the MVP, so no task: import of an existing resume, stacks, docx, form-filling, accounts, hosting.
- **Gallery filters:** the spec asks for filters by role, company, and similar attributes; Task 9 gives role/company search and a status filter on the API, and Task 10 puts them in the UI. Score and format filters are left for later.
- **Thumbnails:** tiles use a simple rendered preview of the first PDF page; if that proves costly, a static placeholder is acceptable for the MVP (my call).
