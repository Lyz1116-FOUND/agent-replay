"""Fixed evaluation task set.

Mirrors ``cli/validation/harness.ts#loadTasks``: a task is a directory under
``examples/tasks/`` containing a ``task.json`` with an id, prompt, verify
command, expected files, baseline counts, and protected files.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path


@dataclass(frozen=True)
class TaskSpec:
    """A single evaluation task, loaded from ``task.json``."""

    id: str
    title: str
    kind: str  # "bug" | "feature"
    prompt: str
    verify: str
    expected_files: tuple[str, ...]
    baseline_pass: int
    baseline_fail: int
    protected_files: tuple[str, ...]
    dir: Path

    @property
    def baseline_total(self) -> int:
        return self.baseline_pass + self.baseline_fail


def load_tasks(tasks_dir: Path, only: list[str] | None = None) -> list[TaskSpec]:
    """Load every task directory under ``tasks_dir`` that has a ``task.json``."""
    only = set(only or [])
    tasks: list[TaskSpec] = []
    if not tasks_dir.is_dir():
        return tasks
    for entry in sorted(tasks_dir.iterdir()):
        if not entry.is_dir():
            continue
        meta_path = entry / "task.json"
        if not meta_path.is_file():
            continue
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        if only and meta.get("id") not in only:
            continue
        baseline = meta.get("baseline", {})
        tasks.append(
            TaskSpec(
                id=meta["id"],
                title=meta.get("title", meta["id"]),
                kind=meta.get("kind", "bug"),
                prompt=meta["prompt"],
                verify=meta.get("verify", "node --test"),
                expected_files=tuple(meta.get("expectedFiles", [])),
                baseline_pass=int(baseline.get("pass", 0)),
                baseline_fail=int(baseline.get("fail", 0)),
                protected_files=tuple(meta.get("protectedFiles", [])),
                dir=entry,
            )
        )
    return tasks
