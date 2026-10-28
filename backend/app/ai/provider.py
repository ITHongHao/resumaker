import base64
from typing import Any, Protocol

from app.keystore import KeyStore
from app.models import AppSettings

# Used only when Settings leaves the model blank; any model name can be set in Settings.
DEFAULT_MODELS = {"anthropic": "claude-sonnet-5-5", "openai": "gpt-5.5"}
MAX_TOKENS = 4096
TIMEOUT_SECONDS = 60.0


class NoKeyError(Exception):
    """No API key is saved for the selected provider."""


class AIError(Exception):
    """A provider failure or unusable model output. Messages are safe to show users:
    they never carry keys, provider response bodies, or request content."""


class LLM(Protocol):
    def complete(
        self,
        system: str,
        user: str,
        images: list[bytes] = [],
        json_schema: dict | None = None,
    ) -> str: ...


def _media_type(data: bytes) -> str:
    if data.startswith(b"\x89PNG"):
        return "image/png"
    if data.startswith(b"\xff\xd8"):
        return "image/jpeg"
    if data.startswith(b"GIF8"):
        return "image/gif"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return "image/png"


def _b64(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


class AnthropicLLM:
    def __init__(self, api_key: str, model: str, client: Any = None):
        self.model = model
        if client is None:
            from anthropic import Anthropic

            client = Anthropic(api_key=api_key, timeout=TIMEOUT_SECONDS)
        self._client = client

    def complete(self, system, user, images=[], json_schema=None) -> str:
        content: list[dict] = [
            {
                "type": "image",
                "source": {"type": "base64", "media_type": _media_type(i), "data": _b64(i)},
            }
            for i in images
        ]
        content.append({"type": "text", "text": user})
        kwargs: dict[str, Any] = {
            "model": self.model,
            "max_tokens": MAX_TOKENS,
            "system": system,
            "messages": [{"role": "user", "content": content}],
        }
        if json_schema is not None:
            kwargs["output_config"] = {"format": {"type": "json_schema", "schema": json_schema}}
        try:
            resp = self._client.messages.create(**kwargs)
            return "".join(b.text for b in resp.content if getattr(b, "type", "") == "text")
        except Exception as e:
            raise AIError(f"The AI provider request failed ({type(e).__name__}).") from None


class OpenAILLM:
    def __init__(self, api_key: str, model: str, client: Any = None):
        self.model = model
        if client is None:
            from openai import OpenAI

            client = OpenAI(api_key=api_key, timeout=TIMEOUT_SECONDS)
        self._client = client

    def complete(self, system, user, images=[], json_schema=None) -> str:
        if images:
            user_content: Any = [{"type": "text", "text": user}] + [
                {
                    "type": "image_url",
                    "image_url": {"url": f"data:{_media_type(i)};base64,{_b64(i)}"},
                }
                for i in images
            ]
        else:
            user_content = user
        kwargs: dict[str, Any] = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user_content},
            ],
        }
        if json_schema is not None:
            kwargs["response_format"] = {
                "type": "json_schema",
                "json_schema": {"name": "response", "schema": json_schema, "strict": False},
            }
        try:
            resp = self._client.chat.completions.create(**kwargs)
            return resp.choices[0].message.content or ""
        except Exception as e:
            raise AIError(f"The AI provider request failed ({type(e).__name__}).") from None


def get_llm(settings: AppSettings, keystore: KeyStore) -> LLM:
    key = keystore.get(settings.provider)
    if not key:
        raise NoKeyError(settings.provider)
    model = settings.model or DEFAULT_MODELS[settings.provider]
    if settings.provider == "openai":
        return OpenAILLM(key, model)
    return AnthropicLLM(key, model)
