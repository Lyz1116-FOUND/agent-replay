"""Reviewer, supervisor, and internal A2A messages."""

from __future__ import annotations

import json
from pathlib import Path

from agent_replay.agents.a2a import AgentMessage, MessageBus
from agent_replay.agents.reviewer import ReviewerAgent
from agent_replay.agents.supervisor import Supervisor
from agent_replay.harness.model_client import ScriptedModel
from agent_replay.harness.types import RunState
from agent_replay.harness.workspace import TaskWorkspace
from tests.harness_helpers import make_calc_task, oracle_actions


def _approval(approved: bool, feedback: str = "") -> dict:
    return {
        "text": json.dumps(
            {
                "approved": approved,
                "issues": [] if approved else ["missing edge case"],
                "feedback": feedback,
            }
        )
    }


def _reviewer(replies: list[dict]) -> ScriptedModel:
    return ScriptedModel(replies)


def test_a2a_message_roundtrip_and_bus():
    message = AgentMessage(
        sender="reviewer",
        receiver="coder",
        type="feedback",
        payload={"issue": "missing regression test"},
    )
    clone = AgentMessage.from_dict(message.to_dict())
    assert clone.sender == "reviewer"
    assert clone.payload["issue"] == "missing regression test"
    bus = MessageBus()
    bus.send(message)
    assert bus.by_receiver("coder") == [message]
    assert bus.to_list()[0]["type"] == "feedback"


def test_reviewer_parses_json_and_never_edits(tmp_path):
    task = make_calc_task(tmp_path)
    workspace = TaskWorkspace.prepare(Path(task.repo_path), tmp_path / "work")
    state = RunState(task=task, run_id="r1")
    (workspace.root / "src" / "calc.py").write_text(
        "def add(a, b):\n    return a + b\n", encoding="utf-8"
    )
    before = workspace.changed_files()
    reviewer = ReviewerAgent(
        ScriptedModel(
            [
                {
                    "text": "```json\n"
                    + json.dumps({"approved": False, "issues": ["x"], "feedback": "fix x"})
                    + "\n```"
                }
            ]
        )
    )
    result = reviewer.review(task, state, workspace)
    assert result.approved is False
    assert result.issues == ["x"]
    assert workspace.changed_files() == before


def test_reviewer_unparsable_is_advisory_not_a_crash(tmp_path):
    task = make_calc_task(tmp_path)
    workspace = TaskWorkspace.prepare(Path(task.repo_path), tmp_path / "work2")
    state = RunState(task=task, run_id="r1")
    result = ReviewerAgent(ScriptedModel([{"text": "looks fine"}])).review(
        task, state, workspace
    )
    assert result.approved is None
    assert result.error == "unparsable_review"


def test_supervisor_coder_reviewer_happy_path(tmp_path, harness_config):
    task = make_calc_task(tmp_path)
    supervisor = Supervisor(
        task,
        harness_config,
        model=ScriptedModel(oracle_actions()),
        reviewer_model=_reviewer([_approval(True, "ok")]),
    )
    result = supervisor.run()

    assert result.success is True
    assert len(result.diagnostics["reviews"]) == 1
    assert result.metadata["multi_agent"]["round"] == 1
    assert (Path(result.run_dir) / "multi_agent.json").is_file()
    message_types = [message["type"] for message in result.diagnostics["a2a_messages"]]
    assert "coder_result" in message_types
    assert "review_request" in message_types
    assert "review_result" in message_types


def test_supervisor_reviewer_rejection_triggers_next_round(tmp_path, harness_config):
    task = make_calc_task(tmp_path)
    supervisor = Supervisor(
        task,
        harness_config,
        model=ScriptedModel(oracle_actions()),
        reviewer_model=_reviewer(
            [
                _approval(False, "Add a regression test for zero."),
                _approval(True, "ok"),
            ]
        ),
    )
    result = supervisor.run()

    assert result.success is True
    assert len(result.attempts) == 2
    assert result.metadata["multi_agent"]["round"] == 2
    feedback = [
        message
        for message in result.diagnostics["a2a_messages"]
        if message["type"] == "feedback"
    ]
    assert feedback
    assert "regression test" in feedback[0]["payload"]["feedback"]
    # The reviewer's rejection did not become the success authority; the
    # final grade did.
    assert result.grade.authority == "harness"
