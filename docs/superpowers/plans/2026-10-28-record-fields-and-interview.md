# Record Fields and Interview Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every Record section its own application-form fields (common ones shown, rare ones behind an "Add field" menu) and add an Interview tab holding questions with many STAR-format answers, drafted by the AI only on request.

**Architecture:** One JSON file (`shared/record-fields.json`) lists every field of every section; the backend validates against it and the frontend renders forms from it. Stored-only fields live in the existing `Card.extra` JSON (and a new `Job.extra`), so no per-field columns. Interview data is three new tables; built-in questions live in code. The resume pipeline keeps reading cards but only the "printed" extras count as evidence.

**Tech Stack:** FastAPI, SQLModel, Alembic, pytest; React, TypeScript, Vite, Vitest, Playwright (all as in the MVP).

**Spec:** `docs/superpowers/specs/2026-10-28-record-fields-and-interview-design.md` (approved; builds on `2026-10-27-resumaker-design.md`).

## Global Constraints

- Scope is the Record tab and the new Interview tab. Profile, Settings, gallery, New application and Editor behavior must not change.
- Existing data keeps working: the migration runs on an existing database with no data loss; an old export (`schema_version` 1) still imports.
- A resume made from existing cards (no new fields) is byte-identical to before. The only resume change: an education card with `degree_type` and/or `field_of_study` prints `"<degree_type>, <field_of_study>"` (whichever exist) on its degree line instead of its description.
- Stored-only extras (not in a section's `printed` list) never count as evidence in `card_supports`, the numbers check, scoring, and are not sent to the model in cater/suggest prompts.
- AI is opt-in and proposes only. An Interview draft is never saved without the user's Accept. The key and data stay local.
- An accomplishment must belong to a job (unchanged). New cards of kind `behavioral` are refused (422); existing rows stay readable.
- Dates stay free text. Text extras are capped at 100 chars (`MAX_EXTRA_CHARS`), as today.
- Tests: `cd backend && .venv/bin/pytest`, `cd frontend && npx vitest run && npx tsc -b`.

## Review Focus

Failure modes the tasks' tests must pin (each is added to the owning task):

1. An existing database with old behavioral cards migrates: each becomes a custom question plus one answer (text in Action), originals stay in `card` but never show on the Record or reach cater (Task 5).
2. A `schema_version` 1 export imports cleanly, and a v2 export round-trips including Interview data (Task 6).
3. Editing a card that has `extra` keys the form does not know (from an import) keeps them (Task 3).
4. A drafted answer that adds a number or a Record tool/skill not in its cited cards is rejected; an empty Record gives a clear message, no model call (Task 7).
5. Deleting a custom question deletes its answers; deleting a cited card leaves the answer and the UI shows "source removed" (Tasks 5, 8).

---

## File map

- Create `shared/record-fields.json`: sections (`job`, `education`, `project`, `accomplishment`, `skill`, `certificate`), each a list of `{key, label, type: text|select|yesno|textarea, options?, placeholder?, default: bool, printed: bool}`.
- Create `backend/app/recordfields.py`: loads the JSON; `FIELDS`, `printed_keys(kind)`, `clean_extra(kind, extra)`.
- Create `backend/app/interview.py` (built-in questions, STAR draft logic), `backend/app/routes/interview.py`.
- Modify `backend/app/models.py`, `cater.py`, `latex/template.py`, `ai/askai.py`, `ai/fake.py`, `routes/record.py`, `routes/portability.py`, `main.py`.
- Frontend: create `src/lib/recordFields.ts`, `src/components/AddFieldMenu.tsx`, `src/pages/Interview.tsx`, `src/components/AnswerCard.tsx`; modify `CardForm`, `CardItem`, `JobForm`, `Record`, `JobPage`, `AskAIDrawer`, `App`, `api.ts`, `test/fakeApi.ts`, `vite.config.ts`, tsconfigs.

---

### Task 1: Field registry and backend validation

**Files:**
- Create: `shared/record-fields.json`, `backend/app/recordfields.py`, `backend/tests/test_recordfields.py`
- Modify: `backend/app/models.py` (replace `CARD_EXTRA_FIELDS`/`known_extra`; add `Job.extra`), `backend/app/routes/record.py`, `backend/app/ai/askai.py`
- Create: `backend/migrations/versions/<rev>_job_extra.py` (down_revision `9c1f3a7b2d40`)

**Interfaces:**
- Produces: `recordfields.printed_keys(section: str) -> tuple[str, ...]`; `recordfields.keys(section) -> tuple[str, ...]`; `recordfields.clean_extra(section: str, extra: dict) -> dict` (known keys: stripped strings, capped at 100 chars, empty dropped, `yesno` values only `"yes"`/`"no"`; unknown keys pass through untouched). `known_extra(kind, extra)` in models.py keeps its name and returns only known keys (used by askai). `Job.extra: dict` (JSON, default `{}`) in `JobBase/JobUpdate/JobDoc`.
- Field lists (key ★=printed, d=default): the lists in spec 3.1. Keys: **job** (columns, not extra): company★d, title★d, location★d, employment_type d (select), start_date★d, end_date★d; extra: currently_here d (yesno), manager_name, manager_contact, ok_to_contact (yesno), salary, reason_for_leaving. **education**: school=card title★d; extra location★d, degree_type★d (select: Associate, Bachelor's, Master's, Doctorate, Certificate, Other), field_of_study★d, gpa d, gpa_scale d, start_date★d, end_date★d, status d (select: Graduated, Attending, Expected), minor, honors, clubs, coursework, notes. **project**: extra start_date★, end_date★ (d), role, link, team_size, notes. **accomplishment**: extra date, notes. **skill**: category★d, level (select Beginner/Intermediate/Advanced/Expert), years, last_used. **certificate**: date★d, issuer d, expiry, credential_id, credential_link. For project and accomplishment the card's `description` is labelled "What it did" and `details` "Results and numbers" in the UI (no new storage). The legacy job columns `manager_contact` and `reason_for_leaving` stay columns; the JSON lists them under `job` with `"column": true`.

- [ ] **Step 1: Write failing tests** in `test_recordfields.py`: `test_printed_keys_match_today` (`printed_keys("education") == ("location","start_date","end_date","degree_type","field_of_study")`, skill `("category",)`, certificate `("date",)`, project `("start_date","end_date")`); `test_clean_extra_caps_strips_and_keeps_unknown` (`clean_extra("education", {"gpa":" 3.7 ","minor":"x"*300,"zzz":"keep","notes":""})` → gpa `"3.7"`, minor length 100, `zzz` kept, notes dropped); `test_yesno_rejects_other_values`; `test_post_card_cleans_extra` and `test_patch_card_cleans_extra` via the client; `test_new_behavioral_card_is_422_but_existing_row_readable` (insert a behavioral `Card` directly, `GET /api/cards` returns it, `POST` kind behavioral → 422 with a message naming the Interview tab); `test_job_extra_roundtrip` (POST/PATCH a job with `extra={"salary":"90k"}`).
- [ ] **Step 2: Run** `pytest tests/test_recordfields.py -q`; expect FAIL (module missing).
- [ ] **Step 3: Implement** the JSON, `recordfields.py` (load once with `lru_cache`, path `BACKEND_DIR.parent/"shared"/"record-fields.json"`), `Job.extra`, the migration (`op.add_column('job', sa.Column('extra', sa.JSON(), nullable=False, server_default='{}'))`), route validation (`clean_extra` on create/update for cards and jobs; reject `behavioral` on create and when PATCH sets kind to it), and make `known_extra` delegate to the registry.
- [ ] **Step 4: Run** the full backend suite; expect PASS (fix tests that assumed the old `CARD_EXTRA_FIELDS`, keeping their intent).
- [ ] **Step 5: Commit** `feat: record field registry, job extra, card extra validation`.

---

### Task 2: Resume pipeline keeps its behavior

**Files:**
- Modify: `backend/app/cater.py` (`_fields`, `_prompt_card`, `_citable`), `backend/app/latex/template.py` (`_education`)
- Test: `backend/tests/test_stored_only_fields.py`; extend `test_cater.py`/`test_latex.py` only if existing expectations change

**Interfaces:** Consumes `recordfields.printed_keys`. Produces: `cater._fields(card)` uses only printed extras; `_prompt_card` sends only printed extras; `_citable` keeps its current printed-only behavior (education now also keeps `degree_type`, `field_of_study`).

- [ ] **Step 1: Write failing tests**: `test_stored_only_extras_are_not_evidence` (a project card with `extra={"role":"Kubernetes lead","notes":"saved 40%"}` and empty description/details: `card_supports(card, Requirement(term="Kubernetes", kind="skill", weight=1))` is False and `_numbers_traceable("saved 40%", _card_text(card))` is False); `test_prompt_card_omits_stored_only_extras`; `test_existing_cards_render_identically` (build the same resume twice, from cards without new keys, and compare to a golden string captured before the change from `main`-equivalent inputs: education with description prints as before); `test_education_degree_line_uses_degree_and_field` (`degree_type="Bachelor's"`, `field_of_study="Computer Science"` → output contains `Bachelor's, Computer Science` and not the description; only `degree_type` → `Bachelor's`; neither → the description as before); `test_gpa_never_printed`.
- [ ] **Step 2: Run** `pytest tests/test_stored_only_fields.py -q`; expect FAIL.
- [ ] **Step 3: Implement** the three cater helpers and `_education`: `_degree_line(card) -> str` (degree_type, field_of_study joined by ", "; else `card.description`).
- [ ] **Step 4: Run** the full backend suite; expect PASS with no golden changes.
- [ ] **Step 5: Commit** `feat: stored-only fields stay off the resume and out of evidence`.

---

### Task 3: Card forms with an "Add field" menu

**Files:**
- Create: `src/lib/recordFields.ts`, `src/components/AddFieldMenu.tsx`, `src/components/AddFieldMenu.test.tsx`
- Modify: `vite.config.ts` (alias `@shared` → `../shared`), `tsconfig.json` and `tsconfig.app.json` (paths, `resolveJsonModule`), `src/components/CardForm.tsx`, `CardItem.tsx`, `src/lib/cardFields.ts` (remove; callers move to `recordFields.ts`), tests `CardForm.test.tsx`
- Modify: `src/api.ts` (`CardKind` drops no value; `Job.extra`, `JobInput.extra`)

**Interfaces:**
- Produces: `FIELDS: Record<Section, FieldDef[]>` imported from `@shared/record-fields.json`; `fieldsFor(kind)`; `<AddFieldMenu available={FieldDef[]} onPick={(key) => void} />` (a button "Add field" opening a menu of labels); `visibleKeys(def, extra)`: default fields plus any field with a value.
- `CardForm` props unchanged. It renders: Title (labelled "School" for education, "Name" for project and certificate and skill), the section's default fields, "What it did"/"Results and numbers" for project and accomplishment, tags; fields with a value show automatically; the rest are in the menu; a picked field is added to the form and focused. `select` fields render a `<select>` with an "Other" option that reveals a text input; `yesno` renders a select (blank, Yes, No). Empty fields are not saved; unknown `extra` keys are preserved on save (as today's `otherExtra`).

