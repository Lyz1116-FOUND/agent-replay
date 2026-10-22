"""Tests for the run service's task_id mapping and trace persistence."""

from __future__ import annotations

from agent_replay.core.executor import RunOutcome
from agent_replay.api.services.run_service import RunService


def _outcome(task_set_id: str = "single-file-bug") -> RunOutcome:
    return RunOutcome(
        run_id="run-abc",
        task_id=task_set_id,  # the task-set id, not the stored task's uuid
        status="pass",
        success=True,
        reason=None,
        latency_ms=1500,
        exit_code=0,
        prompt_name="structured",
        adapter="opencode",
        model="m",
        verify={"command": "node --test", "exit_code": 0, "passed": 3, "failed": 0, "total": 3},
        usage={"input": 10, "output": 5, "total": 15},
        files_changed=["calc.mjs"],
        termination={"kind": "completed"},
        tampered=False,
        trace_path="/data/traces/run-abc.trace.json",
    )


def test_to_run_maps_task_id_to_stored_uuid():
    run = RunService._to_run(_outcome(), task_id="stored-uuid-123")
    assert run.task_id == "stored-uuid-123"  # the POST /tasks id
    assert run.task_ref == "single-file-bug"  # the fixed task-set id
    assert run.trace == "/data/traces/run-abc.trace.json"
    assert run.success is True


def test_to_run_carries_usage_and_test_result():
    run = RunService._to_run(_outcome(), task_id="stored-uuid-123")
    assert run.test_result is not None
    assert run.test_result.passed == 3
    assert run.usage is not None
    assert run.usage.total == 15


def test_to_run_without_usage_or_trace():
    outcome = _outcome()
    outcome.usage = None
    outcome.trace_path = None
    outcome.verify = None
    run = RunService._to_run(outcome, task_id="stored-uuid-123")
    assert run.usage is None
    assert run.test_result is None
    assert run.trace is None
