"""Model abstraction and the OpenAI-compatible client.

The loop sees only ``complete(messages, tools) -> ModelTurn``. That is what
makes provider swaps (OpenAI, Zhipu/GLM, local vLLM, …) a configuration
change rather than a harness rewrite. ``ScriptedModel`` is a deterministic
fixture backend for tests and mechanics benchmarks; it is never presented as
live model evidence.
"""

from __future__ import annotations

import json
import os
import socket
import time
import urllib.error
import urllib.request
import uuid
from abc import ABC, abstractmethod
from typing import Any, Iterable

from .config import HarnessConfig
from .errors import ModelError
from .types import ModelTurn, TokenUsage, ToolCall


class ModelClient(ABC):
    name = "model"
    model = "unknown"

    @abstractmethod
    def complete(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]],
        *,
        timeout_seconds: int | None = None,
    ) -> ModelTurn:
        raise NotImplementedError


def _content_text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if isinstance(item, dict) and isinstance(item.get("text"), str):
                parts.append(item["text"])
            elif isinstance(item, str):
                parts.append(item)
        return "".join(parts)
    if content is None:
        return ""
    return str(content)


def _parse_tool_calls(raw_calls: list[dict[str, Any]]) -> tuple[ToolCall, ...]:
    calls: list[ToolCall] = []
    for index, raw in enumerate(raw_calls):
        function = raw.get("function") or {}
        name = str(function.get("name") or "")
        raw_arguments = function.get("arguments")
        arguments: dict[str, Any] = {}
        malformed = None
        if isinstance(raw_arguments, dict):
            arguments = raw_arguments
        elif isinstance(raw_arguments, str) and raw_arguments.strip():
            try:
                parsed = json.loads(raw_arguments)
                if isinstance(parsed, dict):
                    arguments = parsed
                else:
                    malformed = raw_arguments
            except json.JSONDecodeError:
                malformed = raw_arguments
        calls.append(
            ToolCall(
                call_id=str(raw.get("id") or f"call_{uuid.uuid4().hex[:10]}"),
                name=name,
                arguments=arguments,
                raw_arguments=malformed,
            )
        )
    return tuple(calls)


class OpenAICompatibleModel(ModelClient):
    name = "openai-compatible"

    def __init__(
        self,
        *,
        model: str,
        base_url: str,
        api_key: str | None = None,
        timeout_seconds: int = 90,
        temperature: float = 0.0,
        max_tokens: int | None = None,
        max_retries: int = 1,
        extra_headers: dict[str, str] | None = None,
        extra_body: dict[str, Any] | None = None,
    ) -> None:
        if not base_url:
            raise ModelError(
                "model base URL is not configured; set AGENT_REPLAY_MODEL_BASE_URL "
                "or pass --base-url"
            )
        self.model = model
        self.base_url = base_url.rstrip("/")
        if self.base_url.endswith("/chat/completions"):
            self.endpoint = self.base_url
        else:
            self.endpoint = self.base_url + "/chat/completions"
        self.api_key = api_key
        self.timeout_seconds = timeout_seconds
        self.temperature = temperature
        self.max_tokens = max_tokens
        self.max_retries = max(0, max_retries)
        self.extra_headers = dict(extra_headers or {})
        self.extra_body = dict(extra_body or {})

    def _payload(self, messages: list[dict[str, Any]], tools: list[dict[str, Any]]) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "temperature": self.temperature,
        }
        if tools:
            payload["tools"] = tools
            payload["tool_choice"] = "auto"
        if self.max_tokens:
            payload["max_tokens"] = self.max_tokens
        payload.update(self.extra_body)
        return payload

    def complete(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]],
        *,
        timeout_seconds: int | None = None,
    ) -> ModelTurn:
        payload = self._payload(messages, tools)
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        headers = {"Content-Type": "application/json", "User-Agent": "agent-replay-harness/1.0"}
        headers.update(self.extra_headers)
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"

        timeout = timeout_seconds or self.timeout_seconds
        started = time.monotonic()
        deadline = started + timeout
        last_error: Exception | None = None
        for attempt in range(self.max_retries + 1):
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise ModelError("model request timeout budget exhausted") from last_error
            request = urllib.request.Request(
                self.endpoint, data=body, headers=headers, method="POST"
            )
            try:
                with urllib.request.urlopen(request, timeout=remaining) as response:
                    raw = response.read().decode("utf-8", errors="replace")
                break
            except urllib.error.HTTPError as exc:
                detail = exc.read().decode("utf-8", errors="replace")[:800]
                last_error = ModelError(f"model HTTP {exc.code}: {detail}")
                if exc.code not in (408, 409, 429, 500, 502, 503, 504) or attempt >= self.max_retries:
                    raise last_error from exc
            except (urllib.error.URLError, socket.timeout, TimeoutError) as exc:
                last_error = ModelError(f"model request failed: {exc}")
                if attempt >= self.max_retries:
                    raise last_error from exc
            time.sleep(min(1.5 ** attempt, 4.0, max(0, deadline - time.monotonic())))
        else:  # pragma: no cover - loop either breaks or raises
            raise last_error or ModelError("model request failed")

        latency_ms = int((time.monotonic() - started) * 1000)
        try:
            data = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise ModelError(f"model returned invalid JSON: {raw[:500]}") from exc
        if isinstance(data, dict) and data.get("error"):
            raise ModelError(f"model error: {data['error']}")
        choices = data.get("choices") or []
        if not choices:
            raise ModelError(f"model returned no choices: {raw[:500]}")
        choice = choices[0]
        message = choice.get("message") or {}
        usage_data = data.get("usage") or {}
        usage = TokenUsage(
            input_tokens=int(usage_data.get("prompt_tokens", usage_data.get("input_tokens", 0)) or 0),
            output_tokens=int(
                usage_data.get("completion_tokens", usage_data.get("output_tokens", 0)) or 0
            ),
            total_tokens=(
                int(usage_data["total_tokens"])
                if usage_data.get("total_tokens") is not None
                else None
            ),
            reported=bool(usage_data),
        )
        return ModelTurn(
            text=_content_text(message.get("content")),
            tool_calls=_parse_tool_calls(message.get("tool_calls") or []),
            usage=usage,
            finish_reason=str(choice.get("finish_reason") or "stop"),
            latency_ms=latency_ms,
            raw={"id": data.get("id"), "model": data.get("model")},
        )


