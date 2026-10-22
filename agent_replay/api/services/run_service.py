"""Run orchestration: render the prompt, execute via the core executor, persist."""

from __future__ import annotations

import uuid
from typing import Any

from ...config import Settings
from ...core.executor import RunOutcome, run_task
from ...core.prompts import load_prompt_templates, render_prompt
from ...schemas import Evaluation, Run, TestResult, Usage
from .store import JsonStore
from .task_service import InvalidTaskError, TaskNotFoundError, TaskService


class RunService:
    def __init__(self, settings: Settings, store: JsonStore, task_service: TaskService):
        self.settings = settings
        self.store = store
        self.task_service = task_service
        self._prompts = load_prompt_templates(settings.prompts_dir)

    def start_run(self, task_id: str) -> Run:
        task = self.task_service.get_task(task_id)
        if task is None:
            raise TaskNotFoundError(f"task {task_id!r} not found")
        spec = self.task_service.get_spec(task.task)
        if spec is None:
            raise InvalidTaskError(f"task {task.task!r} no longer exists in the task set")

        prompt = render_prompt(self._prompts[task.prompt_template], spec.prompt)
        run_id = uuid.uuid4().hex
        outcome = run_task(
            self.settings,
            spec,
            run_id=run_id,
            prompt=prompt,
            prompt_name=task.prompt_template,
        )
        run = self._to_run(outcome, task_id=task_id)
        self.store.save_run(run.model_dump())
        self.task_service.add_run(task_id, run_id)
        return run

    def get_run(self, run_id: str) -> Run | None:
        data = self.store.get_run(run_id)
        return Run(**data) if data else None

    @staticmethod
    def _to_run(outcome: RunOutcome, task_id: str) -> Run:
        test_result = TestResult(**outcome.verify) if outcome.verify else None
        evaluation = Evaluation(
            status=outcome.status, reason=outcome.reason, tampered=outcome.tampered
        )
        usage = Usage(**outcome.usage) if outcome.usage else None
        return Run(
            run_id=outcome.run_id,
            task_id=task_id,
            task_ref=outcome.task_id,
            status=outcome.status,
            success=outcome.success,
            latency_ms=outcome.latency_ms,
            prompt_name=outcome.prompt_name,
            adapter=outcome.adapter,
            model=outcome.model,
            test_result=test_result,
            evaluation=evaluation,
            usage=usage,
            files_changed=outcome.files_changed,
            termination=outcome.termination,
            trace=outcome.trace_path,
        )
