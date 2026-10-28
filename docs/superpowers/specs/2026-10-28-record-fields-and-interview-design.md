# Record fields and the Interview tab: Design

Date: 2026-10-28
Status: Approved by the owner (2026-10-28), with the change that answers use the STAR format
Builds on: `2026-10-27-resumaker-design.md` (the MVP design). Anything not mentioned here keeps working as it does now.

Items marked **(my call)** were decided by the writer, not by the product owner. Everything else came from the product owner.

## 1. Intent and why

On the Record tab, education, projects, skills, certificates and behavioral answers all use the same form (title, description, details, tags), so none of them asks the questions that belong to it. Education has no degree type or GPA; a certificate has no issuer. The owner wants each section to ask for what a real application form asks (Greenhouse, Workday and LinkedIn are the reference), so that later the Record can be used to fill application forms.

Behavioral answers also do not belong in the Record. They become a separate **Interview** tab, where the user keeps possible answers to common interview questions, built from the Record and ready to rehearse.

Scope is the Record tab and the new Interview tab only. Nothing else is being fixed in this round.

## 2. Goals, non-goals, anti-goals

### Goals
- Each Record section has its own fields, matching what application forms ask.
- The Record stores everything a form asks, even what the resume never prints, so form-filling can use it later.
- Forms stay short: common fields show up front, less common ones are added on demand.
- An Interview tab holds questions and, for each question, any number of answers.
- Existing Record data keeps working, and tailored resumes come out the same as before.

### Non-goals
- Form-filling itself (later; this round only stores the data it will need).
- Coding or problem-solving practice (a LeetCode-style portal is a later update). The Interview tab covers behavioral questions and technical-facing behavioral questions only, such as "What is the most technical thing you have built?".
- Mock-interview features: the app does not ask you questions in a session, time you, or grade your answers.
- Changes to Profile, Settings, the gallery, New application or the Editor.

### Anti-goals
- A form that is long and intimidating by default. (The owner said the first mockup had too many fields.)
- The AI writing an answer, or changing the Record, without the user's explicit accept. This is unchanged from the MVP.
- An answer that claims something not in the Record.

## 3. Product description

### 3.1 Record forms

Each section has its own form. The fields listed under "shown by default" are always visible. The fields under "add field menu" are hidden until the user picks them from an **Add field** menu on the form. A field the user adds is saved with that entry, and shows on the form whenever the entry is edited later. Empty added fields are not saved.

Fields marked ★ are printed on the resume. All others are stored only. Today the resume prints: job company, title, location and dates; education school, location, dates and its description; project name, dates, description and tags; skill name and category; certificate name and date. **(my call)** Beyond that, the only change to the resume is that an education entry with a degree type and field of study prints them on its degree line (for example "Bachelor's, Computer Science"), in place of the free-text description when both exist. The ★ marks below that are not in today's list (issuer, GPA, results, location and so on) are therefore wrong where they say the resume prints them: only the fields in this paragraph reach the resume, and the rest are stored. Entries that have none of the new fields print exactly as they do now.

The field lists below are the writer's proposal, based on the reference forms; the owner reviewed them for Employment (contact fields moved to the menu) and Education (rare fields moved to the menu). **(my call)** for the exact lists of the other sections.

**Employment** (a job)
- Shown by default: company ★, title ★, location ★, employment type, start date ★, end date ★ (or "currently work here").
- Add field menu: manager name, manager contact, OK to contact, salary, reason for leaving. The owner asked that contact details not be shown by default; **(my call)** that salary and reason for leaving join them.

**Education**
- Shown by default: school ★, degree type ★ (Associate, Bachelor's, Master's, Doctorate, Certificate, Other), field of study ★, GPA and scale, start date ★, end date or expected ★, status (graduated, attending, expected), location ★.
- Add field menu: minor, honors and awards, clubs and activities, relevant coursework, notes.

**Project**
- Shown by default: name ★, what it did ★, results and numbers ★, tech used (tags) ★, start and end date ★.
- Add field menu: role, link or repo, team size, notes.

**Accomplishment** (always belongs to a job, as today)
- Shown by default: title ★, what you did ★, result with numbers ★.
- Add field menu: date, notes.

**Skill**
- Shown by default: name ★, category ★.
- Add field menu: level, years of experience, last used.

**Certificate**
- Shown by default: name ★, issuer ★, issue date ★.
- Add field menu: expiry date, credential ID, credential link.

Dates stay free text (for example "Aug 2017" or "2021") as today, **(my call)** because imported and hand-typed values already vary and the resume prints them as typed.

### 3.2 Interview tab

A new top-level tab beside Record. Layout (mockup reviewed by the owner): a list of questions on the left with category chips and an "answered / not yet" indicator, and the selected question's answers on the right.