- [ ] **Step 1: Write failing tests** (`CardForm.test.tsx`, `AddFieldMenu.test.tsx`): education form shows School, Degree type, Field of study, GPA, Start date, End date, Status, Location and does not show Minor, Honors, Clubs, Coursework; `getByRole('button',{name:/add field/i})` lists exactly those four plus Notes; picking "Minor" shows an input that is saved as `extra.minor`; editing a card whose `extra.minor="Stats"` shows Minor without opening the menu; an unknown imported key `extra.legacy="x"` is still in the saved payload; choosing degree type "Other" reveals a text input saved as the typed value; a skill form shows Name and Category; a certificate form shows Name, Issuer, Date; empty added fields are omitted from the payload; the project form under a job hides dates (as today).
- [ ] **Step 2: Run** `npx vitest run src/components` ; expect FAIL.
- [ ] **Step 3: Implement** per the interface. Display in `CardItem`: every non-empty extra with its label (stored-only fields too).
- [ ] **Step 4: Run** `npx vitest run && npx tsc -b`; expect PASS.
- [ ] **Step 5: Commit** `feat: per-section card forms with Add field menu`.

---

### Task 4: Job form, Record page, and Ask AI without behavioral

**Files:**
- Modify: `src/components/JobForm.tsx`, `src/pages/Record.tsx`, `JobPage.tsx` (job header shows new fields), `AskAIDrawer.tsx`, `backend/app/ai/askai.py` (prompt text and schema enum drop `behavioral`; the model may not propose it), `backend/app/cater.py` comment only
- Test: `JobForm.test.tsx` (new), `Record.test.tsx`, `AskAIDrawer.test.tsx`, `backend/tests/test_askai.py`

