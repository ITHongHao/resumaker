import json
from types import SimpleNamespace

import pytest

from app.ai.provider import AIError, AnthropicLLM, NoKeyError, OpenAILLM, get_llm
from app.models import AppSettings

PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 8
SCHEMA = {"type": "object", "properties": {"a": {"type": "string"}}}


class Recorder:
    def __init__(self, response=None, error=None):
        self.calls = []
        self.response = response
        self.error = error

    def create(self, **kwargs):
        self.calls.append(kwargs)
        if self.error:
            raise self.error
        return self.response


def anthropic_client(text='{"a": "b"}', error=None):
    rec = Recorder(SimpleNamespace(content=[SimpleNamespace(type="text", text=text)]), error)
    return SimpleNamespace(messages=rec), rec


def openai_client(text='{"a": "b"}', error=None):
    msg = SimpleNamespace(content=text)
    rec = Recorder(SimpleNamespace(choices=[SimpleNamespace(message=msg)]), error)
    return SimpleNamespace(chat=SimpleNamespace(completions=rec)), rec


class MemKeys:
    def __init__(self, data):
        self.data = data

    def get(self, provider):
        return self.data.get(provider)

    def set(self, provider, key):
        self.data[provider] = key


def test_anthropic_request_shape_with_image_and_schema():
    client, rec = anthropic_client()
    llm = AnthropicLLM("sk-secret", "claude-x", client=client)
    out = llm.complete("SYS", "USER", images=[PNG], json_schema=SCHEMA)
    assert out == '{"a": "b"}'
    call = rec.calls[0]
    assert call["model"] == "claude-x"
    assert call["system"] == "SYS"
    content = call["messages"][0]["content"]
    assert call["messages"][0]["role"] == "user"
    assert content[0]["type"] == "image"
    assert content[0]["source"]["type"] == "base64"
    assert content[0]["source"]["media_type"] == "image/png"
    assert content[1] == {"type": "text", "text": "USER"}
    assert call["output_config"] == {"format": {"type": "json_schema", "schema": SCHEMA}}
    assert call["max_tokens"] > 0


def test_anthropic_text_only_has_no_images_or_schema():
    client, rec = anthropic_client()
    AnthropicLLM("k", "m", client=client).complete("S", "U")
    call = rec.calls[0]
    assert call["messages"][0]["content"] == [{"type": "text", "text": "U"}]
    assert "output_config" not in call


def test_openai_request_shape_with_image_and_schema():
    client, rec = openai_client()
    llm = OpenAILLM("sk-secret", "gpt-x", client=client)
    out = llm.complete("SYS", "USER", images=[PNG], json_schema=SCHEMA)
    assert out == '{"a": "b"}'
    call = rec.calls[0]
    assert call["model"] == "gpt-x"
    assert call["messages"][0] == {"role": "system", "content": "SYS"}
    parts = call["messages"][1]["content"]
    assert parts[0] == {"type": "text", "text": "USER"}
    assert parts[1]["type"] == "image_url"
    assert parts[1]["image_url"]["url"].startswith("data:image/png;base64,")
    rf = call["response_format"]
    assert rf["type"] == "json_schema"
    assert rf["json_schema"]["schema"] == SCHEMA


def test_openai_text_only_has_plain_user_content():
    client, rec = openai_client()
    OpenAILLM("k", "m", client=client).complete("S", "U")
    call = rec.calls[0]
    assert call["messages"][1] == {"role": "user", "content": "U"}
    assert "response_format" not in call


@pytest.mark.parametrize("make,cls", [(anthropic_client, AnthropicLLM), (openai_client, OpenAILLM)])
def test_provider_failure_becomes_aierror_without_leaking(make, cls):
    client, _ = make(error=RuntimeError("boom sk-secret body=resume text"))
    with pytest.raises(AIError) as e:
        cls("sk-secret", "m", client=client).complete("S", "U")
    assert "sk-secret" not in str(e.value)
    assert "resume text" not in str(e.value)


def test_get_llm_without_key_raises_nokey():
    with pytest.raises(NoKeyError):
        get_llm(AppSettings(provider="openai", model="m"), MemKeys({}))


def test_get_llm_picks_provider_and_model():
    llm = get_llm(AppSettings(provider="openai", model="gpt-z"), MemKeys({"openai": "k"}))
    assert isinstance(llm, OpenAILLM) and llm.model == "gpt-z"
    llm = get_llm(AppSettings(provider="anthropic", model=""), MemKeys({"anthropic": "k"}))
    assert isinstance(llm, AnthropicLLM) and llm.model  # falls back to a default
    assert json.dumps(SCHEMA)


