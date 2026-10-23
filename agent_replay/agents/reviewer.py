"""Advisory reviewer agent.

The reviewer inspects the diff and test evidence and returns structured
issues. It never edits files and never decides success: the harness grader
remains the authority. Rejections feed another coder round within a cap.
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from typing import Any

from ..harness.errors import ModelError
from ..harness.model_client import ModelClient
from ..harness.types import RunState, TaskSpec, TokenUsage
from ..harness.workspace import TaskWorkspace


@dataclass
class ReviewResult:
    approved: bool | None
    issues: list[str] = field(default_factory=list)
    feedback: str = ""
    raw: str = ""
    usage: TokenUsage = field(default_factory=lambda: TokenUsage(reported=False))
    latency_ms: int = 0
    error: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "approved": self.approved,
            "issues": self.issues,
            "feedback": self.feedback,
            "raw": self.raw,
            "usage": self.usage.to_dict(),
            "latency_ms": self.latency_ms,
            "error": self.error,
        }


def _parse_review(raw: str) -> tuple[bool | None, list[str], str] | None:
    text = raw.strip()
    if text.startswith("```"):
        text = text.strip("`")
        if text.startswith("json"):
            text = text[4:]
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end <= start:
        return None
    try:
        data = json.loads(text[start : end + 1])
    except json.JSONDecodeError:
        return None
    if not isinstance(data, dict) or not isinstance(data.get("approved"), bool):
        return None
    issues_raw = data.get("issues") or []
    if isinstance(issues_raw, str):
        issues = [issues_raw]
    elif isinstance(issues_raw, list):
        issues = [str(item) for item in issues_raw]
    else:
        issues = [str(issues_raw)]
    feedback = str(data.get("feedback") or "")
    if not feedback:
        feedback = "; ".join(issues)
    return data["approved"], issues, feedback


class ReviewerAgent:
    name = "reviewer"

    def __init__(self, model: ModelClient, *, max_patch_chars: int = 12_000) -> None:
        self.model = model
        self.max_patch_chars = max_patch_chars

    @property
    def model_name(self) -> str:
        return self.model.model

    def review(
        self,
        task: TaskSpec,
        state: RunState,
        workspace: TaskWorkspace,
        *,
        test_report: dict[str, Any] | None = None,
        timeout_seconds: int = 90,
    ) -> ReviewResult:
        patch = workspace.patch()[: self.max_patch_chars]
        report = test_report or {}
        test_summary = (
            f"{report.get('passed', 0)} passed, {report.get('failed', 0)} failed, "
            f"total {report.get('total', 0)}, exit {report.get('exit_code')}"
            if report
            else "no test report available"
        )
        messages = [
            {
                "role": "system",
                "content": (
                    "You are a code reviewer for a coding-agent harness. You do not "
                    "modify files. Review the diff and test evidence for correctness, "
                    "regressions, and constraint violations. Return strict JSON only: "
                    '{"approved": true|false, "issues": ["..."], "feedback": "..."}. '
                    "Reject only for concrete issues; tests remain the final authority."
                ),
            },
            {
                "role": "user",
                "content": (
                    f"Task:\n{task.instruction}\n\n"
                    f"Changed files: {', '.join(state.files_changed) or '(none)'}\n"
                    f"Tests: {test_summary}\n\n"
                    f"Diff:\n{patch or '(no changes)'}"
                ),
            },
        ]
        started = time.monotonic()
        try:
            turn = self.model.complete(messages, [], timeout_seconds=timeout_seconds)
        except ModelError as exc:
            return ReviewResult(
                approved=None,
                issues=[f"reviewer_error: {exc}"],
                feedback="Reviewer unavailable; the harness grader remains authoritative.",
                error=str(exc),
                latency_ms=int((time.monotonic() - started) * 1000),
            )
        latency_ms = int((time.monotonic() - started) * 1000)
        parsed = _parse_review(turn.text or "")
        if parsed is None:
            return ReviewResult(
                approved=None,
                issues=["reviewer_output_unparsable"],
                feedback="Reviewer output could not be parsed; no review feedback applied.",
                raw=turn.text or "",
                usage=turn.usage,
                latency_ms=latency_ms,
                error="unparsable_review",
            )
        approved, issues, feedback = parsed
        return ReviewResult(
            approved=approved,
            issues=issues,
            feedback=feedback,
            raw=turn.text or "",
            usage=turn.usage,
            latency_ms=latency_ms,
        )
