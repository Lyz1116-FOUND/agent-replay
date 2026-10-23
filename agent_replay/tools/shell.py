"""Bounded shell execution inside the workspace.

This is deliberately not a security sandbox. It enforces containment
(cwd/root), a timeout, output caps, a denylist for destructive or outbound
commands, and a credential-stripped environment. Documentation states the
remaining boundary honestly.
"""

from __future__ import annotations

import re
import time
from typing import Any

from ..harness.errors import WorkspaceError
from ..harness.types import ToolResult
from ..harness.workspace import TaskWorkspace, resolve_python
from .base import Tool
from .process import run_bounded_command
from .test_parsing import sanitized_env

_DENY_PATTERNS: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"(^|[;&|]\s*)sudo\b"), "sudo is not allowed"),
    (re.compile(r"(^|[;&|]\s*)su\b"), "su is not allowed"),
    (re.compile(r"(^|[;&|]\s*)ssh\b"), "ssh is not allowed"),
    (re.compile(r"(^|[;&|]\s*)scp\b"), "scp is not allowed"),
    (re.compile(r"(^|[;&|]\s*)nc\b"), "netcat is not allowed"),
    (re.compile(r"(^|[;&|]\s*)(shutdown|reboot|halt)\b"), "system shutdown is not allowed"),
    (re.compile(r"(^|[;&|]\s*)mkfs\b"), "filesystem formatting is not allowed"),
    (re.compile(r"\bdd\s+if="), "dd is not allowed"),
    (re.compile(r"\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r)\b"), "rm -rf is not allowed"),
    (re.compile(r"\bgit\s+(reset\s+--hard|clean\s+-[a-zA-Z]*f|push)\b"), "destructive or outbound git commands are not allowed"),
    (re.compile(r"\bchmod\s+-R\s+777\s+/"), "changing root permissions is not allowed"),
    (re.compile(r"(curl|wget)[^|;&]*\|\s*(sh|bash|zsh)\b"), "piping downloads into a shell is not allowed"),
    (re.compile(r">\s*/dev/(sd|disk)"), "raw device writes are not allowed"),
)


def check_command(command: str) -> str | None:
    for pattern, reason in _DENY_PATTERNS:
        if pattern.search(command):
            return reason
    return None


class ShellTool(Tool):
    name = "shell"
    description = (
        "Run a shell command with the repository root as cwd. Output, duration, "
        "exit code and timeout are recorded. Destructive and outbound commands "
        "are rejected."
    )
    parameters: dict[str, Any] = {
        "type": "object",
        "properties": {
            "command": {"type": "string", "minLength": 1},
            "cwd": {"type": "string", "default": "."},
            "timeout_seconds": {"type": "integer", "minimum": 1, "maximum": 600},
            "max_output_chars": {"type": "integer", "minimum": 100, "maximum": 200_000},
        },
        "required": ["command"],
        "additionalProperties": False,
    }

    def __init__(
        self,
        workspace: TaskWorkspace,
        *,
        default_timeout_seconds: int = 120,
        default_max_output_chars: int = 20_000,
    ) -> None:
        self.workspace = workspace
        self.default_timeout_seconds = default_timeout_seconds
        self.default_max_output_chars = default_max_output_chars

    def execute(self, **kwargs: Any) -> ToolResult:
        started = time.monotonic()
        command = resolve_python(str(kwargs["command"]))
        denied = check_command(command)
        if denied:
            return ToolResult(
                success=False,
                error=f"command rejected: {denied}",
                metadata={"command": command, "rejected": True},
                duration_ms=int((time.monotonic() - started) * 1000),
            )
        try:
            cwd = self.workspace.resolve(str(kwargs.get("cwd") or "."), must_exist=True)
            if not cwd.is_dir():
                raise WorkspaceError("cwd is not a directory")
        except WorkspaceError as exc:
            return ToolResult(
                success=False,
                error=str(exc),
                metadata={"command": command},
                duration_ms=int((time.monotonic() - started) * 1000),
            )

        timeout = min(
            int(kwargs.get("timeout_seconds") or self.default_timeout_seconds),
            self.default_timeout_seconds,
        )
        max_chars = int(kwargs.get("max_output_chars") or self.default_max_output_chars)
        env = sanitized_env()
        env["PWD"] = str(cwd)
        try:
            result = run_bounded_command(
                command, cwd=str(cwd), env=env, timeout_seconds=self.remaining_timeout(timeout),
                max_output_chars=min(max_chars, self.default_max_output_chars),
            )
            if result.timed_out:
                return ToolResult(
                    success=False, output=result.output,
                    error=f"command timed out after {timeout}s",
                    metadata={"command": command, "timed_out": True, "exit_code": None},
                    duration_ms=int((time.monotonic() - started) * 1000),
                )
            output = result.output
            truncated = result.truncated
            return ToolResult(
                success=True,
                output=output or "(no output)",
                metadata={
                    "command": command,
                    "cwd": self.workspace.relative(cwd),
                    "exit_code": result.returncode,
                    "ok": result.returncode == 0,
                    "timed_out": False,
                    "truncated": truncated,
                },
                duration_ms=int((time.monotonic() - started) * 1000),
            )
        except OSError as exc:
            return ToolResult(
                success=False,
                error=f"command failed to start: {exc}",
                metadata={"command": command, "exit_code": None},
                duration_ms=int((time.monotonic() - started) * 1000),
            )