**Interfaces:** Consumes Task 3's `AddFieldMenu`/`visibleKeys`. `JobForm` default fields: Company, Job title, Location, Employment type (select), Start date, End date, "Currently work here" (yesno); menu: Manager name, Manager contact, OK to contact, Salary, Reason for leaving. `manager_contact`/`reason_for_leaving` are job columns; the other menu fields go in `job.extra`. The Record page lists Employment, Education, Projects, Skills, Certificates (no Behavioral section) and the "Other" section must not list `behavioral` rows.

- [ ] **Step 1: Write failing tests**: job form shows only the seven default fields; "Add field" lists the five menu fields; a job with `manager_contact` set shows it automatically; saving sends `manager_name` etc. in `extra` and keeps `manager_contact` a top-level key; Record page has no "Behavioral" heading and a seeded behavioral card appears nowhere on the page; `AskAIDrawer` offers no behavioral kind and `test_askai.py::test_schema_has_no_behavioral` passes (`"behavioral" not in RESPONSE_SCHEMA[...]["kind"]["enum"]`, and `CardDraft(kind="behavioral")` is dropped by `ProposalReply` parsing like other invalid proposals).
- [ ] **Step 2: Run** the three frontend files and `pytest tests/test_askai.py`; expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** both suites; expect PASS.
- [ ] **Step 5: Commit** `feat: job form fields, Record without behavioral, Ask AI without behavioral`.

