# Resumaker: Design

Date: 2026-10-27
Status: Draft for approval

Items marked **(my call)** were decided by the writer, not by the product owner. Everything else came from the product owner.

## 1. Intent and why

Applying cold to jobs works best with a resume tailored to each posting. Tailoring today means reading the posting, picking out keywords, then manually rewriting bullets and digging old tasks out of memory (for example, dropping backend work and surfacing machine-learning work for a data-science role). The slow, annoying parts are recalling small forgotten details and rewriting by hand.

Resumaker is two things:

1. **A memory.** One complete, honest record of everything the user has done: jobs, projects, accomplishments, education, skills, certificates, and behavioral-question answers. A single long job may have many projects, and only a few are used per application.
2. **A first-draft writer.** Given a job posting, it picks and rewords from that record to maximise ATS passability and recruiter appeal, and produces an editable resume.

The user stays in control. The AI is opt-in and never writes anything without the user's approval.

## 2. Goals, non-goals, anti-goals

### Goals
- Make the full record easy to build and edit by hand, with AI as an optional helper.
- Turn a job posting plus the record into a tailored resume draft with one action ("Auto cater").
- Show how well the resume matches what ATS systems look for, and show it smoothly in the UI.
- Run locally on localhost for the MVP. Nothing is deployed. Avoid choices that would block a web version later.
- Let users supply their own AI API key.

### Non-goals for the MVP
- Importing an existing resume (docx, tex, txt, PDF).
- Editing docx in the app, or exporting docx. Docx is a later format.
- Stacks (grouping resumes in the gallery).
- Gallery filters beyond the basics needed to find a resume.
- Form-filling for Workday, Greenhouse, LinkedIn, and similar sites.
- Provider account sign-in and paid AI credits.
- Real-time collaboration.
- Deploying or hosting a web version: user accounts, multi-user data, server-side LaTeX sandboxing, and hosted key storage. The MVP is local development on localhost only. The owner confirmed this.

### Anti-goals (my call; the owner has not yet answered "what would make you wince")
- The AI inventing or inflating experience. Every line in a resume must trace back to something in the record.
- The AI changing the record or a resume without the user's explicit accept.
- Sending the user's API key or data anywhere beyond the provider they chose.

## 3. Product description

### 3.1 Screens

**Home (gallery).** A Procreate-style gallery of tailored resumes. Each tile is a page thumbnail with job title, company, last-edited time, source format, and a match-score badge. The first tile is "New application". The gallery shows resumes only. Filters help the user find resumes by role, company, and similar attributes. This is the beginner UI.

**Record.** The user's whole history, the source everything is picked from. It covers all core resume sections: employment (with projects and accomplishments), education, projects, skills, certificates, and others. Each job is a page with company, title, dates, plus the basics application forms ask for (location, employment type, manager or reference contact, reason for leaving). Projects and accomplishments are cards with a short description and tags (for example ML, Frontend, Airflow). Cards can hold far more detail than ever appears on a resume. Filling it in is manual first, with an always-present "Add project or accomplishment" action.

**Ask AI (slide-over, opens on the Record).** A panel the user opens when they want it. They describe their work in plain language, like talking to someone who asks about their day. The AI proposes a card and the user chooses Add or Edit. It never writes on its own. (my call) It asks follow-ups for missing details such as numbers and results. It also helps the user answer common behavioral questions for a target role, and (my call) those answers are stored in the record tied to the job or project they came from.

**Profile.** The basics about the user that do not change per job: name, contact info, links, work authorization. (my call) Education lives in the Record, not here.

**Settings.** (my call) Where the user enters their AI API key and model choice.

**New application.** The user supplies a posting as a URL, pasted text, HTML, or a screenshot. A URL is fetched by the app. (my call) If a URL cannot be fetched (login wall, bot block), the app asks the user to paste the text. The app shows what it extracted (for example, a list of requirements) and the user presses **Auto cater**.

**Editor.** The resume source is the main surface. For the MVP the source is LaTeX using Jake's resume template. (my call) It is a code-style editor for the `.tex` with a live PDF preview. Above the document is a row of criteria chips (matched, partial, missing) for what ATS systems track. A match score shows in the corner, including what it would become if all suggestions were accepted. Clicking a chip highlights the relevant lines and shows the suggested rewrite inline as a tracked change the user accepts or rejects. If a requirement is not covered by anything in the record, the editor says so and offers to ask the AI about it. Suggestions must not show as a plain bullet-point sidebar.

