"""Scripted action plans for harness mechanics tests.

These plans read the task's ``reference/`` directory. They are an oracle
fixture, not an agent: use them to prove the loop, tools, grader, retry, and
artifacts work. Scripted results must never be reported as model capability.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from .types import TaskSpec


def reference_files(task: TaskSpec) -> dict[str, str]:
    root = Path(task.repo_path) / "reference"
    files: dict[str, str] = {}
    if not root.is_dir():
        return files
    for path in sorted(root.rglob("*")):
        if path.is_file() and "__pycache__" not in path.parts:
            files[path.relative_to(root).as_posix()] = path.read_text(encoding="utf-8")
    return files


def oracle_actions(
    task: TaskSpec,
    *,
    compact: bool = False,
    fail_first: bool = False,
    verify: bool = True,
) -> list[dict[str, Any]]:
    files = reference_files(task)
    writes = [
        {"name": "write_file", "arguments": {"path": path, "content": content}}
        for path, content in files.items()
    ]
    actions: list[dict[str, Any]] = []
    if fail_first:
        actions.append({"text": "I believe the task is already fixed."})
    if compact:
        actions.append({"tools": writes})
        return actions
    if task.expected_paths:
        actions.append(
            {
                "tool": "read_file",
                "arguments": {"path": task.expected_paths[0]},
            }
        )
    actions.append({"tools": writes})
    if verify:
        actions.append({"tool": "run_tests", "arguments": {}})
        actions.append({"tool": "git_diff", "arguments": {"stat_only": True}})
    actions.append({"text": "The source has been fixed and the tests pass."})
    return actions


def oracle_context_actions(task: TaskSpec) -> list[dict[str, Any]]:
    """Oracle plan with a large distractor read, for context experiments."""
    actions: list[dict[str, Any]] = []
    if (Path(task.repo_path) / "CONTEXT.md").is_file():
        actions.append(
            {"tool": "read_file", "arguments": {"path": "CONTEXT.md"}}
        )
    actions.extend(oracle_actions(task))
    return actions


def noop_actions() -> list[dict[str, Any]]:
    return [{"text": "I believe the task is already complete."}]
