"""Task endpoints: create, list, and start a run for a task."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from ...schemas import RunStartResponse, Task, TaskCreate
from ..deps import get_run_service, get_task_service
from ..services.run_service import RunService
from ..services.task_service import InvalidTaskError, TaskNotFoundError, TaskService

router = APIRouter(tags=["tasks"])


@router.post("/tasks", response_model=Task, status_code=201)
def create_task(payload: TaskCreate, service: TaskService = Depends(get_task_service)) -> Task:
    try:
        return service.create_task(payload)
    except InvalidTaskError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/tasks/{task_id}", response_model=Task)
def get_task(task_id: str, service: TaskService = Depends(get_task_service)) -> Task:
    task = service.get_task(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail=f"task {task_id!r} not found")
    return task


@router.post("/tasks/{task_id}/run", response_model=RunStartResponse)
def start_run(task_id: str, run_service: RunService = Depends(get_run_service)) -> RunStartResponse:
    """Run a task synchronously. Execution may take tens of seconds to minutes."""
    try:
        run = run_service.start_run(task_id)
    except TaskNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except InvalidTaskError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return RunStartResponse(task_id=task_id, run_id=run.run_id, status="completed")
