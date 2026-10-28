import base64
import os
import re
from typing import Any, Protocol

from app.keystore import KeyStore
from app.models import AppSettings

# Used only when Settings leaves the model blank; any model name can be set in Settings.
DEFAULT_MODELS = {"anthropic": "claude-sonnet-5-5", "openai": "gpt-5.5"}
# Thinking tokens count against max_tokens, so leave room for them as well as the JSON (a cater
# reply can hold 14 bullets). 16000 is the SDK's recommended non-streaming ceiling.
MAX_TOKENS = 16000
# One retry, and a per-attempt timeout, so the user waits at most about 90 s in total.
MAX_RETRIES = 1
TIMEOUT_SECONDS = 45.0
CONNECT_TIMEOUT_SECONDS = 5.0

# Fixed, user-facing messages. They never include the key, provider error text or request content.
MSG_AUTH = "The AI provider rejected the API key. Check the key in Settings."
MSG_PERMISSION = ("This API key is not allowed to use that model at the AI provider. Check the key "
                  "and the model name in Settings.")
MSG_NOT_FOUND = ("The AI provider does not know the model set in Settings. Check the model name, or "
                 "leave it blank to use the default.")
MSG_RATE_LIMIT = ("The AI provider is rate limiting requests (or the account is out of credit). Wait a "
                  "minute and try again.")
MSG_BAD_REQUEST = ("The AI provider rejected the request, usually because it is too large (a very long "
                   "posting or a big screenshot) or the model does not support it. Try shorter text, a "
                   "smaller image, or another model.")
MSG_SERVER = "The AI provider is having trouble right now. Try again in a minute."
MSG_TIMEOUT = "The AI provider took too long to answer. Try again."
MSG_CONNECTION = "Could not reach the AI provider. Check your internet connection and try again."
MSG_FAILED = "The AI provider request failed. Try again."
MSG_TRUNCATED = ("The AI's answer was cut off before it finished (it ran out of room). Try again; if it "
                 "keeps happening, use shorter input.")
MSG_REFUSED = "The AI provider declined to answer this request. Try rewording it, or try again."


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


def _effort(system: str) -> str:
    """Effort per call kind, recognised by its system prompt: extraction is simple ("low"); cater,
    suggestions and Ask AI need judgment about provenance ("medium")."""
    from app.postings import extract  # lazy: these modules import this one

    return "low" if system == extract.SYSTEM_PROMPT else "medium"


_CLAUDE = re.compile(r"^claude-(opus|sonnet|haiku|fable|mythos)-(\d+)(?:-(\d+))?(?:$|[-@])")


def _anthropic_effort_ok(model: str) -> bool:
    """output_config.effort is accepted on Claude Opus 4.5 and on 4.6+ / 5.x models; older ones
    (Sonnet 4.5, Haiku 4.5, Claude 3.x) and unknown names get no effort, so they never 400."""
    m = _CLAUDE.match(model.strip())
    if not m:
        return False
    family, major, minor = m.group(1), int(m.group(2)), int(m.group(3) or 0)
    if minor > 9:  # a date suffix such as claude-sonnet-4-20250514, not a minor version
        minor = 0
    if family in ("fable", "mythos"):
        return True
    return (major, minor) >= (4, 6) or (family == "opus" and (major, minor) >= (4, 5))


def _openai_effort_ok(model: str) -> bool:
    """reasoning_effort only for reasoning models (gpt-5 family, o-series)."""
    return re.match(r"^(gpt-5|o\d)", model.strip()) is not None


