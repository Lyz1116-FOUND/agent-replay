"""Failure taxonomy for harness optimization.

F1-F12 are the taxonomy from the M6 plan. F13 and I1 cover two cases the
original list did not name separately: constraint violations and
infrastructure/provider failures. Classification uses recorded evidence, not
model self-report.
"""

from __future__ import annotations

from typing import Any

TAXONOMY: dict[str, str] = {
    "F1": "task_understanding",
    "F2": "wrong_file",
    "F3": "wrong_tool",
    "F4": "invalid_tool_args",
    "F5": "context_loss",
    "F6": "incorrect_patch",
    "F7": "test_not_run",
    "F8": "test_failure",
    "F9": "regression",
    "F10": "stuck_loop",
    "F11": "premature_finish",
    "F12": "timeout",
    "F13": "constraint_violation",
    "I1": "infrastructure",
}


def _agent_test_runs(record: dict[str, Any]) -> list[dict[str, Any]]:
    diagnostics = record.get("diagnostics") or {}
    return [
        run
        for run in diagnostics.get("test_runs") or []
        if run.get("stage") == "agent"
    ]


def _invalid_kinds(record: dict[str, Any]) -> dict[str, int]:
    counts: dict[str, int] = {}
    diagnostics = record.get("diagnostics") or {}
    for call in diagnostics.get("tool_calls") or []:
        kind = (call.get("metadata") or {}).get("invalid_kind")
        if kind:
            counts[str(kind)] = counts.get(str(kind), 0) + 1
    return counts


def _posthoc_failed(record: dict[str, Any]) -> list[str]:
    posthoc = record.get("posthoc") or {}
    tests = posthoc.get("tests") or record.get("tests") or {}
    return list(tests.get("failed_tests") or [])


def classify_failure(record: dict[str, Any]) -> dict[str, Any] | None:
    """Return the primary failure category, or None for a verified success."""
    if record.get("success") and record.get("verified_success"):
        return None
    diagnostics = record.get("diagnostics") or {}
    posthoc = record.get("posthoc") or {}
    reason = record.get("failure_reason")
    status = record.get("status")
    files_changed = list(record.get("files_changed") or [])
    expected = list(record.get("expected_paths") or [])
    agent_tests = _agent_test_runs(record)
    invalid = _invalid_kinds(record)
    context_builds = diagnostics.get("context") or []
    context_dropped = sum(int(build.get("dropped_messages", 0) or 0) for build in context_builds)
    reads = diagnostics.get("reads_by_file") or {}
    max_reads = max((int(value) for value in reads.values()), default=0)
    claimed = bool(record.get("claimed_finish"))
    steps = int(record.get("steps", 0) or 0)
    last_agent_test = agent_tests[-1] if agent_tests else None

    def result(code: str, detail: str | None = None) -> dict[str, Any]:
        return {
            "code": code,
            "label": TAXONOMY[code],
            "detail": detail,
        }

    if posthoc.get("protected_modified") or reason in ("tests_modified", "patch_too_large"):
        return result("F13", "protected path modified or patch exceeded the limit")
    if status == "timeout" or reason in ("timeout", "test_timeout"):
        return result("F12")
    if status in ("provider_error", "harness_error") or reason in (
        "provider_error",
        "harness_error",
    ):
        return result("I1", reason)
    if reason == "aborted":
        return result("I1", "run aborted by caller")
    if reason in (
        "max_steps",
        "stuck_loop",
        "max_agent_calls",
        "max_total_tokens",
    ) or diagnostics.get("stuck_loop"):
        return result("F10", reason)
    if record.get("regression"):
        new_tests = [test for test in _posthoc_failed(record) if test not in set(record.get("baseline_failed_tests") or [])]
        return result("F9", ", ".join(new_tests[:5]))
    if invalid.get("unknown_tool"):
        return result("F3", f"{invalid['unknown_tool']} unknown tool call(s)")
    if invalid.get("invalid_arguments"):
        return result("F4", f"{invalid['invalid_arguments']} invalid tool argument error(s)")
    if not files_changed and context_dropped and max_reads >= 3:
        return result("F5", "old context was dropped and the agent re-read the same file repeatedly")
    if not files_changed:
        if claimed and steps <= 3:
            return result("F11", "claimed completion without editing or verifying")
        if not agent_tests:
            return result("F7", "no source edit and no agent-run test")
        return result("F1", "no source edit")
    if not agent_tests:
        return result("F7", "finished without running the tests")
    if expected and not (set(files_changed) & set(expected)):
        return result("F2", f"edited {', '.join(files_changed[:3])}")
    if str((last_agent_test or {}).get("status")) == "fail":
        return result("F8", "the agent's last test run still failed")
    tests = posthoc.get("tests") or record.get("tests") or {}
    if str(tests.get("status")) == "fail":
        return result("F6", "final tests failed")
    if record.get("success") and not record.get("verified_success"):
        return result("F6", "harness and post-hoc verification disagree")
    return result("F6")


def failure_counts(records: list[dict[str, Any]]) -> dict[str, Any]:
    counts: dict[str, int] = {}
    examples: dict[str, list[str]] = {}
    for record in records:
        classification = classify_failure(record)
        if classification is None:
            continue
        code = classification["code"]
        counts[code] = counts.get(code, 0) + 1
        examples.setdefault(code, [])
        if len(examples[code]) < 3:
            examples[code].append(str(record.get("task_id")))
    ordered = {code: counts[code] for code in sorted(counts)}
    return {
        "counts": ordered,
        "labels": {code: TAXONOMY[code] for code in ordered},
        "examples": {code: examples[code] for code in ordered},
    }
