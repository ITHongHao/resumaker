import json
from typing import get_args

from pydantic import BaseModel, ValidationError

from app.ai.provider import LLM, AIError
from app.models import CardKind, Job

SYSTEM_PROMPT = """You help a job seeker turn what they tell you into resume Record cards.
You only PROPOSE cards; the user decides what to keep.

Rules:
- Propose only what the user actually said. Never invent employers, job titles, dates, numbers, metrics, tools, or results.
- If a result or number is missing (how much, how many, how fast, what changed), do NOT make one up. Add a short follow-up question to "followups" asking for it, and keep the draft wording free of any figure the user did not give.
- If the message holds nothing concrete enough for a card, return no proposals and ask follow-up questions instead.
- Each card has a kind (project, accomplishment, education, skill, certificate, behavioral), a short title, a one or two sentence description in plain factual language, and optional tags.
- "reply" is a brief, friendly note to the user.
Respond with JSON only."""

_KINDS = list(get_args(CardKind))

RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "reply": {"type": "string"},
        "proposals": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "kind": {"type": "string", "enum": _KINDS},
                    "title": {"type": "string"},
                    "description": {"type": "string"},
                    "tags": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["kind", "title", "description", "tags"],
                "additionalProperties": False,
            },
        },
        "followups": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["reply", "proposals", "followups"],
    "additionalProperties": False,
}


class CardDraft(BaseModel):
    kind: CardKind
    title: str
    description: str = ""
    tags: list[str] = []
    extra: dict = {}


class ProposalReply(BaseModel):
    reply: str
    proposals: list[CardDraft] = []
    followups: list[str] = []


def _user_prompt(message: str, job: Job | None, history: list[dict]) -> str:
    parts = []
    if job is not None:
        parts.append(f"Job being discussed: {job.title} at {job.company}")
    if history:
        lines = [f"{h.get('role', 'user')}: {h.get('content', '')}" for h in history]
        parts.append("Conversation so far:\n" + "\n".join(lines))
    parts.append("User's new message:\n" + message)
    return "\n\n".join(parts)


def propose_cards(llm: LLM, message: str, job: Job | None, history: list[dict]) -> ProposalReply:
    raw = llm.complete(SYSTEM_PROMPT, _user_prompt(message, job, history), json_schema=RESPONSE_SCHEMA)
    try:
        return ProposalReply.model_validate(json.loads(raw))
    except (ValueError, ValidationError):
        raise AIError("The AI returned a response that could not be understood.") from None
