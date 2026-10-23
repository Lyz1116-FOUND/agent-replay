"""Graders own the success verdict (M0/M4).

The model may *claim* completion; only a grader can pass a run. The default
composite runs constraints first so a rewritten test file is rejected before
its modified tests are executed, then runs the task's own test command in the
final workspace.
"""

from __future__ import annotations

import json
from abc import ABC, abstractmethod
from typing import Any

from .types import GradeResult, RunState, TaskSpec
from .workspace import TaskWorkspace
from ..tools.test_parsing import TestReport, run_test_command


class Grader(ABC):
    name = "base"

    @abstractmethod
    def grade(
        self,
        workspace: TaskWorkspace,
        task: TaskSpec,
        state: RunState,
        *,
        baseline_protected: dict[str, str],
    ) -> GradeResult:
        raise NotImplementedError


def _tail(text: str, limit: int = 2000) -> str:
    text = text.strip()
    return text if len(text) <= limit else "..." + text[-limit:]


def test_report_from_grade(grade: GradeResult | None) -> dict[str, Any] | None:
    if grade is None:
        return None
    evidence = grade.evidence
    if isinstance(evidence.get("test_report"), dict):
        return evidence["test_report"]
    tests = evidence.get("tests")
    if isinstance(tests, dict) and isinstance(tests.get("test_report"), dict):
        return tests["test_report"]
    return None


# Imported into pytest modules; its name starts with "test" but it is a helper.
test_report_from_grade.__test__ = False


class TestGrader(Grader):
    __test__ = False  # not a pytest test class

    name = "tests"

    def __init__(
        self,
        test_command: str | None,
        *,
        timeout_seconds: int = 120,
        max_output_chars: int = 40_000,
    ) -> None:
        self.test_command = test_command
        self.timeout_seconds = timeout_seconds
        self.max_output_chars = max_output_chars

    def grade(
        self,
        workspace: TaskWorkspace,
        task: TaskSpec,
        state: RunState,
        *,
        baseline_protected: dict[str, str],
    ) -> GradeResult:
        command = self.test_command or task.test_command
        if not command:
            return GradeResult(
                passed=False,
                score=0.0,
                feedback="No test command is configured, so the harness cannot verify this task.",
                evidence={"error": "no_test_command"},
                authority="harness",
            )
        report = run_test_command(
            command,
            str(workspace.root),
            timeout_seconds=self.timeout_seconds,
            max_output_chars=self.max_output_chars,
        )
        passed = report.status == "pass"
        if passed:
            feedback = f"Tests pass: {report.passed} passed, 0 failed."
        elif report.timed_out:
            feedback = f"Test command timed out after {self.timeout_seconds}s."
        elif not report.parse_ok:
            feedback = (
                "The test command ran but its summary could not be parsed; "
                "treat this as unverified, not as a pass.\n"
                + _tail(report.output)
            )
        else:
            failed = ", ".join(report.failed_tests) if report.failed_tests else "unknown tests"
            feedback = (
                f"Tests still fail: {report.passed} passed, {report.failed} failed "
                f"(exit {report.exit_code}).\nFailed: {failed}\n"
                + _tail(report.output)
            )
        return GradeResult(
            passed=passed,
            score=1.0 if passed else 0.0,
            feedback=feedback,
            evidence={
                "test_report": report.to_dict(),
                "command": report.command,
                "status": report.status,
            },
            authority="harness",
        )


class ConstraintGrader(Grader):
    name = "constraints"

    def __init__(
        self,
        *,
        protected_paths: tuple[str, ...] | None = None,
        max_patch_bytes: int = 200_000,
    ) -> None:
        self.protected_paths = protected_paths
        self.max_patch_bytes = max_patch_bytes

    def grade(
        self,
        workspace: TaskWorkspace,
        task: TaskSpec,
        state: RunState,
        *,
        baseline_protected: dict[str, str],
    ) -> GradeResult:
        protected = self.protected_paths if self.protected_paths is not None else task.protected_paths
        modified = workspace.modified_since(baseline_protected) if protected else []
        patch = workspace.patch()
        patch_bytes = len(patch.encode("utf-8"))
        checks = {
            "protected_paths_unchanged": not modified,
            "patch_within_limit": patch_bytes <= self.max_patch_bytes,
        }
        passed = all(checks.values())
        feedback_parts: list[str] = []
        if modified:
            feedback_parts.append(
                "Protected paths were modified: " + ", ".join(modified)
                + ". Restore them; tests and other protected files must stay unchanged."
            )
        if patch_bytes > self.max_patch_bytes:
            feedback_parts.append(
                f"The patch is {patch_bytes} bytes, above the {self.max_patch_bytes}-byte limit."
            )
        if passed:
            feedback_parts.append(
                f"No protected paths changed; patch is {patch_bytes} bytes."
            )
        return GradeResult(
            passed=passed,
            score=1.0 if passed else 0.0,
            feedback="\n".join(feedback_parts),
            evidence={
                "protected_paths": list(protected),
                "modified_protected": modified,
                "patch_bytes": patch_bytes,
                "max_patch_bytes": self.max_patch_bytes,
                "checks": checks,
                "patch": patch,
            },
            authority="harness",
        )


