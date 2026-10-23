"""Run a test command and return a structured, auditable report.

Counts come from the shared parser used by the existing evaluator. Failed test
IDs are extracted separately so regression detection can distinguish a known
baseline failure from a newly broken test.
"""

from __future__ import annotations

import os
import re
import time
from dataclasses import dataclass, field
from typing import Any

from ..core.executor import parse_test_output, strip_ansi
from ..harness.workspace import resolve_python
from .process import run_bounded_command

_FAILED_LINE = re.compile(r"^(?:FAILED|ERROR)\s+([^\s:]+(?:::[^\s]+)?)", re.MULTILINE)


def sanitized_env() -> dict[str, str]:
    env = {
        key: value
        for key, value in os.environ.items()
        if not re.search(r"(API[_-]?KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)", key, re.I)
    }
    env.update(
        {
            "GIT_TERMINAL_PROMPT": "0",
            "PYTHONUNBUFFERED": "1",
            "PYTHONDONTWRITEBYTECODE": "1",
            "FORCE_COLOR": "0",
            "NO_COLOR": "1",
        }
    )
    return env


@dataclass
class TestReport:
    command: str
    exit_code: int | None
    passed: int = 0
    failed: int = 0
    total: int = 0
    duration_ms: int = 0
    output: str = ""
    failed_tests: list[str] = field(default_factory=list)
    parse_ok: bool = False
    timed_out: bool = False
    status: str = "unknown"  # pass | fail | unknown

    @property
    def green(self) -> bool:
        return self.status == "pass"

    def to_dict(self) -> dict[str, Any]:
        return {
            "command": self.command,
            "exit_code": self.exit_code,
            "passed": self.passed,
            "failed": self.failed,
            "total": self.total,
            "duration_ms": self.duration_ms,
            "failed_tests": self.failed_tests,
            "parse_ok": self.parse_ok,
            "timed_out": self.timed_out,
            "status": self.status,
            "output": self.output,
        }


def _failed_test_ids(output: str) -> list[str]:
    ids: list[str] = []
    for match in _FAILED_LINE.finditer(strip_ansi(output)):
        test_id = match.group(1)
        if test_id not in ids:
            ids.append(test_id)
    return ids


def run_test_command(
    command: str,
    cwd: str,
    *,
    timeout_seconds: int = 120,
    max_output_chars: int = 40_000,
) -> TestReport:
    resolved = resolve_python(command)
    started = time.monotonic()
    try:
        result = run_bounded_command(
            resolved, cwd=cwd, env=sanitized_env(),
            timeout_seconds=timeout_seconds, max_output_chars=max_output_chars,
        )
        duration_ms = int((time.monotonic() - started) * 1000)
        raw = result.output
        if result.timed_out:
            return TestReport(
                command=resolved, exit_code=None, duration_ms=duration_ms,
                output=strip_ansi(raw), failed_tests=_failed_test_ids(raw),
                timed_out=True, status="unknown",
            )
        clean = strip_ansi(raw)
        parsed = parse_test_output(raw)
        failed_tests = _failed_test_ids(raw)
        if parsed is None:
            return TestReport(
                command=resolved,
                exit_code=result.returncode,
                duration_ms=duration_ms,
                output=clean[:max_output_chars],
                failed_tests=failed_tests,
                parse_ok=False,
                status="unknown",
            )
        status = (
            "pass"
            if result.returncode == 0 and parsed.failed == 0 and parsed.passed > 0
            else "fail"
        )
        return TestReport(
            command=resolved,
            exit_code=result.returncode,
            passed=parsed.passed,
            failed=parsed.failed,
            total=parsed.total,
            duration_ms=duration_ms,
            output=clean[:max_output_chars],
            failed_tests=failed_tests,
            parse_ok=True,
            status=status,
        )
    except OSError as exc:
        duration_ms = int((time.monotonic() - started) * 1000)
        return TestReport(
            command=resolved,
            exit_code=None,
            duration_ms=duration_ms,
            output=f"failed to execute test command: {exc}",
            parse_ok=False,
            status="unknown",
        )
