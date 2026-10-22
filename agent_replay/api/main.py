"""FastAPI application factory.

The app is a thin service layer over the Node recorder: it exposes
``POST /tasks``, ``POST /tasks/{id}/run``, ``GET /tasks/{id}``,
``GET /runs/{id}`` and ``GET /health``. Core execution and trusted-verify live
in :mod:`agent_replay.core.executor` and are shared with the experiment harness.
"""

from __future__ import annotations

from fastapi import FastAPI

from ..config import Settings, get_settings
from .routers import health, runs, tasks
from .services.run_service import RunService
from .services.store import JsonStore
from .services.task_service import TaskService


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    store = JsonStore(settings.store_dir)
    task_service = TaskService(settings, store)
    run_service = RunService(settings, store, task_service)

    app = FastAPI(
        title="Agent Replay API",
        description=(
            "REST interface over the Agent Replay recorder and evaluator. "
            "Run a coding agent on a fixed task, record its trace, and evaluate "
            "the result in the final worktree."
        ),
        version="1.0.0-beta.1",
    )
    app.state.settings = settings
    app.state.store = store
    app.state.task_service = task_service
    app.state.run_service = run_service

    app.include_router(health.router)
    app.include_router(tasks.router)
    app.include_router(runs.router)
    return app


app = create_app()
