"""Task management: create, look up, and track runs for a task."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from ...config import Settings
from ...core.taskset import TaskSpec, load_tasks
from ...schemas import PROMPT_TEMPLATES, Task, TaskCreate
from .store import JsonStore


class InvalidTaskError(Exception):
    """The request referenced an unknown task or prompt template."""


class TaskNotFoundError(Exception):
    """A stored task id does not exist."""


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class TaskService:
    def __init__(self, settings: Settings, store: JsonStore):
        self.settings = settings
        self.store = store
        self._specs: dict[str, TaskSpec] = {
            spec.id: spec for spec in load_tasks(settings.tasks_dir)
        }

    @property
    def available_task_ids(self) -> list[str]:
        return sorted(self._specs)

    def get_spec(self, task_id: str) -> TaskSpec | None:
        return self._specs.get(task_id)

    def create_task(self, payload: TaskCreate) -> Task:
        if payload.prompt_template not in PROMPT_TEMPLATES:
            raise InvalidTaskError(
                f"prompt_template must be one of {', '.join(PROMPT_TEMPLATES)}"
            )
        if payload.task not in self._specs:
            raise InvalidTaskError(
                f"unknown task {payload.task!r}; available: {', '.join(self.available_task_ids)}"
            )

        task_id = uuid.uuid4().hex
        task = Task(
            task_id=task_id,
            status="created",
            repo=payload.repo,
            task=payload.task,
            prompt_template=payload.prompt_template,
            metadata=payload.metadata,
            created_at=_now_iso(),
            runs=[],
        )
        self.store.save_task(task.model_dump())
        return task

    def get_task(self, task_id: str) -> Task | None:
        data = self.store.get_task(task_id)
        return Task(**data) if data else None

    def add_run(self, task_id: str, run_id: str) -> None:
        task = self.get_task(task_id)
        if task is None:
            return
        if run_id not in task.runs:
            task.runs.append(run_id)
            self.store.save_task(task.model_dump())
