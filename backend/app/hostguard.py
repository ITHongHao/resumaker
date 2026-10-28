"""Refuse requests that a web page on another site (or a DNS-rebinding host name) could make.

The API has no authentication: it trusts that only the user's own browser tab, served from
this machine, talks to it. This pure ASGI middleware runs before routing, so a refused request
reaches no route, dependency or error handler and has no side effect. It rejects with 403 when:

- the Host header's host name is not loopback (localhost, 127.0.0.1, [::1]) or "testserver"
  (FastAPI's TestClient), plus any names in RESUMAKER_ALLOWED_HOSTS (comma-separated, additive);
  any port is accepted;
- a request other than GET/HEAD/OPTIONS carries an Origin whose host name is not in that set
  (including "null");
- a request other than GET/HEAD/OPTIONS has no Origin but says Sec-Fetch-Site: cross-site.

No CORS headers are ever added.
"""

import json
import os
from urllib.parse import urlsplit

DEFAULT_HOSTS = frozenset({"localhost", "127.0.0.1", "::1", "testserver"})
SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})
ENV_VAR = "RESUMAKER_ALLOWED_HOSTS"


def _hostname(netloc_or_url: str, *, url: bool) -> str | None:
    """Lowercase host name without port or IPv6 brackets, or None if there is none."""
    try:
        parts = urlsplit(netloc_or_url if url else "//" + netloc_or_url)
        return parts.hostname or None  # urlsplit lowercases and strips [ ]
    except ValueError:
        return None


def allowed_hosts() -> frozenset[str]:
    extra = set()
    for item in os.environ.get(ENV_VAR, "").split(","):
        name = _hostname(item.strip(), url=False) if item.strip() else None
        if name:
            extra.add(name)
    return DEFAULT_HOSTS | extra


class HostOriginGuard:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] not in ("http", "websocket"):
            return await self.app(scope, receive, send)
        reason = self._check(scope)
        if reason is None:
            return await self.app(scope, receive, send)
        if scope["type"] == "websocket":
            await send({"type": "websocket.close", "code": 1008})
            return
        body = json.dumps({"detail": reason}).encode()
        await send({"type": "http.response.start", "status": 403,
                    "headers": [(b"content-type", b"application/json"),
                                (b"content-length", str(len(body)).encode())]})
        await send({"type": "http.response.body", "body": body})

    @staticmethod
    def _check(scope) -> str | None:
        headers: dict[str, str] = {}
        for k, v in scope.get("headers", []):
            headers.setdefault(k.decode("latin-1").lower(), v.decode("latin-1"))
        hosts = allowed_hosts()
        host = _hostname(headers.get("host", ""), url=False) if headers.get("host") else None
        if host not in hosts:
            return "Forbidden: Resumaker only answers requests addressed to localhost."
        method = scope.get("method", "GET").upper()
        if method in SAFE_METHODS:
            return None
        origin = headers.get("origin")
        if origin is not None:
            if _hostname(origin.strip(), url=True) not in hosts:
                return "Forbidden: requests from other sites are not allowed."
            return None
        if headers.get("sec-fetch-site", "").strip().lower() == "cross-site":
            return "Forbidden: requests from other sites are not allowed."
        return None
