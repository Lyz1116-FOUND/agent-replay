"""Create or replace a text file inside the workspace."""

from __future__ import annotations

import time
from typing import Any

from ..harness.errors import WorkspaceError
from ..harness.types import ToolResult
from ..harness.workspace import TaskWorkspace
from .base import Tool

_PREVIEW_LIMIT = 8000


class WriteFileTool(Tool):
    name = "write_file"
    description = (
        "Create or overwrite a UTF-8 text file inside the repository. Parent "
        "directories are created. The harness records the resulting diff."
    )
    parameters: dict[str, Any] = {
        "type": "object",
        "properties": {
            "path": {"type": "string", "minLength": 1},
            "content": {"type": "string"},
        },
        "required": ["path", "content"],
        "additionalProperties": False,
    }

    def __init__(self, workspace: TaskWorkspace) -> None:
        self.workspace = workspace

    def execute(self, **kwargs: Any) -> ToolResult:
        started = time.monotonic()
        relative = str(kwargs["path"])
        content = str(kwargs["content"])
        try:
            path = self.workspace.resolve(relative)
            if path.exists() and not path.is_file():
                raise WorkspaceError(f"not a regular file: {relative}")
            created = not path.exists()
            before = ""
            if not created:
                try:
                    before = path.read_text(encoding="utf-8", errors="replace")[:_PREVIEW_LIMIT]
                except OSError:
                    before = ""
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content, encoding="utf-8")
        except WorkspaceError as exc:
            return ToolResult(
                success=False,
                error=str(exc),
                duration_ms=int((time.monotonic() - started) * 1000),
            )
        except OSError as exc:
            return ToolResult(
                success=False,
                error=f"write failed: {exc}",
                duration_ms=int((time.monotonic() - started) * 1000),
            )

        display = self.workspace.relative(path)
        action = "Created" if created else "Updated"
        return ToolResult(
            success=True,
            output=f"{action} {display} ({len(content.encode('utf-8'))} bytes)",
            metadata={
                "path": display,
                "created": created,
                "bytes": len(content.encode("utf-8")),
                "before": before,
                "after": content[:_PREVIEW_LIMIT],
            },
            duration_ms=int((time.monotonic() - started) * 1000),
        )
