"""FastAPI dependencies: services are stored on ``app.state`` and injected
through ``Request`` so tests can build an isolated app with temp directories.
"""

from __future__ import annotations

from fastapi import Request

from ..config import Settings
from .services.store import JsonStore
from .services.task_service import TaskService
from .services.run_service import RunService


def get_settings(request: Request) -> Settings:
    return request.app.state.settings


def get_store(request: Request) -> JsonStore:
    return request.app.state.store


def get_task_service(request: Request) -> TaskService:
    return request.app.state.task_service


def get_run_service(request: Request) -> RunService:
    return request.app.state.run_service
