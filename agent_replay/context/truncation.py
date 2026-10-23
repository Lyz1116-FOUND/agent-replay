"""Bounded text helpers for context construction."""

from __future__ import annotations

from typing import Any


def message_text(message: dict[str, Any]) -> str:
    content = message.get("content")
    if isinstance(content, str):
        text = content
    elif content is None:
        text = ""
    else:
        text = str(content)
    tool_calls = message.get("tool_calls") or []
    if tool_calls:
        text += " " + str(tool_calls)
    return text


def truncate_text(text: str, limit: int, *, note: str = "... (truncated)") -> str:
    if limit <= 0 or len(text) <= limit:
        return text
    return text[: max(limit - len(note), 0)] + note


def truncate_message(message: dict[str, Any], limit: int) -> tuple[dict[str, Any], bool]:
    if message.get("role") != "tool":
        return message, False
    content = message.get("content")
    if not isinstance(content, str) or len(content) <= limit:
        return message, False
    clone = dict(message)
    clone["content"] = truncate_text(
        content, limit, note=f"\n... (observation truncated at {limit} characters)"
    )
    return clone, True


def estimate_tokens(messages: list[dict[str, Any]], chars_per_token: int = 4) -> int:
    chars = sum(len(message_text(message)) for message in messages)
    return max(1, chars // max(chars_per_token, 1))


def split_units(messages: list[dict[str, Any]]) -> list[list[dict[str, Any]]]:
    """Group each assistant turn with its tool observations.

    Splitting a tool call away from its tool results produces an invalid
    provider request, so budget enforcement only drops whole units.
    """
    units: list[list[dict[str, Any]]] = []
    current: list[dict[str, Any]] = []
    for message in messages:
        role = message.get("role")
        if role == "tool" and current:
            current.append(message)
            continue
        if current:
            units.append(current)
        current = [message]
    if current:
        units.append(current)
    return units


def enforce_budget(
    messages: list[dict[str, Any]],
    budget_tokens: int,
    chars_per_token: int,
) -> tuple[list[dict[str, Any]], int, bool]:
    """Drop whole oldest units until the estimated size fits.

    Returns ``(messages, dropped_messages, truncated)``. The system message is
    never dropped; with one unit left, its tool contents are truncated.
    """
    dropped = 0
    if not messages:
        return messages, dropped, False
    system = messages[0] if messages[0].get("role") == "system" else None
    if system and estimate_tokens([system], chars_per_token) > budget_tokens:
        raise ValueError("system prompt exceeds the context token budget")
    body = messages[1:] if system else messages
    units = split_units(body)
    while units and estimate_tokens(([system] if system else []) + [m for u in units for m in u], chars_per_token) > budget_tokens:
        if len(units) == 1:
            break
        dropped += len(units.pop(0))

    flat = [m for unit in units for m in unit]
    if system:
        flat = [system] + flat
    truncated = False
    # If a single remaining unit is still too large, clamp its largest
    # messages. This preserves request validity at the cost of content.
    while estimate_tokens(flat, chars_per_token) > budget_tokens:
        largest_index = -1
        largest_len = 0
        for index, message in enumerate(flat):
            if message is system:
                continue
            content = message.get("content")
            length = len(content) if isinstance(content, str) else 0
            if length > largest_len:
                largest_len = length
                largest_index = index
        if largest_index < 0 or largest_len <= 40:
            # Tool arguments/IDs are immutable protocol data. If they alone
            # exceed the budget, discard the whole turn, including results.
            dropped += len(flat) - (1 if system else 0)
            flat = [system] if system else []
            truncated = True
            break
        target = max(40, largest_len // 2)
        clone = dict(flat[largest_index])
        content = clone.get("content")
        if isinstance(content, str):
            clone["content"] = truncate_text(
                content, target, note="\n... (truncated to fit context budget)"
            )
            flat[largest_index] = clone
            truncated = True
        else:
            break
    return flat, dropped, truncated
