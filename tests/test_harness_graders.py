"""Grader authority and constraint checks."""

from __future__ import annotations

from pathlib import Path

import pytest

from agent_replay.harness.grader import (
    AgentClaimGrader,
    CompositeGrader,
    ConstraintGrader,
    LLMGrader,
    TestGrader,
    build_default_grader,
    test_report_from_grade,
)
from agent_replay.harness.model_client import ScriptedModel
from agent_replay.harness.types import RunState
from agent_replay.harness.workspace import TaskWorkspace
from tests.harness_helpers import make_calc_task


@pytest.fixture
def graded(tmp_path):
    task = make_calc_task(tmp_path)
    workspace = TaskWorkspace.prepare(Path(task.repo_path), tmp_path / "work")
    state = RunState(task=task, run_id="r1")
    baseline = workspace.snapshot(task.protected_paths)
    return task, workspace, state, baseline


def test_test_grader_fail_then_pass(graded):
    task, workspace, state, baseline = graded
    grader = TestGrader(task.test_command, timeout_seconds=30)
    failed = grader.grade(workspace, task, state, baseline_protected=baseline)
    assert failed.passed is False
    assert failed.evidence["test_report"]["status"] == "fail"
    assert failed.evidence["test_report"]["failed_tests"]

    (workspace.root / "src" / "calc.py").write_text(
        "def add(a, b):\n    return a + b\n", encoding="utf-8"
    )
    passed = grader.grade(workspace, task, state, baseline_protected=baseline)
    assert passed.passed is True
    assert test_report_from_grade(passed)["passed"] == 1


def test_constraint_grader_detects_protected_changes_and_patch_limit(graded):
    task, workspace, state, baseline = graded
    grader = ConstraintGrader(protected_paths=task.protected_paths)
    ok = grader.grade(workspace, task, state, baseline_protected=baseline)
    assert ok.passed is True

    (workspace.root / "tests" / "test_calc.py").write_text(
        "def test_nothing():\n    assert True\n", encoding="utf-8"
    )
    tampered = grader.grade(workspace, task, state, baseline_protected=baseline)
    assert tampered.passed is False
    assert "tests/test_calc.py" in tampered.evidence["modified_protected"]

    small = ConstraintGrader(protected_paths=task.protected_paths, max_patch_bytes=10)
    limited = small.grade(workspace, task, state, baseline_protected=baseline)
    assert limited.passed is False
    assert limited.evidence["checks"]["patch_within_limit"] is False


def test_composite_skips_tests_when_tests_were_rewritten(graded):
    task, workspace, state, baseline = graded
    (workspace.root / "tests" / "test_calc.py").write_text(
        "def test_nothing():\n    assert True\n", encoding="utf-8"
    )
    grader = CompositeGrader(
        [
            ConstraintGrader(protected_paths=task.protected_paths),
            TestGrader(task.test_command, timeout_seconds=30),
        ]
    )
    result = grader.grade(workspace, task, state, baseline_protected=baseline)
    assert result.passed is False
    assert result.evidence["tests"]["skipped"] == "constraint_violation"
    assert result.evidence["tests"]["test_report"] is None


def test_agent_claim_grader_is_explicit(graded):
    task, workspace, state, baseline = graded
    grader = AgentClaimGrader()
    assert grader.grade(workspace, task, state, baseline_protected=baseline).passed is False
    state.claimed_finish = True
    passed = grader.grade(workspace, task, state, baseline_protected=baseline)
    assert passed.passed is True
    assert passed.authority == "agent"


def test_build_default_grader_modes(graded):
    task, workspace, state, baseline = graded
    claim = build_default_grader(task, verification="claim")
    assert claim.name == "agent_claim"
    composite = build_default_grader(task, verification="composite")
    assert composite.name == "composite"
    assert composite.grade(workspace, task, state, baseline_protected=baseline).passed is False


def test_llm_grader_parses_json_and_fails_closed(graded):
    task, workspace, state, baseline = graded
    (workspace.root / "src" / "calc.py").write_text(
        "def add(a, b):\n    return a + b\n", encoding="utf-8"
    )
    good = LLMGrader(
        ScriptedModel([{"text": '{"score": 0.9, "feedback": "looks right"}'}])
    ).grade(workspace, task, state, baseline_protected=baseline)
    assert good.passed is True
    assert good.authority == "llm"

    bad = LLMGrader(ScriptedModel([{"text": "not json"}])).grade(
        workspace, task, state, baseline_protected=baseline
    )
    assert bad.passed is False
