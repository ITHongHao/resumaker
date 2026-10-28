"""Render a resume in Jake's Resume LaTeX template.

The preamble and macros are vendored from "Jake's Resume":
  Source:  https://github.com/jakegut/resume (resume.tex), based on
           https://github.com/sb2nov/resume
  Author:  Jake Gutierrez
  Licence: MIT
Only the preamble/macros are kept; the sample content is dropped. The one change
is that `glyphtounicode` is guarded with \\ifdefined: it relies on pdfTeX
primitives that Tectonic's XeTeX engine does not define (XeTeX already emits
Unicode text mappings itself, so ATS text extraction is unaffected).

Output contract (Task 11 maps suggestions to lines): each bullet is its own
`\\resumeItem{...}` line, in the order given. Empty sections are omitted.
"""

from dataclasses import dataclass

from app.latex.escape import escape_latex, safe_url
from app.models import Card, Job, Profile

JAKE_PREAMBLE = r"""%-------------------------
% Resume in Latex
% Author : Jake Gutierrez
% Based off of: https://github.com/sb2nov/resume
% License : MIT
% Source: https://github.com/jakegut/resume
%------------------------

\documentclass[letterpaper,11pt]{article}

\usepackage{latexsym}
\usepackage[empty]{fullpage}
\usepackage{titlesec}
\usepackage{marvosym}
\usepackage[usenames,dvipsnames]{color}
\usepackage{verbatim}
\usepackage{enumitem}
\usepackage[hidelinks]{hyperref}
\usepackage{fancyhdr}
\usepackage[english]{babel}
\usepackage{tabularx}
% glyphtounicode needs pdfTeX primitives; skip it under XeTeX (Tectonic).
\ifdefined\pdfgentounicode
\input{glyphtounicode}
\fi

\pagestyle{fancy}
\fancyhf{} % clear all header and footer fields
\fancyfoot{}
\renewcommand{\headrulewidth}{0pt}
\renewcommand{\footrulewidth}{0pt}

% Adjust margins
\addtolength{\oddsidemargin}{-0.5in}
\addtolength{\evensidemargin}{-0.5in}
\addtolength{\textwidth}{1in}
\addtolength{\topmargin}{-.5in}
\addtolength{\textheight}{1.0in}

\urlstyle{same}

\raggedbottom
\raggedright
\setlength{\tabcolsep}{0in}

% Sections formatting
\titleformat{\section}{
  \vspace{-4pt}\scshape\raggedright\large
}{}{0em}{}[\color{black}\titlerule \vspace{-5pt}]

% Ensure that generate pdf is machine readable/ATS parsable
\ifdefined\pdfgentounicode
\pdfgentounicode=1
\fi

%-------------------------
% Custom commands
\newcommand{\resumeItem}[1]{
  \item\small{
    {#1 \vspace{-2pt}}
  }
}

\newcommand{\resumeSubheading}[4]{
  \vspace{-2pt}\item
    \begin{tabular*}{0.97\textwidth}[t]{l@{\extracolsep{\fill}}r}
      \textbf{#1} & #2 \\
      \textit{\small#3} & \textit{\small #4} \\
    \end{tabular*}\vspace{-7pt}
}

\newcommand{\resumeSubSubheading}[2]{
    \item
    \begin{tabular*}{0.97\textwidth}{l@{\extracolsep{\fill}}r}
      \textit{\small#1} & \textit{\small #2} \\
    \end{tabular*}\vspace{-7pt}
}

\newcommand{\resumeProjectHeading}[2]{
    \item
    \begin{tabular*}{0.97\textwidth}{l@{\extracolsep{\fill}}r}
      \small#1 & #2 \\
    \end{tabular*}\vspace{-7pt}
}

\newcommand{\resumeSubItem}[1]{\resumeItem{#1}\vspace{-4pt}}

\renewcommand\labelitemii{$\vcenter{\hbox{\tiny$\bullet$}}$}

\newcommand{\resumeSubHeadingListStart}{\begin{itemize}[leftmargin=0.15in, label={}]}
\newcommand{\resumeSubHeadingListEnd}{\end{itemize}}
\newcommand{\resumeItemListStart}{\begin{itemize}}
\newcommand{\resumeItemListEnd}{\end{itemize}\vspace{-5pt}}

%-------------------------------------------
%%%%%%  RESUME STARTS HERE  %%%%%%%%%%%%%%%%%%%%%%%%%%%%
"""


@dataclass
class Bullet:
    """One resume bullet. `section` is "experience" (job_id set) or "projects"
    (source_card_id is the project card)."""

    section: str
    job_id: int | None
    text: str
    source_card_id: int


def _e(v) -> str:
    return escape_latex("" if v is None else str(v))


def _extra(card: Card, key: str) -> str:
    return str((card.extra or {}).get(key) or "")


def _dates(start: str, end: str) -> str:
    start, end = (start or "").strip(), (end or "").strip()
    if start and end:
        return f"{_e(start)} -- {_e(end)}"
    if start:
        return f"{_e(start)} -- Present"
    return _e(end)


def _link(url: str, label: str) -> str:
    safe = safe_url(url)
    shown = escape_latex(label)
    if safe is None:
        return shown
    return rf"\href{{{safe}}}{{\underline{{{shown}}}}}"


