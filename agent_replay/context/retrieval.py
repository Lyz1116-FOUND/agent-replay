"""Deterministic keyword retrieval over old observations.

Compression is an experiment variable, so the default retriever is simple and
reproducible: no embeddings, no extra model calls, no hidden ranking service.
"""

from __future__ import annotations

import re
from typing import Any

_WORD = re.compile(r"[A-Za-z_][A-Za-z0-9_./:-]{2,}")


class KeywordRetriever:
    def __init__(self, max_snippets: int = 4) -> None:
        self.max_snippets = max_snippets

    def select(
        self, messages: list[dict[str, Any]], query: str, *, max_chars: int = 1200
    ) -> list[str]:
        terms = {term.lower() for term in _WORD.findall(query)}
        if not terms:
            return []
        scored: list[tuple[int, int, str]] = []
        for index, message in enumerate(messages):
            if message.get("role") not in ("tool", "assistant"):
                continue
            text = message.get("content")
            if not isinstance(text, str) or not text:
                continue
            lower = text.lower()
            score = sum(1 for term in terms if term in lower)
            if score:
                scored.append((score, index, text))
        scored.sort(key=lambda item: (-item[0], -item[1]))
        snippets: list[str] = []
        used = 0
        for _, _, text in scored[: self.max_snippets]:
            snippet = text[:600]
            if used + len(snippet) > max_chars:
                break
            snippets.append(snippet)
            used += len(snippet)
        return snippets
