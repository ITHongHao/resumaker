"""The Record field registry: shared/record-fields.json lists every field of every section.
The frontend renders forms from it; this module validates the stored `extra` against it."""

import json
from functools import lru_cache
from pathlib import Path

MAX_EXTRA_CHARS = 100
BACKEND_DIR = Path(__file__).resolve().parent.parent
FIELDS_PATH = BACKEND_DIR.parent / "shared" / "record-fields.json"


@lru_cache(maxsize=1)
def load() -> dict[str, list[dict]]:
    return json.loads(FIELDS_PATH.read_text(encoding="utf-8"))


def _extra_fields(section: str) -> list[dict]:
    """Fields stored in `extra` (everything except real table columns)."""
    return [f for f in load().get(section, []) if not f.get("column")]


def extra_keys(section: str) -> frozenset[str]:
    """Keys of the fields stored in `extra` (excludes table columns)."""
    return frozenset(f["key"] for f in _extra_fields(section))


def keys(section: str) -> tuple[str, ...]:
    return tuple(f["key"] for f in load().get(section, []))


def printed_keys(section: str) -> tuple[str, ...]:
    """The `extra` keys the resume prints for this section."""
    return tuple(f["key"] for f in _extra_fields(section) if f.get("printed"))


def clean_extra(section: str, extra: dict) -> dict:
    """Known keys become stripped strings capped at MAX_EXTRA_CHARS, empties dropped, yesno
    values only "yes"/"no" (any case, stored lowercase). Unknown keys pass through untouched."""
    known = {f["key"]: f for f in _extra_fields(section)}
    out = {}
    for key, value in extra.items():
        field = known.get(key)
        if field is None:
            out[key] = value
            continue
        if not isinstance(value, str):
            continue
        value = value.strip()[:MAX_EXTRA_CHARS]
        if field["type"] == "yesno":
            value = value.lower()
            if value not in ("yes", "no"):
                continue
        if not value:
            continue
        out[key] = value
    return out
