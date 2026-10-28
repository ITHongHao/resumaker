from typing import NamedTuple


class BuiltinQuestion(NamedTuple):
    key: str
    text: str
    category: str


CATEGORIES: tuple[str, ...] = (
    "Leadership",
    "Teamwork and conflict",
    "Failure and learning",
    "Initiative",
    "Pressure and deadlines",
    "Technical experience",
)

_L, _T, _F, _I, _P, _X = CATEGORIES

BUILTIN: list[BuiltinQuestion] = [
    BuiltinQuestion("lead-project", "Tell me about a time you led a project from start to finish.", _L),
    BuiltinQuestion("lead-without-authority", "Describe a time you led others without formal authority.", _L),
    BuiltinQuestion("lead-motivate", "Tell me about a time you motivated a team through a difficult stretch.", _L),
    BuiltinQuestion("lead-hard-decision", "Describe a hard decision you made for your team and how you made it.", _L),
    BuiltinQuestion("lead-mentor", "Tell me about a time you mentored or coached a teammate.", _L),
    BuiltinQuestion("team-conflict", "Tell me about a conflict with a teammate and how you resolved it.", _T),
    BuiltinQuestion("team-disagree-manager", "Describe a time you disagreed with your manager.", _T),
    BuiltinQuestion("team-difficult-person", "Tell me about working with someone difficult.", _T),
    BuiltinQuestion("team-cross-functional", "Describe a time you worked with people outside your own team or discipline.", _T),
    BuiltinQuestion("team-persuade", "Tell me about a time you persuaded others to adopt your idea.", _T),
    BuiltinQuestion("fail-biggest", "Tell me about your biggest professional failure.", _F),
    BuiltinQuestion("fail-mistake-shipped", "Describe a mistake that reached production or users and how you handled it.", _F),
    BuiltinQuestion("fail-feedback", "Tell me about tough feedback you received and what you did with it.", _F),
    BuiltinQuestion("fail-wrong-call", "Describe a time you were wrong about a technical or product decision.", _F),
    BuiltinQuestion("fail-learn-fast", "Tell me about a time you had to learn something new quickly.", _F),
    BuiltinQuestion("init-beyond-role", "Tell me about a time you went beyond your job description.", _I),
    BuiltinQuestion("init-spotted-problem", "Describe a problem you noticed and fixed without being asked.", _I),
    BuiltinQuestion("init-improve-process", "Tell me about a process or tool you improved.", _I),
    BuiltinQuestion("init-ambiguity", "Describe a time you took on a vague or undefined problem.", _I),
    BuiltinQuestion("init-proud", "What accomplishment are you most proud of, and why?", _I),
    BuiltinQuestion("press-tight-deadline", "Tell me about a time you met a tight deadline.", _P),
    BuiltinQuestion("press-competing-priorities", "Describe how you handled several competing priorities.", _P),
    BuiltinQuestion("press-outage", "Tell me about a time something broke under pressure and you had to fix it.", _P),
    BuiltinQuestion("press-cut-scope", "Describe a time you had to cut scope or make a tradeoff to ship on time.", _P),
    BuiltinQuestion("press-push-back", "Tell me about a time you pushed back on an unrealistic deadline.", _P),
    BuiltinQuestion("most-technical", "What is the most technical thing you have built?", _X),
    BuiltinQuestion("tech-hardest-bug", "Tell me about the hardest bug you have tracked down.", _X),
    BuiltinQuestion("tech-design-tradeoffs", "Describe a system you designed and the tradeoffs you made.", _X),
    BuiltinQuestion("tech-explain-nontechnical", "Tell me about a time you explained a technical idea to a non-technical audience.", _X),
    BuiltinQuestion("tech-performance", "Describe a time you improved the performance or reliability of a system.", _X),
    BuiltinQuestion("tech-new-technology", "Tell me about choosing or adopting a new technology.", _X),
]

_BY_KEY = {q.key: q for q in BUILTIN}


def builtin_for_ref(ref: str) -> BuiltinQuestion | None:
    return _BY_KEY.get(ref[2:]) if ref.startswith("b:") else None
