"""Deterministic extractive history summary.

A model-written summary would add tokens and another failure surface. The
compression experiment holds that variable constant; this summarizer extracts
facts already recorded by the harness (paths, commands, test outcomes) and
keeps them in a compact block.
"""

from __future__ import annotations

from typing import Any

from ..harness.types import RunState
from .retrieval import KeywordRetriever


def build_structured_state(state: RunState) -> dict[str, Any]:
    """Small, explicit facts appended alongside the model history."""
    test_runs = state.diagnostics.get("test_runs") or []
    last_test = test_runs[-1] if test_runs else {}
    return {
        "goal": state.task.instruction,
        "hypotheses": [],
        "files_read": list(state.files_read),
        "files_changed": list(state.files_changed),
        "tests_failed": list(last_test.get("failed_tests") or []),
        "remaining_work": list(state.grader_feedback[-1:]),
    }


class ExtractiveSummarizer:
    def __init__(self, max_chars: int = 3000, retriever: KeywordRetriever | None = None) -> None:
        self.max_chars = max_chars
        self.retriever = retriever or KeywordRetriever()

    def summarize(self, old_messages: list[dict[str, Any]], state: RunState) -> str:
        lines: list[str] = ["[Compressed history]"]
        if state.files_read:
            lines.append("Files read: " + ", ".join(state.files_read[-12:]))
        if state.files_changed:
            lines.append("Files changed: " + ", ".join(state.files_changed[-12:]))

        actions: list[str] = []
        for message in old_messages:
            if message.get("role") != "assistant":
                continue
            for call in message.get("tool_calls") or []:
                function = call.get("function", {}) if isinstance(call, dict) else {}
                name = function.get("name")
                if name:
                    actions.append(str(name))
        if actions:
            counts: dict[str, int] = {}
            for name in actions:
                counts[name] = counts.get(name, 0) + 1
            lines.append(
                "Earlier tool calls: "
                + ", ".join(f"{name}x{count}" for name, count in sorted(counts.items()))
            )

        test_runs = state.diagnostics.get("test_runs") or []
        if test_runs:
            latest = test_runs[-1]
            lines.append(
                "Recent test result: "
                f"{latest.get('passed', 0)} passed, {latest.get('failed', 0)} failed, "
                f"exit {latest.get('exit_code')}"
            )

        if state.grader_feedback:
            query = state.grader_feedback[-1]
            snippets = self.retriever.select(old_messages, query)
            if snippets:
                lines.append("Possibly relevant earlier observations:")
                for snippet in snippets:
                    first = " ".join(snippet.splitlines()[:4])
                    lines.append(f"- {first[:300]}")
            lines.append("Latest verifier feedback: " + " ".join(query.split())[:500])

        if len(lines) == 1:
            lines.append("No earlier actions were retained.")
        text = "\n".join(lines)
        return text[: self.max_chars]
