"""Run the task's test command and return structured results."""

from __future__ import annotations

import shlex
import time
from typing import Any

from ..harness.types import ToolResult
from ..harness.workspace import TaskWorkspace
from .base import Tool
from .test_parsing import run_test_command


class RunTestsTool(Tool):
    name = "run_tests"
    description = (
        "Run the task's configured test suite, optionally narrowed to one test "
        "target. Returns passed/failed/total counts, exit code, duration, and "
        "the failed test IDs."
    )
    parameters: dict[str, Any] = {
        "type": "object",
        "properties": {
            "target": {
                "type": "string",
                "minLength": 1,
                "description": "Optional test path or node id, e.g. tests/test_calc.py::test_add.",
            },
            "timeout_seconds": {"type": "integer", "minimum": 1, "maximum": 600},
        },
        "additionalProperties": False,
    }

    def __init__(
        self,
        workspace: TaskWorkspace,
        test_command: str | None,
        *,
        default_timeout_seconds: int = 120,
    ) -> None:
        self.workspace = workspace
        self.test_command = test_command
        self.default_timeout_seconds = default_timeout_seconds

    def execute(self, **kwargs: Any) -> ToolResult:
        started = time.monotonic()
        if not self.test_command:
            return ToolResult(
                success=False,
                error="no test command is configured for this task",
                duration_ms=int((time.monotonic() - started) * 1000),
            )
        command = self.test_command
        target = kwargs.get("target")
        if target:
            command = f"{command} {shlex.quote(str(target))}"
        timeout = min(
            int(kwargs.get("timeout_seconds") or self.default_timeout_seconds),
            self.default_timeout_seconds,
        )
        report = run_test_command(
            command,
            str(self.workspace.root),
            timeout_seconds=self.remaining_timeout(timeout),
            max_output_chars=40_000,
        )
        data = report.to_dict()
        output = report.output or "(no test output)"
        summary = (
            f"{report.passed} passed, {report.failed} failed, "
            f"{report.total} total (exit {report.exit_code})"
        )
        if report.failed_tests:
            summary += "\nfailed: " + ", ".join(report.failed_tests)
        if report.timed_out:
            summary += "\n(test command timed out)"
        if not report.parse_ok:
            summary += "\n(test summary could not be parsed; treat the result as unknown)"
        if report.timed_out:
            error = "test command timed out"
        elif report.exit_code is None:
            error = "test command could not execute"
        else:
            error = None
        return ToolResult(
            success=report.exit_code is not None and not report.timed_out,
            output=f"{summary}\n\n{output}",
            error=error,
            metadata=data,
            duration_ms=int((time.monotonic() - started) * 1000),
        )
