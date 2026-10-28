import json

import httpx
import pytest

from app.ai.provider import AIError
from app.main import app
from app.postings.extract import extract_requirements
from app.postings.fetch import FetchError, fetch_url
from app.routes.ai import llm_dep
from app.routes.postings import http_client_dep

GOOD = json.dumps(
    {
        "title": "Backend Engineer",
        "company": "Acme",
        "requirements": [
            {"term": "Python", "kind": "skill", "weight": 3},
            {"term": "PostgreSQL", "kind": "tool", "weight": 2},
        ],
    }
)
EMPTY = json.dumps({"title": "", "company": "", "requirements": []})
PAGE = "<html><body><nav>Menu</nav><script>evil()</script><h1>Backend Engineer</h1><p>" + (
    "We need Python and PostgreSQL experience. " * 10
) + "</p><footer>Copyright</footer></body></html>"


class FakeLLM:
    def __init__(self, reply=GOOD):
        self.reply = reply
        self.calls = []

    def complete(self, system, user, images=[], json_schema=None):
        self.calls.append({"system": system, "user": user, "images": images, "schema": json_schema})
        return self.reply


@pytest.fixture
def use(client):
    def _use(llm=None, handler=None):
        if llm is not None:
            app.dependency_overrides[llm_dep] = lambda: llm
        if handler is not None:
            app.dependency_overrides[http_client_dep] = lambda: httpx.Client(
                transport=httpx.MockTransport(handler)
            )

    yield _use
    app.dependency_overrides.clear()


def mock_client(handler):
    return httpx.Client(transport=httpx.MockTransport(handler))


# --- route tests -------------------------------------------------------


def test_text_posting_extracts_requirements(client, use):
    llm = FakeLLM()
    use(llm)
    r = client.post("/api/postings", data={"text": "We want Python."})
    assert r.status_code == 200
    body = r.json()
    assert body["source_kind"] == "text" and body["title"] == "Backend Engineer"
    assert body["requirements"][0] == {"term": "Python", "kind": "skill", "weight": 3}
    assert "never invent" in llm.calls[0]["system"].lower()
    assert "We want Python." in llm.calls[0]["user"]
    assert client.get(f"/api/postings/{body['id']}").json()["raw_text"] == "We want Python."


def test_html_is_stripped_before_extraction(client, use):
    llm = FakeLLM()
    use(llm)
    r = client.post("/api/postings", data={"html": PAGE})
    assert r.status_code == 200 and r.json()["source_kind"] == "html"
    sent = llm.calls[0]["user"]
    assert "Python and PostgreSQL" in sent
    assert "evil()" not in sent and "Menu" not in sent and "Copyright" not in sent and "<p>" not in sent


def test_url_posting_fetches_then_extracts(client, use):
    llm = FakeLLM()
    use(llm, lambda req: httpx.Response(200, html=PAGE))
    r = client.post("/api/postings", data={"url": "https://example.com/job"})
    assert r.status_code == 200 and r.json()["source_kind"] == "url"
    assert "Python and PostgreSQL" in llm.calls[0]["user"]


def test_url_fetch_failure_returns_paste_text_fallback(client, use):
    llm = FakeLLM()
    use(llm, lambda req: httpx.Response(403, text="no"))
    r = client.post("/api/postings", data={"url": "https://example.com/job"})
    assert r.status_code == 422
    assert r.json()["fallback"] == "paste_text" and r.json()["detail"]
    assert llm.calls == []


def test_image_is_passed_to_llm(client, use):
    llm = FakeLLM()
    use(llm)
    png = b"\x89PNG\r\n\x1a\n" + b"0" * 20
    r = client.post("/api/postings", files={"image": ("p.png", png, "image/png")})
    assert r.status_code == 200 and r.json()["source_kind"] == "image"
    assert llm.calls[0]["images"] == [png]


def test_bad_image_type_rejected(client, use):
    use(FakeLLM())
    r = client.post("/api/postings", files={"image": ("p.gif", b"GIF89a", "image/gif")})
    assert r.status_code == 422


def test_no_requirements_found_returns_fallback_not_empty_posting(client, use):
    use(FakeLLM(EMPTY))
    r = client.post("/api/postings", data={"text": "Lorem ipsum"})
    assert r.status_code == 422 and r.json()["fallback"] == "paste_text"
    assert client.get("/api/postings").json() == []


@pytest.mark.parametrize(
    "data",
    [{"text": "a", "html": "<p>b</p>"}, {"url": "https://example.com", "text": "a"}, {}, {"text": "  "}],
)
def test_two_inputs_or_none_rejected(client, use, data):
    llm = FakeLLM()
    use(llm)
    assert client.post("/api/postings", data=data).status_code == 422
    assert llm.calls == []


def test_text_plus_image_rejected(client, use):
    use(FakeLLM())
    r = client.post(
        "/api/postings", data={"text": "a"}, files={"image": ("p.png", b"\x89PNG0000", "image/png")}
    )
    assert r.status_code == 422


def test_ai_error_is_502_and_missing_key_400(client, use):
    class Boom:
        def complete(self, *a, **k):
            raise AIError("The AI provider request failed.")

    use(Boom())
    r = client.post("/api/postings", data={"text": "x"})
    assert r.status_code == 502 and "failed" in r.json()["detail"]
    app.dependency_overrides.clear()
    assert client.post("/api/postings", data={"text": "x"}).status_code == 400


def test_list_and_delete(client, use):
    use(FakeLLM())
    pid = client.post("/api/postings", data={"text": "x"}).json()["id"]
    assert len(client.get("/api/postings").json()) == 1
    assert client.delete(f"/api/postings/{pid}").status_code == 204
    assert client.get(f"/api/postings/{pid}").status_code == 404