# --- request settings and readable errors ------------------------------------------

import anthropic  # noqa: E402
import httpx  # noqa: E402
import openai  # noqa: E402

from app.ai import provider as provider_mod  # noqa: E402

KEY = "sk-ant-SECRET-key-123"
REQ = httpx.Request("POST", "https://api.example/v1/x")


def _status(sdk, cls, code):
    body = {"error": {"message": f"provider says: key {KEY} prompt RESUME-TEXT"}}
    return getattr(sdk, cls)(message=f"{KEY} RESUME-TEXT", response=httpx.Response(code, request=REQ), body=body)


def _errors(sdk):
    return [
        (_status(sdk, "AuthenticationError", 401), "API key"),
        (_status(sdk, "PermissionDeniedError", 403), "not allowed"),
        (_status(sdk, "NotFoundError", 404), "model"),
        (_status(sdk, "RateLimitError", 429), "rate limit"),
        (_status(sdk, "BadRequestError", 400), "too large"),
        (_status(sdk, "InternalServerError", 500), "having trouble"),
        (sdk.APITimeoutError(request=REQ), "too long"),
        (sdk.APIConnectionError(message=f"{KEY} RESUME-TEXT", request=REQ), "could not reach"),
        (RuntimeError(f"{KEY} RESUME-TEXT"), "request failed"),
    ]


@pytest.mark.parametrize("err,want", _errors(anthropic))
def test_anthropic_errors_map_to_fixed_readable_messages(err, want):
    client, _ = anthropic_client(error=err)
    with pytest.raises(AIError) as e:
        AnthropicLLM(KEY, "claude-sonnet-5-5", client=client).complete("S", "RESUME-TEXT")
    msg = str(e.value)
    assert want.lower() in msg.lower()
    assert KEY not in msg and "RESUME-TEXT" not in msg and "provider says" not in msg
    assert e.value.__cause__ is None and e.value.__suppress_context__


@pytest.mark.parametrize("err,want", _errors(openai))
def test_openai_errors_map_to_fixed_readable_messages(err, want):
    client, _ = openai_client(error=err)
    with pytest.raises(AIError) as e:
        OpenAILLM(KEY, "gpt-5.5", client=client).complete("S", "RESUME-TEXT")
    msg = str(e.value)
    assert want.lower() in msg.lower()
    assert KEY not in msg and "RESUME-TEXT" not in msg and "provider says" not in msg


def test_anthropic_request_too_large_is_readable():
    err = _status(anthropic, "RequestTooLargeError", 413)
    client, _ = anthropic_client(error=err)
    with pytest.raises(AIError, match="too large"):
        AnthropicLLM(KEY, "m", client=client).complete("S", "U")


def _anthropic_stop(stop_reason, text='{"a": "b"}'):
    resp = SimpleNamespace(content=[SimpleNamespace(type="text", text=text)], stop_reason=stop_reason)
    rec = Recorder(resp)
    return SimpleNamespace(messages=rec), rec


def test_anthropic_max_tokens_stop_gives_truncation_message():
    client, _ = _anthropic_stop("max_tokens", '{"bullets": [{"source_ca')
    with pytest.raises(AIError) as e:
        AnthropicLLM(KEY, "m", client=client).complete("S", "U")
    assert "cut off" in str(e.value)


def test_anthropic_refusal_stop_gives_refusal_message():
    client, _ = _anthropic_stop("refusal", "")
    with pytest.raises(AIError) as e:
        AnthropicLLM(KEY, "m", client=client).complete("S", "U")
    assert "declined" in str(e.value)
    assert "cut off" not in str(e.value)


def test_anthropic_end_turn_returns_text():
    client, _ = _anthropic_stop("end_turn")
    assert AnthropicLLM(KEY, "m", client=client).complete("S", "U") == '{"a": "b"}'


def _openai_finish(finish_reason, content='{"a": "b"}', refusal=None):
    msg = SimpleNamespace(content=content, refusal=refusal)
    rec = Recorder(SimpleNamespace(choices=[SimpleNamespace(message=msg, finish_reason=finish_reason)]))
    return SimpleNamespace(chat=SimpleNamespace(completions=rec)), rec


