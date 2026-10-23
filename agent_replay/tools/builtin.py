"""The six built-in coding tools."""

from __future__ import annotations

from ..harness.registry import ToolRegistry
from ..harness.workspace import TaskWorkspace
from .git_diff import GitDiffTool
from .grep import GrepTool
from .read_file import ReadFileTool
from .run_tests import RunTestsTool
from .shell import ShellTool
from .write_file import WriteFileTool


def build_default_registry(
    workspace: TaskWorkspace,
    *,
    test_command: str | None,
    tool_timeout_seconds: int = 120,
    max_tool_output_chars: int = 10_000,
    max_file_bytes: int = 200_000,
) -> ToolRegistry:
    registry = ToolRegistry(max_output_chars=max_tool_output_chars)
    registry.register_all(
        [
            ReadFileTool(workspace, max_file_bytes=max_file_bytes),
            GrepTool(workspace),
            WriteFileTool(workspace),
            ShellTool(
                workspace,
                default_timeout_seconds=tool_timeout_seconds,
                default_max_output_chars=max_tool_output_chars,
            ),
            RunTestsTool(
                workspace,
                test_command,
                default_timeout_seconds=tool_timeout_seconds,
            ),
            GitDiffTool(workspace),
        ]
    )
    return registry
