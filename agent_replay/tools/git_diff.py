"""Show the agent's own workspace diff."""

from __future__ import annotations

import time
from typing import Any

from ..harness.errors import WorkspaceError
from ..harness.types import ToolResult
from ..harness.workspace import TaskWorkspace
from .base import Tool


class GitDiffTool(Tool):
    name = "git_diff"
    description = (
        "Show the current workspace diff (tracked and untracked files). Use this "
        "to inspect what you have changed before finishing."
    )
    parameters: dict[str, Any] = {
        "type": "object",
        "properties": {
            "path": {"type": "string"},
            "stat_only": {"type": "boolean", "default": False},
            "max_chars": {"type": "integer", "minimum": 100, "maximum": 200_000},
        },
        "additionalProperties": False,
    }

    def __init__(self, workspace: TaskWorkspace, *, default_max_chars: int = 20_000) -> None:
        self.workspace = workspace
        self.default_max_chars = default_max_chars

    def execute(self, **kwargs: Any) -> ToolResult:
        started = time.monotonic()
        try:
            path_arg = kwargs.get("path")
            pathspec = "."
            if path_arg:
                resolved = self.workspace.resolve(str(path_arg))
                pathspec = self.workspace.relative(resolved)
            add = self.workspace.git("add", "-N", "--", pathspec)
            if add.returncode != 0:
                raise WorkspaceError(self.workspace.git_error(add))
            args = ["diff", "--stat"] if kwargs.get("stat_only") else ["diff", "--binary"]
            diff = self.workspace.git(*args, "--", pathspec, timeout=120)
            if diff.returncode != 0:
                raise WorkspaceError(self.workspace.git_error(diff))
            output = diff.stdout
        except WorkspaceError as exc:
            return ToolResult(
                success=False,
                error=str(exc),
                duration_ms=int((time.monotonic() - started) * 1000),
            )

        max_chars = int(kwargs.get("max_chars") or self.default_max_chars)
        truncated = len(output) > max_chars
        if truncated:
            output = output[:max_chars] + f"\n... (truncated at {max_chars} characters)"
        files = self.workspace.changed_files()
        return ToolResult(
            success=True,
            output=output or "(no changes)",
            metadata={
                "path": pathspec,
                "files_changed": files,
                "patch_bytes": len(diff.stdout.encode("utf-8")),
                "truncated": truncated,
                "stat_only": bool(kwargs.get("stat_only")),
            },
            duration_ms=int((time.monotonic() - started) * 1000),
        )
