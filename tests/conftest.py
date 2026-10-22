"""Pytest fixtures and path setup for the Agent Replay backend tests."""

from __future__ import annotations

import sys
from dataclasses import replace
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from agent_replay.api.main import create_app  # noqa: E402
from agent_replay.config import get_settings  # noqa: E402


@pytest.fixture
def client(tmp_path: Path) -> TestClient:
    """An isolated app instance with a temporary store/work directory."""
    settings = replace(
        get_settings(),
        store_dir=tmp_path / "store",
        work_dir=tmp_path / "work",
        results_dir=tmp_path / "results",
    )
    return TestClient(create_app(settings))