**Finish.** (my call) Export renders the PDF and saves the resume as a version under the application.

### 3.2 Source model
- The resume source is the lowest-level editable artifact. The user or the AI can edit it, and it renders to PDF.
- The Record and Profile are the structured data. The source is generated from them plus the posting through a template. Hand edits to a resume's source stay with that resume. (my call) They do not flow back into the Record unless the user chooses to save them there.
- The MVP template is Jake's resume template, which is a single-column layout and ATS-friendly. More formats (docx and others) and templates come after the MVP. The format is a user choice, with LaTeX as the only option at first.

### 3.3 The AI
- Always opt-in. It does nothing until the user opens it or presses Auto cater.
- Proposes; the user approves. This applies to the Record and to resume edits.
- First version: the user supplies their own API key. Provider account connection and paid credits are later.

## 4. Constraints

- MVP runs on localhost as a single-user app, in local development. No deployment. Data and the API key stay on the user's machine. (my call) Keep storage and key handling behind interfaces so a web version stays possible later.
- Turning `.tex` into PDF needs a LaTeX engine. (my call) Tectonic or similar, installed locally as a prerequisite.
- ATS-friendliness: the output must be parseable by ATS systems, so single-column layout, standard section headings, and plain text keywords.

## 5. Decided so far on how it is made

Chosen by the owner as a good starting point, to be reviewed when planning begins:
- Backend in Python.

Recommended by the writer and accepted by the owner as "makes sense for now" (my call on specifics):
- FastAPI backend.
- SQLite for the MVP. Postgres only if a web version comes later.
- React + TypeScript on Vite, with Tailwind and shadcn/ui.
- CodeMirror for the `.tex` editor.
- Local run via one command that serves the built frontend from FastAPI. A desktop wrapper (for example Tauri) is possible later.

Not verified: licensing and capabilities of any track-changes-style editor library, how to render accept/reject suggestions in CodeMirror, and the LaTeX engine choice. The plan should check these.

## 6. MVP order

1. Record and Profile with manual forms, including the Ask AI slide-over and the user-supplied API key.
2. New application, posting intake, Auto cater, and the match score with criteria chips.
3. The editor with the PDF preview and export.

## 7. Later (not MVP)

Importing an existing resume, stacks, richer gallery filters, docx and other formats, form-filling for application sites, provider sign-in, and paid credits.

## 8. Further calls (my call, from the builder check)

- **AI providers:** a provider-agnostic layer. Start with Anthropic and OpenAI. The chosen model must accept images, because screenshots are an accepted posting format.
- **What counts as an AI action:** the user submitting a posting counts as asking for extraction, so the app may call the AI then. Beyond that, the AI is called only when the user opens Ask AI, presses Auto cater, or asks about a gap. Editing a resume never triggers an AI call on its own.
- **Match score:** deterministic (keyword and requirement coverage against the extracted requirements), so it is cheap, reproducible, and can update live as the user edits. The AI extracts the requirements once; it does not judge the score.
- **Record vs. resume after generation:** a resume is a snapshot. If the Record changes later, the resume is marked as possibly out of date, and it never updates silently. Each generated bullet stores a link to the Record card it came from, so "traces back to the record" is checkable.
- **Suggestions and hand edits:** suggestions are built on a structured per-bullet representation of the generated source. Free-form edits to the `.tex` are allowed, but then suggestion highlighting may degrade for the lines that were changed.
- **Data safety:** the Record can be exported and imported as JSON. The local database file location is the builder's choice, and schema migrations are expected from the start.
- **Local install:** the user installs the LaTeX engine as a documented prerequisite for the MVP. Bundling it is later. macOS is the first target.
- **URL fetching:** best effort. JS-rendered pages and login walls fall back to pasting the text. A headless browser is later.

## 9. Left to the builder

- The data model for the Record, tags, and posting requirements.
- How the match score is calculated and what the criteria are.
- How Auto cater picks and rewords from the Record.
- How inline suggestions are represented in the `.tex` source.
- Visual design details beyond the mockups in `.superpowers/brainstorm/`.
- The test strategy.
