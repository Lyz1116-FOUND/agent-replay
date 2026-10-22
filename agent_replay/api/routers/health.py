"""Health check for Docker and deployment probes."""

from __future__ import annotations

from fastapi import APIRouter

from ...schemas import Health

router = APIRouter()


@router.get("/health", response_model=Health, tags=["health"])
def health() -> Health:
    return Health(status="ok")
