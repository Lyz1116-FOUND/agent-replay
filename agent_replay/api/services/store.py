"""Minimal JSON-file store for tasks and runs.

Keeps the service dependency-free (no database) while persisting state across
restarts. Writes are atomic (temp file + rename) and guarded by a lock so
concurrent FastAPI threads do not corrupt files.
"""

from __future__ import annotations

import json
import threading
from pathlib import Path
from typing import Any


class JsonStore:
    def __init__(self, root: Path):
        self.root = Path(root)
        self._lock = threading.Lock()
        (self.root / "tasks").mkdir(parents=True, exist_ok=True)
        (self.root / "runs").mkdir(parents=True, exist_ok=True)

    def _write(self, rel: Path, data: dict[str, Any]) -> None:
        path = self.root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(path.suffix + ".tmp")
        with self._lock:
            tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
            tmp.replace(path)

    def _read(self, rel: Path) -> dict[str, Any] | None:
        path = self.root / rel
        if not path.is_file():
            return None
        with self._lock:
            raw = path.read_text(encoding="utf-8")
        return json.loads(raw)

    # tasks
    def save_task(self, task: dict[str, Any]) -> None:
        self._write(Path("tasks") / f"{task['task_id']}.json", task)

    def get_task(self, task_id: str) -> dict[str, Any] | None:
        return self._read(Path("tasks") / f"{task_id}.json")

    # runs
    def save_run(self, run: dict[str, Any]) -> None:
        self._write(Path("runs") / f"{run['run_id']}.json", run)

    def get_run(self, run_id: str) -> dict[str, Any] | None:
        return self._read(Path("runs") / f"{run_id}.json")
