"""Deterministic requirement match score. Pure Python: no AI, network or database."""

import re
from typing import Literal

from pydantic import BaseModel

from app.models import Requirement

Status = Literal["matched", "partial", "missing"]


class RequirementMatch(BaseModel):
    term: str
    status: Status


class ScoreResult(BaseModel):
    score: int
    matches: list[RequirementMatch]


# Each group lists interchangeable spellings (lowercase, space-separated).
ALIAS_GROUPS: list[tuple[str, ...]] = [
    ("pytorch", "torch"),
    ("javascript", "js"),
    ("typescript", "ts"),
    ("kubernetes", "k8s"),
    ("postgresql", "postgres"),
    ("machine learning", "ml"),
    ("node.js", "nodejs"),
    ("amazon web services", "aws"),
    ("continuous integration", "ci"),
]

# Longest first so "ments" wins over "s".
STEM_SUFFIXES = ("ments", "ment", "ings", "ing", "ers", "er", "ed", "es", "s")
MIN_STEM_LEN = 4


# --- LaTeX cleanup -----------------------------------------------------------

_COMMENT_OR_ESCAPE = re.compile(r"\\.|%[^\n]*", re.DOTALL)
_LATEX_TOKEN = re.compile(r"\\([%&#$_{}])|\\[a-zA-Z]+\*?|\\.|[{}]", re.DOTALL)


def strip_latex(text: str) -> str:
    """Drop comments and command names, keep argument text and escaped literals."""
    no_comments = _COMMENT_OR_ESCAPE.sub(lambda m: m.group(0) if m.group(0).startswith("\\") else "", text)
    return _LATEX_TOKEN.sub(lambda m: m.group(1) or " ", no_comments)


# --- Matching ----------------------------------------------------------------


def _norm(term: str) -> str:
    return re.sub(r"[\s\-]+", " ", term.strip().lower())


def _exact_pattern(norm_term: str) -> re.Pattern[str]:
    body = r"[\s\-]+".join(re.escape(w) for w in norm_term.split(" "))
    # Alphanumeric lookarounds instead of \b so "C++", "C#", ".NET" behave.
    # A leading "." after a word char (".js" in "Node.js") is not a word start.
    before = r"(?<![a-z0-9])(?<![a-z0-9]\.)" if norm_term[0].isalnum() else r"(?<![a-z0-9])"
    # "C" must not match inside "C++" or "C#".
    after = r"(?![a-z0-9+#])" if norm_term[-1].isalnum() else r"(?![a-z0-9])"
    return re.compile(before + body + after)


def _stem(word: str) -> str:
    for suffix in STEM_SUFFIXES:
        if word.endswith(suffix) and len(word) - len(suffix) >= MIN_STEM_LEN:
            word = word[: -len(suffix)]
            break
    if word.endswith("e") and len(word) > MIN_STEM_LEN:
        word = word[:-1]
    return word


def _stem_tokens(text: str) -> list[str]:
    return [_stem(t) for t in re.findall(r"[a-z0-9]+", text)]


def _has_exact(norm_term: str, text: str) -> bool:
    return _exact_pattern(norm_term).search(text) is not None


def _status(term: str, text: str, stemmed_text: str) -> Status:
    norm = _norm(term)
    if not norm:
        return "missing"
    if _has_exact(norm, text):
        return "matched"
    for group in ALIAS_GROUPS:
        if norm in group and any(_has_exact(other, text) for other in group if other != norm):
            return "partial"
    # Stem fallback only for plain word terms (no punctuation like C++ / .NET).
    if re.fullmatch(r"[a-z0-9]+( [a-z0-9]+)*", norm) and len(norm.replace(" ", "")) >= 3:
        needle = " ".join(_stem_tokens(norm))
        if f" {needle} " in stemmed_text:
            return "partial"
    return "missing"


def _stemmed(lower_text: str) -> str:
    return " " + " ".join(_stem_tokens(lower_text)) + " "


def match_status(term: str, text: str) -> Status:
    """Status of one term in plain (non-LaTeX) text, under the same rules as score()."""
    lower = text.lower()
    return _status(term, lower, _stemmed(lower))


def score(requirements: list[Requirement], resume_text: str) -> ScoreResult:
    text = strip_latex(resume_text).lower()
    stemmed_text = _stemmed(text)
    matches = [RequirementMatch(term=r.term, status=_status(r.term, text, stemmed_text)) for r in requirements]

    total = sum(r.weight for r in requirements)
    if total == 0:
        return ScoreResult(score=0, matches=matches)
    # matched counts 2 half-units, partial 1; score = units / (2 * total) * 100, rounded half up.
    units = sum(r.weight * {"matched": 2, "partial": 1, "missing": 0}[m.status] for r, m in zip(requirements, matches))
    return ScoreResult(score=(units * 100 + total) // (2 * total), matches=matches)


def potential_score(requirements: list[Requirement], resume_text: str, replacements: list[tuple[str, str]]) -> int:
    """Score if each (old, new) replacement were applied (first occurrence, in order)."""
    text = resume_text
    for old, new in replacements:
        if old and old in text:
            text = text.replace(old, new, 1)
    return score(requirements, text).score
