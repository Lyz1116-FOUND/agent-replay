"""Context managers: decide what the next model call can see.

Three strategies make context compression an experimental variable rather than
an implicit feature:

* ``full`` — every message, with a hard budget only as a safety valve.
* ``truncated`` — every message, each tool observation clamped.
* ``compressed`` — extractive summary of older turns + recent window.

All of them return the same :class:`ContextBuild`, so the loop is unaware of
the strategy.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from ..harness.config import HarnessConfig
from ..harness.types import RunState
from .summarizer import ExtractiveSummarizer, build_structured_state
from .truncation import (
    enforce_budget,
    estimate_tokens,
    message_text,
    truncate_message,
)


@dataclass
class ContextBuild:
    messages: list[dict[str, Any]]
    strategy: str
    estimated_tokens: int
    dropped_messages: int = 0
    truncated: bool = False
    summary: str | None = None
    structured_state: dict[str, Any] = field(default_factory=dict)
    extra: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "strategy": self.strategy,
            "message_count": len(self.messages),
            "estimated_tokens": self.estimated_tokens,
            "dropped_messages": self.dropped_messages,
            "truncated": self.truncated,
            "summary": self.summary,
            "structured_state": self.structured_state,
            **self.extra,
        }


class ContextManager:
    strategy = "base"

    def __init__(
        self,
        *,
        max_tool_output_chars: int = 10_000,
        token_budget: int = 24_000,
        chars_per_token: int = 4,
    ) -> None:
        self.max_tool_output_chars = max_tool_output_chars
        self.token_budget = token_budget
        self.chars_per_token = chars_per_token

    def build(self, system_prompt: str, state: RunState) -> ContextBuild:
        raise NotImplementedError

    def _assemble(
        self,
        system_prompt: str,
        body: list[dict[str, Any]],
        *,
        state: RunState,
        summary: str | None = None,
        extra: dict[str, Any] | None = None,
    ) -> ContextBuild:
        messages: list[dict[str, Any]] = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.extend(body)
        messages, dropped, truncated = enforce_budget(
            messages, self.token_budget, self.chars_per_token
        )
        return ContextBuild(
            messages=messages,
            strategy=self.strategy,
            estimated_tokens=estimate_tokens(messages, self.chars_per_token),
            dropped_messages=dropped,
            truncated=truncated,
            summary=summary,
            structured_state=build_structured_state(state),
            extra=extra or {},
        )


class FullContextManager(ContextManager):
    strategy = "full"

    def build(self, system_prompt: str, state: RunState) -> ContextBuild:
        body = [dict(message) for message in state.messages]
        return self._assemble(system_prompt, body, state=state)


class TruncatingContextManager(ContextManager):
    strategy = "truncated"

    def build(self, system_prompt: str, state: RunState) -> ContextBuild:
        body: list[dict[str, Any]] = []
        truncated_any = False
        for message in state.messages:
            clone, was_truncated = truncate_message(message, self.max_tool_output_chars)
            body.append(clone)
            truncated_any = truncated_any or was_truncated
        build = self._assemble(system_prompt, body, state=state)
        build.truncated = build.truncated or truncated_any
        build.extra["observation_truncated"] = truncated_any
        return build


class CompressedContextManager(ContextManager):
    strategy = "compressed"

    def __init__(
        self,
        *,
        recent_turns: int = 4,
        summarizer: ExtractiveSummarizer | None = None,
        **kwargs: Any,
    ) -> None:
        super().__init__(**kwargs)
        self.recent_turns = max(1, recent_turns)
        self.summarizer = summarizer or ExtractiveSummarizer()

    def build(self, system_prompt: str, state: RunState) -> ContextBuild:
        assistant_indices = [
            index for index, message in enumerate(state.messages) if message.get("role") == "assistant"
        ]
        if len(assistant_indices) <= self.recent_turns:
            old_messages: list[dict[str, Any]] = []
            recent = list(state.messages)
        else:
            split = assistant_indices[-self.recent_turns]
            old_messages = state.messages[:split]
            recent = state.messages[split:]

        summary = self.summarizer.summarize(old_messages, state) if old_messages else None
        body: list[dict[str, Any]] = []
        if summary:
            body.append({"role": "user", "content": summary})
        truncated_any = False
        for message in recent:
            clone, was_truncated = truncate_message(message, self.max_tool_output_chars)
            body.append(clone)
            truncated_any = truncated_any or was_truncated
        build = self._assemble(
            system_prompt,
            body,
            state=state,
            summary=summary,
            extra={
                "summarized_messages": len(old_messages),
                "recent_messages": len(recent),
                "observation_truncated": truncated_any,
            },
        )
        build.truncated = build.truncated or truncated_any
        return build


def make_context_manager(config: HarnessConfig) -> ContextManager:
    common = {
        "max_tool_output_chars": config.context_max_tool_output_chars,
        "token_budget": config.context_token_budget,
        "chars_per_token": config.context_chars_per_token,
    }
    if config.context_strategy == "full":
        return FullContextManager(**common)
    if config.context_strategy == "truncated":
        return TruncatingContextManager(**common)
    if config.context_strategy == "compressed":
        return CompressedContextManager(recent_turns=config.context_recent_turns, **common)
    raise ValueError(f"unknown context strategy: {config.context_strategy}")


def context_fingerprint(build: ContextBuild) -> dict[str, Any]:
    """Small metrics record without storing the full prompt twice."""
    return {
        "strategy": build.strategy,
        "estimated_tokens": build.estimated_tokens,
        "message_count": len(build.messages),
        "character_count": sum(len(message_text(message)) for message in build.messages),
        "dropped_messages": build.dropped_messages,
        "truncated": build.truncated,
        "structured_state": build.structured_state,
    }
