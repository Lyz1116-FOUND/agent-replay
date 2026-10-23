"""End-to-end loop, retry, verification authority, and artifacts."""

from __future__ import annotations

import json
from pathlib import Path

from agent_replay.evaluation.failure_taxonomy import classify_failure
from agent_replay.harness.errors import ModelError
from agent_replay.harness.loop import AgentHarness
from agent_replay.harness.model_client import ModelClient, ScriptedModel
from tests.harness_helpers import (
    failing_actions,
    make_calc_task,
    oracle_actions,
    run_scripted,
)


def _taxonomy_record(result, task) -> dict:
    record = result.to_dict()
    record.update(
        {
            "expected_paths": list(task.expected_paths),
            "verified_success": result.success,
            "posthoc": {"tests": result.tests, "protected_modified": False},
            "baseline_failed_tests": ["tests/test_calc.py::test_add"],
        }
    )
    return record


def test_successful_run_writes_complete_artifact_set(tmp_path, harness_config):
    task = make_calc_task(tmp_path)
    result = run_scripted(task, harness_config, oracle_actions())

    assert result.success is True
    assert result.status == "passed"
    assert result.steps == 4
    assert result.tool_calls == 3
    assert result.files_changed == ["src/calc.py"]
    assert result.files_read == ["src/calc.py"]
    assert result.tests["passed"] == 1
    assert result.usage.reported is False
    assert result.grade.authority == "harness"
    assert result.trace_path

    run_dir = Path(result.run_dir)
    for name in (
        "task.json",
        "config.json",
        "events.jsonl",
        "messages.jsonl",
        "patch.diff",
        "test_results.json",
        "grade.json",
        "metrics.json",
        "result.json",
        "trace.json",
    ):
        assert (run_dir / name).is_file(), name

    event_types = [
        json.loads(line)["type"] for line in (run_dir / "events.jsonl").read_text().splitlines()
    ]
    for required in (
        "run_started",
        "context_built",
        "model_called",
        "tool_called",
        "tool_returned",
        "file_changed",
        "test_started",
        "test_finished",
        "grader_started",
        "grader_finished",
        "run_finished",
    ):
        assert required in event_types

    trace = json.loads((run_dir / "trace.json").read_text())
    assert trace["schemaVersion"] == "agent-replay/v1"
    assert trace["status"] == "pass"
    assert trace["result"]["tests"] == {"passed": 1, "failed": 0, "total": 1}
    assert len(trace["spans"]) >= 2


def test_harness_does_not_trust_completion_claim(tmp_path, harness_config):
    task = make_calc_task(tmp_path)
    config = harness_config.with_overrides(max_retries=0)
    result = run_scripted(task, config, failing_actions())

    assert result.success is False
    assert result.grade.authority == "harness"
    assert result.files_changed == []
    assert result.claimed_finish is True
    classification = classify_failure(_taxonomy_record(result, task))
    assert classification["code"] == "F11"


def test_grader_feedback_drives_retry(tmp_path, harness_config):
    task = make_calc_task(tmp_path)
    actions = failing_actions() + oracle_actions()
    result = run_scripted(task, harness_config, actions)

    assert result.success is True
    assert result.retries == 1
    assert len(result.attempts) == 2
    assert result.attempts[0].grade.passed is False
    assert result.attempts[1].grade.passed is True
    run_dir = Path(result.run_dir)
    events = [json.loads(line) for line in (run_dir / "events.jsonl").read_text().splitlines()]
    assert any(event["type"] == "retry" for event in events)
    messages = [
        json.loads(line) for line in (run_dir / "messages.jsonl").read_text().splitlines()
    ]
    assert any(
        message.get("role") == "user" and "did not pass" in message.get("content", "")
        for message in messages
    )


def test_modified_tests_are_rejected(tmp_path, harness_config):
    task = make_calc_task(tmp_path)
    actions = [
        {
            "tool": "write_file",
            "arguments": {
                "path": "tests/test_calc.py",
                "content": "def test_nothing():\n    assert True\n",
            },
        },
        {
            "tool": "write_file",
            "arguments": {"path": "src/calc.py", "content": "def add(a, b):\n    return a + b\n"},
        },
        {"tool": "run_tests", "arguments": {}},
        {"text": "Done."},
    ]
    result = run_scripted(task, harness_config, actions)

    assert result.success is False
    assert result.failure_reason == "tests_modified"
    assert result.grade.evidence["constraints"]["modified_protected"] == ["tests/test_calc.py"]
    classification = classify_failure(_taxonomy_record(result, task))
    assert classification["code"] == "F13"