---

### Task 5: Interview data model, built-in questions, API, migration

**Files:**
- Create: `backend/app/interview.py`, `backend/app/routes/interview.py`, `backend/migrations/versions/<rev>_interview.py` (down_revision = Task 1's), `backend/tests/test_interview.py`, `backend/tests/test_interview_migration.py`
- Modify: `backend/app/models.py`, `backend/app/main.py` (include router)

**Interfaces:**
- Models (SQLModel tables): `InterviewQuestion(id, text, category)` (custom only); `InterviewAnswer(id, question_ref: str index, situation, task, action, result: str = "", source_card_ids: list[int] JSON, job_id: int|None FK jobs ondelete SET NULL, created_at: str)`; `HiddenQuestion(ref: str primary key)`.
- `interview.BUILTIN: list[BuiltinQuestion(key, text, category)]` about 30 questions in the categories Leadership, Teamwork and conflict, Failure and learning, Initiative, Pressure and deadlines, Technical experience; refs are `"b:<key>"` with stable keys (`lead-project`, `most-technical`, ...); custom refs are `"c:<id>"`. `interview.CATEGORIES: tuple[str, ...]`.
- Routes (`/api/interview`): `GET /questions?include_hidden=false` → `[{ref, text, category, builtin, hidden, answer_count}]`; `POST /questions {text, category}` → 201; `PATCH /questions/{id}`, `DELETE /questions/{id}` (custom only, also deletes its answers; built-in → 404); `PUT /questions/{ref}/hidden {hidden: bool}`; `GET /answers?question_ref=`; `POST /answers {question_ref, situation, task, action, result, source_card_ids, job_id}` (question_ref must exist, 404 otherwise; source ids that do not exist are dropped); `PATCH /answers/{id}`, `DELETE /answers/{id}`. Answers list returns `source_cards: [{id, title} | {id, removed: true}]`.
- Migration also copies each `card` with `kind='behavioral'` into a custom question (text = card title, category "Mine") and one answer (`action` = description, plus `"\n\n"` + details when present; `job_id` = card.job_id; tags appended to `action` as `"\n\nTags: a, b"` when present). The card rows stay.

- [ ] **Step 1: Write failing tests**: `test_builtin_keys_unique_and_stable` (keys unique, every category in `CATEGORIES`, `"b:most-technical"` exists with the text "What is the most technical thing you have built?"); `test_list_questions_merges_builtin_and_custom_and_counts_answers`; `test_hide_and_unhide_builtin`; `test_custom_question_crud_and_cascade_delete` (answers gone after question delete); `test_cannot_edit_builtin`; `test_answer_requires_existing_question`; `test_many_answers_per_question`; `test_deleting_a_cited_card_marks_source_removed`; `test_deleting_job_nulls_answer_job_id`; migration test: build a database at the previous revision with two behavioral cards (one with a job, details and tags, one bare), run `alembic upgrade head`, assert two custom questions and two answers with the expected `action` text and `job_id`, original rows still in `card`, and a card of another kind untouched.
- [ ] **Step 2: Run**; expect FAIL.
- [ ] **Step 3: Implement** models, migration (data step with `op.get_bind()` and plain SQL), `interview.py`, routes.
- [ ] **Step 4: Run** the full backend suite; expect PASS.
- [ ] **Step 5: Commit** `feat: interview questions and answers API, behavioral card migration`.

---

### Task 6: Export and import include Interview data

**Files:**
- Modify: `backend/app/routes/portability.py`, `backend/tests/test_portability.py`

**Interfaces:** `SCHEMA_VERSION = 2`. `ExportDoc` gains `job_extra` through `JobDoc.extra`, `interview_questions: list`, `interview_answers: list`, `hidden_questions: list[str]`. Import accepts `schema_version` 1 or 2 (a v1 doc has none of the new lists; they default empty and existing Interview data is replaced by empty, the same replace-everything rule as the Record). Ids are remapped: custom question refs in answers are rewritten to the new question ids; unknown `source_card_ids` are dropped.

- [ ] **Step 1: Write failing tests**: `test_export_v2_roundtrip_with_interview` (seed jobs with extra, cards, a custom question with two answers citing a card, a hidden built-in; export; wipe; import; compare); `test_v1_export_still_imports` (a literal v1 document without the new keys → 200 and the Record restored); `test_import_rejects_unknown_version_3`; `test_import_remaps_custom_question_refs` (export doc with question id 7 imported into a database whose next id is different).
- [ ] **Step 2: Run**; expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** full backend suite; expect PASS.
- [ ] **Step 5: Commit** `feat: export and import cover job extras and the Interview tab`.

---

### Task 7: AI-drafted STAR answers

**Files:**
- Modify: `backend/app/interview.py`, `backend/app/routes/interview.py`, `backend/app/ai/fake.py`
- Test: `backend/tests/test_interview_draft.py`

**Interfaces:**
- Produces: `interview.draft_answer(llm: LLM, question_text: str, cards: list[Card], jobs: list[Job]) -> Draft` where `Draft(situation, task, action, result: str, source_card_ids: list[int])`; raises `DraftError(str)` (a `ValueError`) with a user-safe message when nothing usable remains; `interview.DRAFT_SYSTEM_PROMPT`; `interview.DRAFT_SCHEMA` (strict: all four STAR parts plus `source_card_ids`, `additionalProperties: false`). Route `POST /api/interview/draft {question_ref}` → the draft, never writes (400 no key via the existing `llm_dep`, 502 `AIError`, 422 `DraftError`, 404 unknown question).
- Input to the model: citable Record cards only (`cater._citable`-style: projects, accomplishments, education, skills, certificates with printed fields; behavioral and stored-only extras excluded), each with its id. About 150 words total; first person; a STAR part the Record cannot support must be an empty string.
- Verification after the model answers, all of which must pass or the draft is rejected with a reason: every cited id is in the supplied cards; at least one id is cited; every number or number word in the answer appears in the cited cards' text (`cater._numbers_traceable` on the joined STAR text and joined cited text); every Record term (card tags, skill-card titles, over the whole Record) that the answer mentions (whole word, `cater` ambiguity rules via `_claims`-style matching) appears in a cited card. Terms the Record never mentions cannot be checked (same limitation as Auto cater); the plan's final summary tells the owner this.

- [ ] **Step 1: Write failing tests** with a scripted `LLM` stub: `test_valid_draft_passes`; `test_rejects_uncited_id`; `test_rejects_invented_number` ("cut costs 40%" when no cited card has 40); `test_rejects_number_word` ("tripled"); `test_rejects_skill_from_another_card` (answer says "Kubernetes", a different, uncited card has the tag Kubernetes); `test_empty_record_gives_message_and_no_model_call` (the stub raises if called); `test_empty_star_parts_allowed`; `test_route_never_writes` (answers table unchanged after a successful draft); `test_route_without_key_is_400`; `test_fake_llm_draft_is_deterministic` (with `RESUMAKER_FAKE_LLM=1` the route returns a draft citing the first card, and it passes verification).
- [ ] **Step 2: Run**; expect FAIL.
- [ ] **Step 3: Implement** (reuse `cater` helpers; do not duplicate the number logic; add the `_draft` branch to `FakeLLM.complete` keyed on `DRAFT_SYSTEM_PROMPT`).
- [ ] **Step 4: Run** full backend suite; expect PASS.
- [ ] **Step 5: Commit** `feat: draft STAR interview answers from the Record`.

---

### Task 8: Interview tab UI

**Files:**
- Create: `src/pages/Interview.tsx`, `src/pages/Interview.test.tsx`, `src/components/AnswerCard.tsx`
- Modify: `src/App.tsx` (route `/interview`, nav link after Record), `src/api.ts`, `src/test/fakeApi.ts` (interview endpoints), `src/pages/Record.tsx` (none)

**Interfaces:** Consumes the Task 5 and 7 endpoints. `api.listQuestions(includeHidden?)`, `createQuestion`, `updateQuestion`, `deleteQuestion`, `setHidden(ref, hidden)`, `listAnswers(ref)`, `createAnswer`, `updateAnswer`, `deleteAnswer`, `draftAnswer(ref)`. Layout from the approved mockup: question list on the left with category chips (All, each category, Mine) and a "+ Add my own question" button; "Answered / No answer yet" per question; hidden questions in a collapsed "Hidden" group with Unhide. Right side: the question, then every answer as an `AnswerCard` showing Situation, Task, Action, Result with "Built from" sources (`removed` ones read "source removed") and Edit/Delete; "+ Add an answer" (manual STAR form with four text areas); "Draft an answer" button calls the AI, shows the result as a highlighted suggestion with Accept (saves it) and Reject (discards); error messages from the API show inline.

- [ ] **Step 1: Write failing tests** (`Interview.test.tsx` with `installFakeApi`): list shows built-in questions and a category filter narrows it; adding a custom question; selecting a question and adding two answers shows two cards; the STAR labels appear in order; Draft shows a suggestion and nothing is saved until Accept (`calls` has no POST /answers before Accept; Reject leaves none); a 422 from draft shows its message; hiding a question moves it to Hidden and unhiding restores it; deleting an answer confirms first; a removed source renders "source removed"; the nav has an Interview link.
- [ ] **Step 2: Run** `npx vitest run src/pages/Interview.test.tsx`; expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run && npx tsc -b`; expect PASS.
- [ ] **Step 5: Commit** `feat: Interview tab`.

---

### Task 9: End-to-end, README, and live check

**Files:**
- Modify: `e2e/mvp.spec.ts` (or add `e2e/record-interview.spec.ts`), `README.md`

- [ ] **Step 1: Write the e2e test** against the fake LLM: add an education entry using Degree type and the Add field menu for Minor; add a job with a manager name via the menu; open Interview, add a custom question, add a manual STAR answer, draft one (fake LLM) and Accept it; reload and see both answers; Record page shows no Behavioral section.
- [ ] **Step 2: Run** `make e2e`; expect PASS (the PDF export step still skips without Tectonic).
- [ ] **Step 3: Update README** (Record fields and the Add field menu, the Interview tab, what the draft check can and cannot catch, export/import v2).
- [ ] **Step 4: Run** `make test` and `make e2e`; expect all PASS.
- [ ] **Step 5: Commit** `docs,test: e2e and README for record fields and interview`.
