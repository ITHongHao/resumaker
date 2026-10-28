"""Deterministic stand-in LLM for end-to-end tests and demos.

Enabled only by the process environment variable RESUMAKER_FAKE_LLM=1 (see provider.get_llm).
It makes no network calls. Its output is schema-valid JSON written from the prompt contents
only, and it obeys the same provenance rules the real checks enforce (cards cited by real id,
numbers and terms only from the card), so the end-to-end run exercises those checks rather
than bypassing them.
"""

import json
import re

# Known terms the posting extractor recognises: (term, kind).
LEXICON = [
    ("Python", "skill"), ("SQL", "skill"), ("TypeScript", "skill"), ("JavaScript", "skill"),
    ("Machine Learning", "skill"), ("Leadership", "skill"),
    ("React", "tool"), ("Docker", "tool"), ("Kubernetes", "tool"), ("PostgreSQL", "tool"),
    ("AWS", "tool"), ("FastAPI", "tool"), ("Git", "tool"),
]
MAX_DESCRIPTION_CHARS = 200


def _section(prompt: str, header: str):
    """The JSON value that follows `header` + newline in the prompt, or None."""
    i = prompt.find(header)
    if i < 0:
        return None
    start = prompt.index("\n", i) + 1
    try:
        return json.JSONDecoder().raw_decode(prompt[start:])[0]
    except ValueError:
        return None


def _sentence(text: str) -> str:
    text = re.sub(r"\s+", " ", text).strip().rstrip(".")
    return text[:MAX_DESCRIPTION_CHARS].rstrip()


def _bullet(card: dict) -> str:
    return f"Worked on {_sentence(card['title'])}"


def _expanded(card: dict) -> str:
    desc = _sentence(card.get("description") or card.get("details") or "")
    return f"{_bullet(card)}: {desc}" if desc else _bullet(card)


class FakeLLM:
    def complete(self, system, user, images=[], json_schema=None) -> str:
        # Imported here: these modules import provider, which lazily imports this one.
        from app import cater
        from app.ai import askai
        from app.postings import extract

        if system == askai.SYSTEM_PROMPT:
            return json.dumps(self._propose(user))
        if system == extract.SYSTEM_PROMPT:
            return json.dumps(self._extract(user))
        if system == cater.CATER_SYSTEM_PROMPT:
            return json.dumps(self._cater(user))
        if system == cater.SUGGEST_SYSTEM_PROMPT:
            return json.dumps(self._suggest(user))
        raise ValueError("FakeLLM does not know this prompt")

    def _propose(self, user: str) -> dict:
        message = user.split("User's new message:\n", 1)[-1].strip()
        if len(message.split()) < 5:
            return {"reply": "Tell me a bit more about what you did.", "proposals": [],
                    "followups": ["What did you build or change, and what was the result?"]}
        title = " ".join(message.split()[:6]).rstrip(".,;:")
        followups = [] if re.search(r"\d", message) else ["Do you have a number for the result?"]
        return {
            "reply": "Here is a card from what you told me.",
            "proposals": [{"kind": "accomplishment", "title": title,
                           "description": _sentence(message) + ".", "tags": []}],
            "followups": followups,
        }

    def _extract(self, user: str) -> dict:
        text = user.split("Job posting text:\n", 1)[1] if "Job posting text:\n" in user else ""
        title = company = ""
        if m := re.search(r"^Title:\s*(.+)$", text, re.M):
            title = m.group(1).strip()
        if m := re.search(r"^Company:\s*(.+)$", text, re.M):
            company = m.group(1).strip()
        reqs = []
        for term, kind in LEXICON:
            m = re.search(rf"(?<![A-Za-z0-9]){re.escape(term)}(?![A-Za-z0-9])", text, re.I)
            if not m:
                continue
            line = text[text.rfind("\n", 0, m.start()) + 1: text.find("\n", m.end()) % (len(text) + 1)]
            low = line.lower()
            weight = 1 if "nice to have" in low or "bonus" in low else 3 if re.search(r"required|must", low) else 2
            reqs.append({"term": term, "kind": kind, "weight": weight})
        return {"title": title, "company": company, "requirements": reqs}

    def _cater(self, user: str) -> dict:
        cards = _section(user, "Cards (the only facts you may use):") or []
        return {"bullets": [{"source_card_id": c["id"], "text": _bullet(c)} for c in cards]}

    def _suggest(self, user: str) -> dict:
        rows = _section(user, "Bullets that could cover them:") or []
        cards = {c["id"]: c for c in _section(user, "Their source cards (the only facts you may use):") or []}
        out = []
        for r in rows:
            card = cards.get(r["source_card_id"])
            if card is None:
                continue
            out.append({"bullet_index": r["bullet_index"], "new": _expanded(card),
                        "terms": r["terms_its_card_supports"], "source_card_id": card["id"]})
        return {"suggestions": out}
