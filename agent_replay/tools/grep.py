"""Literal or regex search inside the workspace."""

from __future__ import annotations

import os
import re
import time
from pathlib import Path
from typing import Any

from ..harness.errors import WorkspaceError
from ..harness.types import ToolResult
from ..harness.workspace import TaskWorkspace
from .base import Tool

SKIP_DIRS = {
    ".git",
    "node_modules",
    ".venv",
    "venv",
    "__pycache__",
    ".pytest_cache",
    "dist",
    "dist-cli",
    "dist-demo",
    "results",
    ".agent_replay",
}


class GrepTool(Tool):
    name = "grep"
    description = (
        "Search repository text. Returns matching lines as path:line: text. "
        "Uses a literal query unless regex=true."
    )
    parameters: dict[str, Any] = {
        "type": "object",
        "properties": {
            "query": {"type": "string", "minLength": 1, "maxLength": 500},
            "path": {"type": "string", "default": "."},
            "max_results": {"type": "integer", "minimum": 1, "maximum": 200, "default": 50},
            "regex": {"type": "boolean", "default": False},
        },
        "required": ["query"],
        "additionalProperties": False,
    }

    def __init__(self, workspace: TaskWorkspace, *, max_file_bytes: int = 400_000) -> None:
        self.workspace = workspace
        self.max_file_bytes = max_file_bytes

    def execute(self, **kwargs: Any) -> ToolResult:
        started = time.monotonic()
        query = str(kwargs["query"])
        relative = str(kwargs.get("path") or ".")
        max_results = int(kwargs.get("max_results") or 50)
        use_regex = bool(kwargs.get("regex"))
        try:
            pattern = re.compile(query if use_regex else re.escape(query), re.MULTILINE)
        except re.error as exc:
            return ToolResult(
                success=False,
                error=f"invalid regular expression: {exc}",
                duration_ms=int((time.monotonic() - started) * 1000),
            )
        try:
            target = self.workspace.resolve(relative, must_exist=True, allow_git=True)
        except WorkspaceError as exc:
            return ToolResult(
                success=False,
                error=str(exc),
                duration_ms=int((time.monotonic() - started) * 1000),
            )

        files: list[Path] = []
        if target.is_file():
            files = [target]
        else:
            # os.walk(followlinks=False) keeps a symlinked directory from
            # pulling the search outside the workspace; each file is still
            # resolved and checked before it is read.
            for dirpath, dirnames, filenames in os.walk(target, followlinks=False):
                dirnames[:] = [
                    name for name in dirnames if name not in SKIP_DIRS
                ]
                for name in sorted(filenames):
                    candidate = Path(dirpath) / name
                    try:
                        resolved = candidate.resolve()
                    except OSError:
                        continue
                    if not resolved.is_relative_to(self.workspace.root):
                        continue
                    if any(
                        part in SKIP_DIRS
                        for part in candidate.relative_to(self.workspace.root).parts
                    ):
                        continue
                    try:
                        if candidate.stat().st_size > self.max_file_bytes:
                            continue
                    except OSError:
                        continue
                    files.append(candidate)
                    if len(files) >= 5000:
                        break
                if len(files) >= 5000:
                    break

        matches: list[dict[str, Any]] = []
        truncated = False
        for file_path in files:
            try:
                raw = file_path.read_bytes()
            except OSError:
                continue
            if b"\x00" in raw[:8192]:
                continue
            text = raw.decode("utf-8", errors="replace")
            display = file_path.relative_to(self.workspace.root).as_posix()
            for line_number, line in enumerate(text.splitlines(), start=1):
                if pattern.search(line):
                    matches.append(
                        {"path": display, "line": line_number, "preview": line.strip()[:240]}
                    )
                    if len(matches) >= max_results:
                        truncated = True
                        break
            if truncated:
                break

        output = "\n".join(f"{m['path']}:{m['line']}: {m['preview']}" for m in matches)
        if not output:
            output = "(no matches)"
        return ToolResult(
            success=True,
            output=output,
            metadata={
                "query": query,
                "path": relative,
                "regex": use_regex,
                "count": len(matches),
                "results": matches,
                "truncated": truncated,
            },
            duration_ms=int((time.monotonic() - started) * 1000),
        )