def _provider_error(e: Exception, sdk: Any) -> AIError:
    """A fixed readable message per failure kind. Order matters: the timeout class is a
    subclass of the connection class, and 413 has its own class in the Anthropic SDK."""
    def isa(*names: str) -> bool:
        classes = tuple(c for c in (getattr(sdk, n, None) for n in names) if isinstance(c, type))
        return bool(classes) and isinstance(e, classes)

    if isa("APITimeoutError"):
        return AIError(MSG_TIMEOUT)
    if isa("APIConnectionError"):
        return AIError(MSG_CONNECTION)
    if isa("AuthenticationError"):
        return AIError(MSG_AUTH)
    if isa("PermissionDeniedError"):
        return AIError(MSG_PERMISSION)
    if isa("NotFoundError"):
        return AIError(MSG_NOT_FOUND)
    if isa("RateLimitError"):
        return AIError(MSG_RATE_LIMIT)
    if isa("BadRequestError", "RequestTooLargeError", "UnprocessableEntityError"):
        return AIError(MSG_BAD_REQUEST)
    if isa("InternalServerError", "OverloadedError"):
        return AIError(MSG_SERVER)
    status = getattr(e, "status_code", None)
    if isa("APIStatusError") and isinstance(status, int):
        if status == 413:
            return AIError(MSG_BAD_REQUEST)
        if status >= 500:
            return AIError(MSG_SERVER)
    return AIError(MSG_FAILED)


class AnthropicLLM:
    def __init__(self, api_key: str, model: str, client: Any = None):
        self.model = model
        if client is None:
            import anthropic

            client = anthropic.Anthropic(
                api_key=api_key, max_retries=MAX_RETRIES,
                timeout=anthropic.Timeout(TIMEOUT_SECONDS, connect=CONNECT_TIMEOUT_SECONDS))
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
        # `thinking` is left out: the default models run adaptive thinking, bounded by effort.
        output_config: dict[str, Any] = {}
        if json_schema is not None:
            output_config["format"] = {"type": "json_schema", "schema": json_schema}
        if _anthropic_effort_ok(self.model):
            output_config["effort"] = _effort(system)
        if output_config:
            kwargs["output_config"] = output_config
        try:
            resp = self._client.messages.create(**kwargs)
        except Exception as e:
            import anthropic

            raise _provider_error(e, anthropic) from None
        stop = getattr(resp, "stop_reason", None)
        if stop == "max_tokens":
            raise AIError(MSG_TRUNCATED)
        if stop == "refusal":
            raise AIError(MSG_REFUSED)
        return "".join(b.text for b in resp.content if getattr(b, "type", "") == "text")


class OpenAILLM:
    def __init__(self, api_key: str, model: str, client: Any = None):
        self.model = model
        if client is None:
            import httpx
            import openai

            client = openai.OpenAI(
                api_key=api_key, max_retries=MAX_RETRIES,
                timeout=httpx.Timeout(TIMEOUT_SECONDS, connect=CONNECT_TIMEOUT_SECONDS))
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
                # Every app schema lists all properties as required with no extras, so strict
                # mode applies and the model cannot add fields (such as a free-form `extra`).
                "json_schema": {"name": "response", "schema": json_schema, "strict": True},
            }
        if _openai_effort_ok(self.model):
            kwargs["reasoning_effort"] = _effort(system)
        try:
            resp = self._client.chat.completions.create(**kwargs)
        except Exception as e:
            import openai

            raise _provider_error(e, openai) from None
        choice = resp.choices[0]
        finish = getattr(choice, "finish_reason", None)
        if finish == "length":
            raise AIError(MSG_TRUNCATED)
        if finish == "content_filter" or getattr(choice.message, "refusal", None):
            raise AIError(MSG_REFUSED)
        return choice.message.content or ""


def get_llm(settings: AppSettings, keystore: KeyStore) -> LLM:
    # For tests and demos only: switched on solely by the process environment (checked on every
    # call), never by a request parameter, header, or setting.
    if os.environ.get("RESUMAKER_FAKE_LLM") == "1":
        from app.ai.fake import FakeLLM

        return FakeLLM()
    key = keystore.get(settings.provider)
    if not key:
        raise NoKeyError(settings.provider)
    model = settings.model or DEFAULT_MODELS[settings.provider]
    if settings.provider == "openai":
        return OpenAILLM(key, model)
    return AnthropicLLM(key, model)
