"""Native trace generated from a harness run."""

from __future__ import annotations

import json
from pathlib import Path

from agent_replay.harness.grader import AgentClaimGrader
from agent_replay.harness.loop import AgentHarness
from agent_replay.harness.model_client import ScriptedModel
from tests.harness_helpers import failing_actions, make_calc_task, oracle_actions, run_scripted


def test_trace_has_valid_hierarchy_and_artifacts(tmp_path, harness_config):
    task = make_calc_task(tmp_path)
    result = run_scripted(task, harness_config, oracle_actions())
    trace = json.loads((Path(result.run_dir) / "trace.json").read_text())

    assert trace["schemaVersion"] == "agent-replay/v1"
    assert trace["task"]["id"] == task.task_id
    assert trace["status"] == "pass"
    assert trace["termination"]["kind"] == "completed"
    assert trace["durationMs"] >= 1
    assert trace["result"]["tests"] == {"passed": 1, "failed": 0, "total": 1}
    assert trace["capture"]["workspaceVerification"] == "verified"

    spans = trace["spans"]
    ids = [span["id"] for span in spans]
    assert len(ids) == len(set(ids))
    by_id = {span["id"]: span for span in spans}
    root = by_id["harness-root"]
    assert root["type"] == "agent"
    assert root["startMs"] == 0
    assert root["endMs"] == trace["durationMs"]
    for span in spans:
        assert span["endMs"] >= span["startMs"]
        assert span["endMs"] <= trace["durationMs"]
        if span.get("parentId"):
            parent = by_id[span["parentId"]]
            assert parent["startMs"] <= span["startMs"]
            assert span["endMs"] <= parent["endMs"]

    kinds = {
        artifact["kind"]
        for span in spans
        for artifact in span.get("artifacts", [])
    }
    assert {"code", "diff", "test", "reasoning", "markdown"} <= kinds
    tool_spans = [span for span in spans if span["type"] in ("read", "edit", "test")]
    assert {span["type"] for span in tool_spans} == {"read", "edit", "test"}


def test_failed_claim_trace_is_fail_and_unverified(tmp_path, harness_config):
    task = make_calc_task(tmp_path)
    result = run_scripted(
        task,
        harness_config.with_overrides(max_retries=0),
        failing_actions(),
    )
    trace = json.loads((Path(result.run_dir) / "trace.json").read_text())

    assert trace["status"] == "fail"
    assert trace["termination"]["kind"] == "task_failure"
    assert trace["capture"]["workspaceVerification"] == "verified"
    assert trace["result"]["tests"]["failed"] == 1
    final = next(span for span in trace["spans"] if span["type"] == "final")
    assert final["status"] == "error"


def test_claim_verdict_is_partial_not_verified_pass(tmp_path, harness_config):
    task = make_calc_task(tmp_path)
    result = AgentHarness(
        task,
        harness_config.with_overrides(max_retries=0),
        model=ScriptedModel(failing_actions()),
        grader=AgentClaimGrader(),
    ).run()
    trace = json.loads((Path(result.run_dir) / "trace.json").read_text())
    assert result.success is True
    assert trace["status"] == "partial"
    assert trace["capture"]["workspaceVerification"] == "unavailable"
