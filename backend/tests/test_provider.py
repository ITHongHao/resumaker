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
