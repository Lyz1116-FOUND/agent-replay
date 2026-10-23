"""Read a file inside the workspace, with line ranges."""

from __future__ import annotations

import time
from typing import Any

from ..harness.errors import WorkspaceError
from ..harness.types import ToolResult
from ..harness.workspace import TaskWorkspace
from .base import Tool


class ReadFileTool(Tool):
    name = "read_file"
    description = (
        "Read a UTF-8 text file inside the repository. Optionally restrict to a "
        "1-based line range. Paths are relative to the repository root."
    )
    parameters: dict[str, Any] = {
        "type": "object",
        "properties": {
            "path": {"type": "string", "minLength": 1, "description": "Path relative to repo root."},
            "start_line": {"type": "integer", "minimum": 1},
            "end_line": {"type": "integer", "minimum": 1},
        },
        "required": ["path"],
        "additionalProperties": False,
    }

    def __init__(self, workspace: TaskWorkspace, *, max_file_bytes: int = 200_000) -> None:
        self.workspace = workspace
        self.max_file_bytes = max_file_bytes

    def execute(self, **kwargs: Any) -> ToolResult:
        started = time.monotonic()
        relative = str(kwargs["path"])
        start = kwargs.get("start_line")
        end = kwargs.get("end_line")
        if start is not None and end is not None and end < start:
            return ToolResult(
                success=False,
                error=f"end_line ({end}) is before start_line ({start})",
                duration_ms=int((time.monotonic() - started) * 1000),
            )
        try:
            text, truncated = self.workspace.read_text_file(relative, self.max_file_bytes)
        except WorkspaceError as exc:
            return ToolResult(
                success=False,
                error=str(exc),
                duration_ms=int((time.monotonic() - started) * 1000),
            )

        lines = text.splitlines()
        total_lines = len(lines)
        first = int(start) if start is not None else 1
        last = int(end) if end is not None else total_lines
        last = min(last, total_lines)
        selected = lines[first - 1 : last] if first <= last else []
        numbered = "\n".join(f"{first + offset:>6}\t{line}" for offset, line in enumerate(selected))
        if not numbered:
            numbered = "(no lines in the requested range)"
        if truncated:
            numbered += "\n... (file truncated at configured size limit)"

        return ToolResult(
            success=True,
            output=numbered,
            metadata={
                "path": self.workspace.relative(self.workspace.resolve(relative)),
                "start_line": first,
                "end_line": last,
                "total_lines": total_lines,
                "truncated": truncated,
            },
            duration_ms=int((time.monotonic() - started) * 1000),
        )
