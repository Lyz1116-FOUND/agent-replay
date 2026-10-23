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
from agent_replay.harness.config import HarnessConfig  # noqa: E402


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


@pytest.fixture
def harness_config(tmp_path: Path) -> HarnessConfig:
    """Hermetic harness config: temp artifacts, scripted backend, short budgets."""
    base = HarnessConfig.from_env()
    return base.with_overrides(
        runs_dir=tmp_path / "harness-runs",
        work_dir=tmp_path / "harness-work",
        model_backend="scripted",
        evidence_level="mechanics",
        max_steps=10,
        max_retries=1,
        max_rounds=2,
        timeout_seconds=60,
        tool_timeout_seconds=30,
        keep_workspace=True,
        use_skills=False,
        reviewer=False,
    )