# --- extract unit tests ------------------------------------------------


def test_extract_malformed_output_raises_aierror():
    for bad in ["nope", '{"title": 1}', json.dumps({"requirements": [{"term": "a", "kind": "x", "weight": 1}]})]:
        with pytest.raises(AIError):
            extract_requirements(FakeLLM(bad), "text", [])


def test_extract_rejects_out_of_range_weight():
    bad = json.dumps({"title": "", "company": "", "requirements": [{"term": "a", "kind": "skill", "weight": 9}]})
    with pytest.raises(AIError):
        extract_requirements(FakeLLM(bad), "text", [])


def test_extract_caps_text_length():
    llm = FakeLLM()
    extract_requirements(llm, "x" * 50_000, [])
    assert len(llm.calls[0]["user"]) < 21_000


# --- fetch_url unit tests ----------------------------------------------


@pytest.mark.parametrize(
    "url", ["file:///etc/passwd", "ftp://x.com/a", "javascript:alert(1)", "data:text/html,hi", "//x.com", "not a url"]
)
def test_fetch_rejects_non_http_schemes_before_any_request(url):
    def handler(req):
        raise AssertionError("no request should be made")

    with pytest.raises(FetchError):
        fetch_url(url, client=mock_client(handler))


def test_fetch_returns_stripped_text():
    text = fetch_url("https://example.com/j", client=mock_client(lambda r: httpx.Response(200, html=PAGE)))
    assert "Python and PostgreSQL" in text and "evil" not in text and "Menu" not in text


def test_fetch_sends_browser_user_agent():
    seen = {}

    def handler(req):
        seen["ua"] = req.headers["user-agent"]
        return httpx.Response(200, html=PAGE)

    fetch_url("https://example.com", client=mock_client(handler))
    assert "Mozilla" in seen["ua"]


def test_fetch_follows_http_redirect_but_not_to_other_scheme():
    def ok(req):
        if req.url.path == "/a":
            return httpx.Response(302, headers={"location": "/b"})
        return httpx.Response(200, html=PAGE)

    assert "Python" in fetch_url("https://example.com/a", client=mock_client(ok))

    bad = lambda req: httpx.Response(302, headers={"location": "file:///etc/passwd"})  # noqa: E731
    with pytest.raises(FetchError):
        fetch_url("https://example.com/a", client=mock_client(bad))


def test_fetch_limits_redirects():
    loop = lambda req: httpx.Response(302, headers={"location": "/again"})  # noqa: E731
    with pytest.raises(FetchError):
        fetch_url("https://example.com/", client=mock_client(loop))


def test_fetch_errors():
    def timeout(req):
        raise httpx.ReadTimeout("slow")

    cases = [
        lambda r: httpx.Response(404, text="x"),
        lambda r: httpx.Response(500, text="x"),
        timeout,
        lambda r: httpx.Response(200, content=b"%PDF", headers={"content-type": "application/pdf"}),
        lambda r: httpx.Response(200, html="<html><body><div id='root'></div></body></html>"),
        lambda r: httpx.Response(200, content=b"<p>" + b"a" * 3_000_000, headers={"content-type": "text/html"}),
    ]
    for h in cases:
        with pytest.raises(FetchError):
            fetch_url("https://example.com", client=mock_client(h))


# --- requirement normalization -----------------------------------------


def _reply(reqs):
    return json.dumps({"title": "T", "company": "C", "requirements": reqs})


def _req(term, weight=1, kind="skill"):
    return {"term": term, "kind": kind, "weight": weight}


def test_blank_term_only_reply_returns_fallback_and_saves_nothing(client, use):
    use(FakeLLM(_reply([_req(""), _req("   ")])))
    r = client.post("/api/postings", data={"text": "x"})
    assert r.status_code == 422 and r.json()["fallback"] == "paste_text"
    assert client.get("/api/postings").json() == []


def test_whitespace_term_dropped_valid_kept():
    r = extract_requirements(FakeLLM(_reply([_req("  "), _req(" Go ", 2)])), "t", [])
    assert [(x.term, x.weight) for x in r.requirements] == [("Go", 2)]


def test_case_insensitive_duplicates_collapse_to_highest_weight():
    reqs = [_req("Python", 1), _req("SQL", 2), _req("python", 3), _req("PYTHON ", 2)]
    r = extract_requirements(FakeLLM(_reply(reqs)), "t", [])
    assert [(x.term, x.weight) for x in r.requirements] == [("Python", 3), ("SQL", 2)]


def test_requirements_capped_at_50_keeping_highest_weight():
    reqs = [_req(f"t{i}", 3 if i >= 60 else 1) for i in range(80)]
    r = extract_requirements(FakeLLM(_reply(reqs)), "t", [])
    terms = [x.term for x in r.requirements]
    assert len(terms) == 50
    assert all(f"t{i}" in terms for i in range(60, 80))  # all 20 weight-3 kept
    assert terms == sorted(terms, key=lambda t: int(t[1:]))  # original order


def test_saved_posting_never_contains_blank_term(client, use):
    use(FakeLLM(_reply([_req(""), _req(" Rust "), _req("rust", 3), _req("\t")])))
    body = client.post("/api/postings", data={"text": "x"}).json()
    assert body["requirements"] == [{"term": "Rust", "kind": "skill", "weight": 3}]
    saved = client.get(f"/api/postings/{body['id']}").json()
    assert all(r["term"].strip() for r in saved["requirements"])