def test_openai_length_and_refusal_are_readable():
    client, _ = _openai_finish("length", '{"bul')
    with pytest.raises(AIError, match="cut off"):
        OpenAILLM(KEY, "gpt-5.5", client=client).complete("S", "U")
    client, _ = _openai_finish("stop", None, refusal="I can't help with that")
    with pytest.raises(AIError, match="declined") as e:
        OpenAILLM(KEY, "gpt-5.5", client=client).complete("S", "U")
    assert "can't help" not in str(e.value)
    client, _ = _openai_finish("content_filter", "")
    with pytest.raises(AIError, match="declined"):
        OpenAILLM(KEY, "gpt-5.5", client=client).complete("S", "U")


def test_anthropic_max_tokens_room_for_thinking_and_effort_per_call_kind():
    from app.ai.askai import SYSTEM_PROMPT as ASK
    from app.cater import CATER_SYSTEM_PROMPT, SUGGEST_SYSTEM_PROMPT
    from app.postings.extract import SYSTEM_PROMPT as EXTRACT

    seen = {}
    for name, system in [("extract", EXTRACT), ("cater", CATER_SYSTEM_PROMPT),
                         ("suggest", SUGGEST_SYSTEM_PROMPT), ("ask", ASK)]:
        client, rec = anthropic_client()
        AnthropicLLM(KEY, "claude-sonnet-5-5", client=client).complete(system, "U", json_schema=SCHEMA)
        call = rec.calls[0]
        assert call["max_tokens"] >= 16000
        assert "thinking" not in call  # adaptive by default; effort bounds it
        assert call["output_config"]["format"]["schema"] == SCHEMA
        seen[name] = call["output_config"]["effort"]
    assert seen == {"extract": "low", "cater": "medium", "suggest": "medium", "ask": "medium"}


@pytest.mark.parametrize("model,has_effort", [
    ("claude-sonnet-5-5", True), ("claude-opus-5-5", True), ("claude-haiku-5-5", True),
    ("claude-sonnet-4-6", True), ("claude-opus-4-5", True), ("claude-fable-5-1", True),
    ("claude-haiku-4-5", False), ("claude-sonnet-4-5", False), ("claude-3-5-sonnet-latest", False),
    ("my-proxy-model", False),
])
def test_anthropic_effort_only_sent_to_models_that_accept_it(model, has_effort):
    from app.cater import CATER_SYSTEM_PROMPT

    client, rec = anthropic_client()
    AnthropicLLM(KEY, model, client=client).complete(CATER_SYSTEM_PROMPT, "U")
    assert ("effort" in rec.calls[0].get("output_config", {})) is has_effort


def test_openai_strict_schema_and_reasoning_effort():
    from app.postings.extract import SYSTEM_PROMPT as EXTRACT

    client, rec = openai_client()
    OpenAILLM(KEY, "gpt-5.5", client=client).complete(EXTRACT, "U", json_schema=SCHEMA)
    call = rec.calls[0]
    assert call["response_format"]["json_schema"]["strict"] is True
    assert call["reasoning_effort"] == "low"
    client, rec = openai_client()
    OpenAILLM(KEY, "gpt-4o", client=client).complete(EXTRACT, "U")
    assert "reasoning_effort" not in rec.calls[0]


def _strict_ok(schema):
    if schema.get("type") == "object":
        props = schema.get("properties", {})
        assert schema.get("additionalProperties") is False
        assert set(schema.get("required", [])) == set(props)
        for p in props.values():
            _strict_ok(p)
    if schema.get("type") == "array":
        _strict_ok(schema["items"])


def test_every_app_schema_is_strict_compatible():
    from app.ai.askai import RESPONSE_SCHEMA as ASK
    from app.cater import CATER_SCHEMA, SUGGEST_SCHEMA
    from app.postings.extract import RESPONSE_SCHEMA as EXTRACT

    for s in (ASK, CATER_SCHEMA, SUGGEST_SCHEMA, EXTRACT):
        _strict_ok(s)


def test_real_clients_use_one_retry_and_a_bounded_timeout(monkeypatch):
    seen = {}

    class Spy:
        def __init__(self, **kw):
            seen[self.name] = kw

    monkeypatch.setattr(anthropic, "Anthropic", type("A", (Spy,), {"name": "anthropic"}))
    monkeypatch.setattr(openai, "OpenAI", type("O", (Spy,), {"name": "openai"}))
    AnthropicLLM(KEY, "m")
    OpenAILLM(KEY, "m")
    for kw in seen.values():
        assert kw["max_retries"] == 1
        total = kw["timeout"] if isinstance(kw["timeout"], float) else kw["timeout"].read
        assert total * (kw["max_retries"] + 1) <= 95
    assert provider_mod.DEFAULT_MODELS == {"anthropic": "claude-sonnet-5-5", "openai": "gpt-5.5"}
