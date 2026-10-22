"""Run endpoints: read a single run's detailed result."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from ...schemas import Run
from ..deps import get_run_service
from ..services.run_service import RunService

router = APIRouter(tags=["runs"])


@router.get("/runs/{run_id}", response_model=Run)
def get_run(run_id: str, service: RunService = Depends(get_run_service)) -> Run:
    run = service.get_run(run_id)
    if run is None:
        raise HTTPException(status_code=404, detail=f"run {run_id!r} not found")
    return run