def test_stuck_loop_is_stopped(tmp_path):
    task = make_calc_task(tmp_path)
    from agent_replay.harness.config import HarnessConfig

    config = HarnessConfig.from_env().with_overrides(
        runs_dir=tmp_path / "runs",
        work_dir=tmp_path / "work",
        max_steps=3,
        max_retries=0,
        tool_timeout_seconds=20,
        model_backend="scripted",
    )
    actions = [{"tool": "read_file", "arguments": {"path": "src/calc.py"}} for _ in range(5)]
    result = run_scripted(task, config, actions)

    assert result.success is False
    assert result.failure_reason == "stuck_loop"
    assert result.diagnostics["stuck_loop"] is True
    assert classify_failure(_taxonomy_record(result, task))["code"] == "F10"


def test_agent_call_cap_stops_the_loop(tmp_path, harness_config):
    task = make_calc_task(tmp_path)
    config = harness_config.with_overrides(max_agent_calls=1, max_retries=0)
    result = run_scripted(task, config, oracle_actions())

    assert result.success is False
    assert result.failure_reason == "max_agent_calls"
    assert result.model_calls == 1
    assert result.steps == 1
    assert classify_failure(_taxonomy_record(result, task))["code"] == "F10"


def test_invalid_tool_call_is_an_observation_and_can_recover(tmp_path, harness_config):
    task = make_calc_task(tmp_path)
    actions = [{"tool": "not_a_tool", "arguments": {}}] + oracle_actions()
    result = run_scripted(task, harness_config, actions)

    assert result.success is True
    assert result.tool_errors == 1
    assert result.diagnostics["invalid_tool_calls"] == 1
    assert result.diagnostics["tool_calls"][0]["metadata"]["invalid_kind"] == "unknown_tool"


class FailingModel(ModelClient):
    name = "failing"
    model = "failing"

    def complete(self, messages, tools, *, timeout_seconds=None):
        raise ModelError("provider is down")


def test_provider_error_is_recorded_and_workspace_is_graded(tmp_path, harness_config):
    task = make_calc_task(tmp_path)
    result = AgentHarness(task, harness_config, model=FailingModel()).run()

    assert result.success is False
    assert result.status == "provider_error"
    assert result.failure_reason == "provider_error"
    assert result.grade.passed is False
    assert any(
        json.loads(line)["type"] == "model_error"
        for line in (Path(result.run_dir) / "events.jsonl").read_text().splitlines()
    )


def test_abort_check_stops_before_model_call(tmp_path, harness_config):
    task = make_calc_task(tmp_path)
    result = AgentHarness(
        task,
        harness_config.with_overrides(max_retries=0),
        model=ScriptedModel(oracle_actions()),
        abort_check=lambda: True,
    ).run()

    assert result.success is False
    assert result.failure_reason == "aborted"
    assert result.model_calls == 0
    assert result.metadata["aborted"] is True
    events = [
        json.loads(line)
        for line in (Path(result.run_dir) / "events.jsonl").read_text().splitlines()
    ]
    assert any(event["type"] == "run_aborted" for event in events)
    assert classify_failure(_taxonomy_record(result, task))["code"] == "I1"


def test_cleanup_removes_workspace_but_keeps_patch(tmp_path, harness_config):
    task = make_calc_task(tmp_path)
    config = harness_config.with_overrides(keep_workspace=False)
    result = run_scripted(task, config, oracle_actions())

    assert result.success is True
    assert result.workspace_dir is None
    assert not (config.work_dir / result.run_id).exists()
    assert "return a + b" in (Path(result.run_dir) / "patch.diff").read_text()


def test_skill_is_injected_when_enabled(tmp_path, harness_config):
    task = make_calc_task(tmp_path)
    config = harness_config.with_overrides(use_skills=True)
    result = run_scripted(task, config, oracle_actions())

    assert result.success is True
    assert result.metadata["skill"] == "python_test_debug"
    messages = [
        json.loads(line) for line in (Path(result.run_dir) / "messages.jsonl").read_text().splitlines()
    ]
    system = next(message for message in messages if message["role"] == "system")
    assert "Skill: python_test_debug" in system["content"]
    events = [json.loads(line) for line in (Path(result.run_dir) / "events.jsonl").read_text().splitlines()]
    assert any(event["type"] == "skill_loaded" for event in events)