class CompositeGrader(Grader):
    name = "composite"

    def __init__(self, graders: list[Grader]) -> None:
        self.graders = graders

    def grade(
        self,
        workspace: TaskWorkspace,
        task: TaskSpec,
        state: RunState,
        *,
        baseline_protected: dict[str, str],
    ) -> GradeResult:
        evidence: dict[str, Any] = {}
        feedback: list[str] = []
        scores: list[float] = []
        passed = True
        constraints_ok = True

        for grader in self.graders:
            if isinstance(grader, TestGrader) and not constraints_ok:
                evidence["tests"] = {
                    "skipped": "constraint_violation",
                    "test_report": None,
                }
                scores.append(0.0)
                continue
            result = grader.grade(
                workspace, task, state, baseline_protected=baseline_protected
            )
            evidence[grader.name] = result.evidence
            feedback.append(result.feedback)
            scores.append(result.score)
            passed = passed and result.passed
            if grader.name == "constraints":
                checks = result.evidence.get("checks") or {}
                constraints_ok = bool(checks.get("protected_paths_unchanged", True))

        # Tests execute task code, which can mutate the workspace too. The
        # verdict must describe the final filesystem, after verification.
        for grader in self.graders:
            if isinstance(grader, ConstraintGrader) and constraints_ok:
                checked = grader.grade(workspace, task, state, baseline_protected=baseline_protected)
                evidence[grader.name] = checked.evidence
                if not checked.passed:
                    passed = False
                    feedback.append(checked.feedback)
                    scores.append(0.0)

        return GradeResult(
            passed=passed,
            score=round(sum(scores) / len(scores), 4) if scores else 0.0,
            feedback="\n".join(part for part in feedback if part),
            evidence=evidence,
            authority="harness",
        )


class AgentClaimGrader(Grader):
    """Explicit no-verification baseline.

    Used only by the verification experiment. It makes the difference between
    "the model said it was done" and "the harness verified it" measurable.
    """

    name = "agent_claim"

    def grade(
        self,
        workspace: TaskWorkspace,
        task: TaskSpec,
        state: RunState,
        *,
        baseline_protected: dict[str, str],
    ) -> GradeResult:
        passed = state.claimed_finish
        return GradeResult(
            passed=passed,
            score=1.0 if passed else 0.0,
            feedback=(
                "Accepted the model's completion claim without verification."
                if passed
                else "The model did not claim completion."
            ),
            evidence={"claimed_finish": passed, "authority": "agent"},
            authority="agent",
        )


class LLMGrader(Grader):
    """Optional advisory judge. Never the default success authority."""

    name = "llm"

    def __init__(self, model: Any, *, min_score: float = 0.7, max_patch_chars: int = 12_000) -> None:
        self.model = model
        self.min_score = min_score
        self.max_patch_chars = max_patch_chars

    def grade(
        self,
        workspace: TaskWorkspace,
        task: TaskSpec,
        state: RunState,
        *,
        baseline_protected: dict[str, str],
    ) -> GradeResult:
        patch = workspace.patch()[: self.max_patch_chars]
        messages = [
            {
                "role": "system",
                "content": (
                    "You are an advisory code reviewer. Return strict JSON: "
                    '{"score": 0.0-1.0, "feedback": "..."}. Judge whether the patch '
                    "addresses the instruction without breaking behavior. Do not use tools."
                ),
            },
            {
                "role": "user",
                "content": (
                    f"Task:\n{task.instruction}\n\nDiff:\n{patch or '(no changes)'}\n\n"
                    f"Changed files: {', '.join(state.files_changed) or '(none)'}"
                ),
            },
        ]
        turn = self.model.complete(messages, [], timeout_seconds=60)
        raw = (turn.text or "").strip()
        if raw.startswith("```"):
            raw = raw.strip("`")
            if raw.startswith("json"):
                raw = raw[4:]
        try:
            data = json.loads(raw)
            score = max(0.0, min(1.0, float(data.get("score", 0))))
            feedback = str(data.get("feedback", ""))
        except (json.JSONDecodeError, TypeError, ValueError):
            return GradeResult(
                passed=False,
                score=0.0,
                feedback="LLM grader returned unparsable output.",
                evidence={"raw": turn.text},
                authority="llm",
            )
        return GradeResult(
            passed=score >= self.min_score,
            score=score,
            feedback=feedback,
            evidence={"raw": data},
            authority="llm",
        )


def build_default_grader(
    task: TaskSpec,
    *,
    timeout_seconds: int = 120,
    max_patch_bytes: int = 200_000,
    verification: str = "composite",
) -> Grader:
    """Build the configured grader. ``verification`` is composite/claim/none."""
    if verification == "claim":
        return AgentClaimGrader()
    if verification == "none":
        return AgentClaimGrader()
    return CompositeGrader(
        [
            ConstraintGrader(
                protected_paths=task.protected_paths,
                max_patch_bytes=max_patch_bytes,
            ),
            TestGrader(task.test_command, timeout_seconds=timeout_seconds),
        ]
    )
