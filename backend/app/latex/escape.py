"""LaTeX escaping for user-supplied text and URLs."""

import re

# Single pass: each character is looked up once, so a backslash is never
# re-escaped by a later rule.
_SPECIALS = {
    "\\": r"\textbackslash{}",
    "&": r"\&",
    "%": r"\%",
    "$": r"\$",
    "#": r"\#",
    "_": r"\_",
    "{": r"\{",
    "}": r"\}",
    "~": r"\textasciitilde{}",
    "^": r"\textasciicircum{}",
}
_SPECIAL_RE = re.compile("[" + re.escape("".join(_SPECIALS)) + "]")
# Whitespace-like controls (and Unicode line/paragraph separators) become a space;
# the remaining C0/C1 controls are dropped.
_SPACE_RE = re.compile(r"[\s  \x85]+")
_CONTROL_RE = re.compile(r"[\x00-\x08\x0b-\x1f\x7f-\x84\x86-\x9f]")


def escape_latex(s: str) -> str:
    """Escape `s` for use inside a LaTeX argument. Always returns a single line."""
    s = _CONTROL_RE.sub("", s)
    s = _SPACE_RE.sub(" ", s).strip()
    return _SPECIAL_RE.sub(lambda m: _SPECIALS[m.group()], s)


# Characters that cannot be left raw in an \href argument; percent-encoded instead.
_URL_ENCODE = {c: f"%{ord(c):02X}" for c in ' {}^$"<>|`'}
_URL_ESCAPE = {c: "\\" + c for c in "%#_&~"}
_SCHEME_RE = re.compile(r"^([A-Za-z][A-Za-z0-9+.-]*):")
_BAD_URL_RE = re.compile(r"[\x00-\x1f\x7f\\  \x85]")


def safe_url(url: str) -> str | None:
    """Return `url` made safe for \\href{...}, or None when it must not be linked.

    Rejects control characters/newlines and backslashes, and any scheme other
    than http(s)/mailto. A bare `github.com/x` gets `https://` prepended.
    """
    url = url.strip()
    if not url or _BAD_URL_RE.search(url):
        return None
    m = _SCHEME_RE.match(url)
    # "host:8080/path" looks like a scheme; treat digits-after-colon as a port.
    if m and not re.match(r"^[^/:]+:\d", url):
        if m.group(1).lower() not in ("http", "https", "mailto"):
            return None
    else:
        url = "https://" + url
    url = "".join(_URL_ENCODE.get(c, c) for c in url)
    return "".join(_URL_ESCAPE.get(c, c) for c in url)
