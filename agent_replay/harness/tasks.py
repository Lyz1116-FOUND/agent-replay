"""Load and validate fixed harness task fixtures."""

from __future__ import annotations

import json
import shutil
import tempfile
from pathlib import Path
from typing import Any

from ..tools.test_parsing import run_test_command
from .types import TaskSpec
from .workspace import TaskWorkspace


def load_tasks(tasks_dir: Path, only: list[str] | None = None) -> list[TaskSpec]:
    only_set = set(only or [])
    tasks: list[TaskSpec] = []
    if not tasks_dir.is_dir():
        return tasks
    seen: set[str] = set()
    for entry in sorted(tasks_dir.iterdir()):
        meta_path = entry / "task.json"
        if not entry.is_dir() or not meta_path.is_file():
            continue
        data = json.loads(meta_path.read_text(encoding="utf-8"))
        task_id = str(data["id"])
        if only_set and task_id not in only_set:
            continue
        if task_id in seen:
            raise ValueError(f"duplicate task id: {task_id}")
        seen.add(task_id)
        tasks.append(
            TaskSpec(
                task_id=task_id,
                repo_path=str(entry),
                instruction=str(data["instruction"]),
                test_command=data.get("test_command"),
                timeout_seconds=int(data.get("timeout_seconds", 300)),
                protected_paths=tuple(data.get("protected_paths", ()) or ()),
                expected_paths=tuple(data.get("expected_paths", ()) or ()),
                metadata={
                    "title": data.get("title", task_id),
                    "kind": data.get("kind", "bug"),
                    **dict(data.get("metadata", {}) or {}),
                },
            )
        )
    return tasks


def apply_reference(task: TaskSpec, workspace: TaskWorkspace) -> list[str]:
    reference = Path(task.repo_path) / "reference"
    copied: list[str] = []
    if not reference.is_dir():
        return copied
    for source in sorted(reference.rglob("*")):
        if not source.is_file() or "__pycache__" in source.parts:
            continue
        relative = source.relative_to(reference)
        target = workspace.resolve(relative.as_posix())
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
        copied.append(relative.as_posix())
    return copied


def validate_task(task: TaskSpec, work_root: Path | None = None) -> dict[str, Any]:
    """Prove baseline fails and the reference fix passes."""
    base = Path(work_root) if work_root else Path(tempfile.mkdtemp(prefix="harness-task-"))
    base.mkdir(parents=True, exist_ok=True)
    destination = base / task.task_id
    if destination.exists():
        shutil.rmtree(destination)
    workspace = TaskWorkspace.prepare(Path(task.repo_path), destination)
    try:
        baseline = run_test_command(
            task.test_command or "",
            str(workspace.root),
            timeout_seconds=task.timeout_seconds,
        )
        copied = apply_reference(task, workspace)
        after = run_test_command(
            task.test_command or "",
            str(workspace.root),
            timeout_seconds=task.timeout_seconds,
        )
    finally:
        if work_root is None:
            shutil.rmtree(base, ignore_errors=True)
        else:
            shutil.rmtree(destination, ignore_errors=True)
    return {
        "task_id": task.task_id,
        "baseline": baseline.to_dict(),
        "reference": after.to_dict(),
        "reference_files": copied,
        "valid": baseline.status == "fail" and after.status == "pass",
    }
