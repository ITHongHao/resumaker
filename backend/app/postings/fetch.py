"""Fetch a job posting URL and reduce it to plain text. Never used for anything but a
URL the user submitted."""

from urllib.parse import urljoin, urlsplit

import httpx
from bs4 import BeautifulSoup

TIMEOUT_SECONDS = 10.0
MAX_REDIRECTS = 5
MAX_BYTES = 2 * 1024 * 1024
MIN_TEXT_CHARS = 200  # less than this is almost surely a JS shell or a login wall
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)
_DROP_TAGS = ["script", "style", "noscript", "template", "nav", "footer", "header", "aside", "svg", "form"]


class FetchError(Exception):
    """The posting could not be fetched or had no usable text. Messages are user-safe."""


def html_to_text(html: str | bytes) -> str:
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(_DROP_TAGS):
        tag.decompose()
    lines = (" ".join(line.split()) for line in soup.get_text("\n").splitlines())
    return "\n".join(line for line in lines if line)


def _check_scheme(url: str) -> None:
    if urlsplit(url).scheme.lower() not in ("http", "https") or not urlsplit(url).netloc:
        raise FetchError("Only http and https links can be fetched.")


def _get(client: httpx.Client, url: str) -> bytes:
    for _ in range(MAX_REDIRECTS + 1):
        _check_scheme(url)
        with client.stream(
            "GET", url, headers={"User-Agent": USER_AGENT, "Accept": "text/html,*/*;q=0.8"}
        ) as resp:
            if resp.is_redirect:
                location = resp.headers.get("location")
                if not location:
                    raise FetchError("The site sent a broken redirect.")
                url = urljoin(url, location)
                continue
            if resp.status_code >= 400:
                raise FetchError(f"The site refused the request (HTTP {resp.status_code}).")
            ctype = resp.headers.get("content-type", "text/html").lower()
            if "html" not in ctype:
                raise FetchError("That link is not a web page.")
            body = bytearray()
            for chunk in resp.iter_bytes():
                body += chunk
                if len(body) > MAX_BYTES:
                    raise FetchError("That page is too large.")
            return bytes(body)
    raise FetchError("The link redirected too many times.")


def fetch_url(url: str, client: httpx.Client | None = None) -> str:
    url = url.strip()
    _check_scheme(url)
    own = client is None
    client = client or httpx.Client(timeout=TIMEOUT_SECONDS, follow_redirects=False)
    try:
        body = _get(client, url)
    except httpx.TimeoutException:
        raise FetchError("The site took too long to respond.") from None
    except httpx.HTTPError:
        raise FetchError("The site could not be reached.") from None
    finally:
        if own:
            client.close()
    text = html_to_text(body)
    if len(text) < MIN_TEXT_CHARS:
        raise FetchError("The page has too little readable text (it may need JavaScript or a login).")
    return text