class ScriptedModel(ModelClient):
    """Deterministic action queue for tests and mechanics experiments.

    Actions are plain dicts:

    * ``{"tool": "read_file", "arguments": {...}}`` — one tool call.
    * ``{"tools": [{"name": ..., "arguments": {...}}, ...]}`` — several calls
      in a single turn.
    * ``{"text": "..."}`` — a completion claim (no tool calls).

    It reports ``usage.reported=False``: token metrics must stay unavailable
    rather than pretending a scripted turn consumed tokens.
    """

    name = "scripted"
    model = "scripted-fixture"

    def __init__(self, actions: Iterable[dict[str, Any]] | None = None) -> None:
        self._actions = list(actions or [])
        self._index = 0
        self.calls: list[list[dict[str, Any]]] = []

    @classmethod
    def from_actions(cls, actions: Iterable[dict[str, Any]]) -> "ScriptedModel":
        return cls(actions)

    @property
    def remaining(self) -> int:
        return max(0, len(self._actions) - self._index)

    @staticmethod
    def _make_call(name: str, arguments: dict[str, Any] | None, index: int) -> ToolCall:
        return ToolCall(
            call_id=f"scripted-{index}-{uuid.uuid4().hex[:6]}",
            name=name,
            arguments=dict(arguments or {}),
        )

    def complete(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]],
        *,
        timeout_seconds: int | None = None,
    ) -> ModelTurn:
        self.calls.append(messages)
        if self._index >= len(self._actions):
            return ModelTurn(
                text="No further scripted actions.",
                finish_reason="stop",
                usage=TokenUsage(reported=False),
            )
        action = self._actions[self._index]
        self._index += 1
        calls: list[ToolCall] = []
        if "tools" in action:
            for offset, item in enumerate(action["tools"]):
                calls.append(self._make_call(item["name"], item.get("arguments"), offset))
        elif "tool" in action:
            calls.append(self._make_call(action["tool"], action.get("arguments"), 0))
        usage_data = action.get("usage")
        usage = (
            TokenUsage(
                input_tokens=int(usage_data.get("input_tokens", 0)),
                output_tokens=int(usage_data.get("output_tokens", 0)),
                total_tokens=usage_data.get("total_tokens"),
                reported=True,
            )
            if usage_data
            else TokenUsage(reported=False)
        )
        return ModelTurn(
            text=action.get("text"),
            tool_calls=tuple(calls),
            usage=usage,
            finish_reason=str(action.get("finish_reason") or ("tool_calls" if calls else "stop")),
            latency_ms=int(action.get("latency_ms", 0) or 0),
        )


def model_from_config(config: HarnessConfig, *, model: str | None = None) -> OpenAICompatibleModel:
    api_key = os.environ.get(config.model_api_key_env) or os.environ.get("OPENAI_API_KEY")
    return OpenAICompatibleModel(
        model=model or config.model,
        base_url=config.model_base_url or os.environ.get("AGENT_REPLAY_MODEL_BASE_URL", ""),
        api_key=api_key,
        timeout_seconds=config.model_timeout_seconds,
        temperature=config.temperature,
        max_tokens=config.max_tokens,
        max_retries=config.model_max_retries,
    )