- **Questions.** Come from a built-in list of common questions, and the user can add custom questions. Questions have a category. **(my call)** The built-in list is a curated set of about 30 questions in the categories Leadership, Teamwork and conflict, Failure and learning, Initiative, Pressure and deadlines, and Technical experience (technical-facing behavioral, for example "What is the most technical thing you have built?"). Built-in questions cannot be edited; the user can hide one. Custom questions can be edited and deleted.
- **Answers.** A question has any number of answers. The user can add an answer by hand, or ask the AI to draft one. The user can edit or delete any answer. Every answer is in the STAR format (owner's requirement): four labelled parts, Situation, Task, Action and Result, each a short text box, shown in that order on the right-hand side. **(my call)** This applies to technical-facing questions too, since they are behavioral questions, and a part may be left empty.
- **AI drafting.** Opt-in per question: nothing is drafted until the user presses a draft button. The draft is drawn from the Record and shown as a suggestion; it is saved as an answer only when the user presses Accept (Reject discards it). This is the same propose-and-accept rule as the rest of the app. Custom questions can be drafted too, after the user approves the question.
- **Provenance.** An AI-drafted answer records which Record entries it was built from and shows them under the answer. It must not state facts, numbers or tools that are not in those entries (same rule as resume bullets).
- **Where the Ask AI drawer fits.** The Ask AI drawer on the Record stays for adding Record entries; it no longer proposes behavioral answers. **(my call)**

### 3.3 Existing data

- Existing cards of kind "behavioral" move to the Interview tab as answers. **(my call)** Each becomes a custom question (its title) with one answer (its description and details), and keeps its link to its job or project if it had one.
- Existing education, project, skill and certificate cards keep their values. Data in the old generic fields (description, details) stays where it is and is still shown; it is not split into the new fields automatically. **(my call)**
- Existing employment fields (manager contact, reason for leaving) keep their values and show in the form from then on, as added fields.
- Record export and import cover the new fields and the Interview data. Old export files still import. **(my call)**

## 4. Constraints

- Local single-user app, Python/FastAPI backend, React/TypeScript frontend, SQLite with migrations, as in the MVP. The migration must run on an existing database without losing data.
- The tailored-resume pipeline (Auto cater, scoring, LaTeX) reads Record cards. Its output for existing data must not change, and the new stored-only fields must not appear on the resume unless starred above.
- Provenance rules and the opt-in AI rule from the MVP design apply to Interview drafts.
- The AI key and data stay local; the only thing sent out is the text of a request the user triggers.

## 5. Decided so far on how it is made

By the owner: Interview is a separate tab; fields are modelled on Greenhouse, Workday and LinkedIn; a question has many answers; scope is the Record tab only.

## 6. Calls made after the builder check (my call, all of them)

- **Resume output:** as described in 3.1. Existing entries print identically. Stored-only fields do not count as evidence for Auto cater or the match score. Auto cater and scoring already ignore behavioral cards, so moving them changes nothing there.
- **Old behavioral cards:** the migration copies each into the Interview data and leaves the original row in the database untouched and hidden from the Record, so it can be rolled back. A migrated answer's source entry is the job or project it was linked to, if any. The old text (description and details) is placed in the Action part, and the other three parts start empty; the user can split it up. Tags and extra data are kept as notes on the answer.
- **Source entries after a draft is accepted:** the answer stores the ids of the entries it was built from. If a source is edited, nothing happens; if it is deleted, the answer shows "source removed". No stale flag.
- **Drafting:** the AI fills the four STAR parts, about 150 words in total, in the first person; a part the Record cannot support is left empty rather than invented. The AI picks the Record entries. After drafting, the app checks the answer the same way resume bullets are checked (cited entries exist, every number appears in a cited entry, tools and skills named are in a cited entry) and drops a draft that fails, telling the user why. Approving a custom question just means saving it; the draft button is then available.
- **Built-in questions:** kept in code with stable ids; the database stores only which ids the user hid. The user can unhide. A later release can add questions without disturbing answers.
- **Add field menu:** a new entry starts with the default fields only. When editing, any field that has a value shows automatically, and the menu lists the rest.
- **Controlled values:** degree type, education status and employment type are pick lists with an "Other" free-text choice; skill level is a short pick list (Beginner, Intermediate, Advanced, Expert); "OK to contact" is yes or no; GPA is free text with a separate scale field; dates stay free text.

## 7. Left to the builder

- How the per-section fields and the "added field" choices are stored (a new column per field, or flexible per-entry data). The existing cards already have a flexible `extra` field.
- The exact wording of the built-in questions.
- How questions and answers are stored and how a drafted answer records its source entries.
- Visual design of the Add field menu and the Interview tab beyond the mockups in `.superpowers/brainstorm/`.
- Whether job fields use the same mechanism as card fields.