def _display_url(url: str) -> str:
    u = url.strip()
    for p in ("https://", "http://", "mailto:"):
        if u.lower().startswith(p):
            return u[len(p):].rstrip("/")
    return u.rstrip("/")


def _heading(profile: Profile) -> list[str]:
    parts = []
    if profile.phone.strip():
        parts.append(_e(profile.phone))
    if profile.email.strip():
        email = profile.email.strip()
        parts.append(_link(f"mailto:{email}", email))
    for url in profile.links or []:
        if str(url).strip():
            parts.append(_link(str(url), _display_url(str(url))))
    lines = [r"\begin{center}",
             rf"    \textbf{{\Huge \scshape {_e(profile.name)}}} \\ \vspace{{1pt}}"]
    if parts:
        lines.append(r"    \small " + " $|$ ".join(parts))
    lines.append(r"\end{center}")
    return lines


def _items(texts: list[str], indent: str) -> list[str]:
    if not texts:
        return []
    return ([indent + r"\resumeItemListStart"]
            + [f"{indent}  \\resumeItem{{{_e(t)}}}" for t in texts]
            + [indent + r"\resumeItemListEnd"])


def _education(cards: list[Card]) -> list[str]:
    if not cards:
        return []
    out = [r"\section{Education}", r"  \resumeSubHeadingListStart"]
    for c in cards:
        out += [r"    \resumeSubheading",
                f"      {{{_e(c.title)}}}{{{_e(_extra(c, 'location'))}}}",
                f"      {{{_e(c.description)}}}"
                f"{{{_dates(_extra(c, 'start_date'), _extra(c, 'end_date'))}}}"]
    out.append(r"  \resumeSubHeadingListEnd")
    return out


def _experience(jobs: list[Job], bullets: list[Bullet]) -> list[str]:
    if not jobs:
        return []
    out = [r"\section{Experience}", r"  \resumeSubHeadingListStart"]
    for j in jobs:
        texts = [b.text for b in bullets if b.section == "experience" and b.job_id == j.id]
        out += [r"    \resumeSubheading",
                f"      {{{_e(j.title)}}}{{{_dates(j.start_date, j.end_date)}}}",
                f"      {{{_e(j.company)}}}{{{_e(j.location)}}}"]
        out += _items(texts, "      ")
    out.append(r"  \resumeSubHeadingListEnd")
    return out


def _projects(cards: list[Card], bullets: list[Bullet]) -> list[str]:
    if not cards:
        return []
    out = [r"\section{Projects}", r"  \resumeSubHeadingListStart"]
    for c in cards:
        texts = [b.text for b in bullets
                 if b.section == "projects" and b.source_card_id == c.id]
        stack = ", ".join(_e(t) for t in (c.tags or []) if str(t).strip())
        head = rf"\textbf{{{_e(c.title)}}}"
        if stack:
            head += rf" $|$ \emph{{{stack}}}"
        out += [r"    \resumeProjectHeading",
                f"      {{{head}}}"
                f"{{{_dates(_extra(c, 'start_date'), _extra(c, 'end_date'))}}}"]
        out += _items(texts, "      ")
    out.append(r"  \resumeSubHeadingListEnd")
    return out


def _skills(cards: list[Card]) -> list[str]:
    groups: dict[str, list[str]] = {}
    for c in cards:
        if not c.title.strip():
            continue
        groups.setdefault(_extra(c, "category").strip() or "Skills", []).append(c.title)
    if not groups:
        return []
    rows = [rf"     \textbf{{{_e(cat)}}}{{: {', '.join(_e(s) for s in names)}}}"
            for cat, names in groups.items()]
    body = " \\\\\n".join(rows)
    return [r"\section{Technical Skills}",
            r" \begin{itemize}[leftmargin=0.15in, label={}]",
            r"    \small{\item{",
            body,
            r"    }}",
            r" \end{itemize}"]


def _certifications(cards: list[Card]) -> list[str]:
    if not cards:
        return []
    out = [r"\section{Certifications}", r"  \resumeSubHeadingListStart"]
    for c in cards:
        head = _e(c.title) + (f" $|$ \\emph{{{_e(c.description)}}}" if c.description.strip() else "")
        out += [r"    \resumeProjectHeading",
                f"      {{\\textbf{{{head}}}}}{{{_e(_extra(c, 'date'))}}}"]
    out.append(r"  \resumeSubHeadingListEnd")
    return out


def render_tex(
    profile: Profile,
    jobs: list[Job],
    bullets: list[Bullet],
    cards_by_section: dict,
) -> str:
    """cards_by_section keys: education, projects, skills, certifications."""
    cards = cards_by_section
    sections = [
        _education(cards.get("education", [])),
        _experience(jobs, bullets),
        _projects(cards.get("projects", []), bullets),
        _skills(cards.get("skills", [])),
        _certifications(cards.get("certifications", cards.get("certificates", []))),
    ]
    body = _heading(profile)
    for s in sections:
        if s:
            body += ["", *s]
    return (JAKE_PREAMBLE + "\n\\begin{document}\n\n" + "\n".join(body)
            + "\n\n\\end{document}\n")
