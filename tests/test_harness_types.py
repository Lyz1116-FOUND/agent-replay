"""Contract tests for the five harness objects (M0)."""

from __future__ import annotations

from agent_replay.harness.types import (
    AttemptSummary,
    GradeResult,
    HarnessResult,
    ModelTurn,
    Observation,
    RunState,
    TaskSpec,
    TokenUsage,
    ToolCall,
    ToolResult,
)


def _task() -> TaskSpec:
    return TaskSpec(
        task_id="t1",
        repo_path="/tmp/repo",
        instruction="fix it",
        test_command="{python} -m pytest -q",
        protected_paths=("tests/",),
        expected_paths=("src/a.py",),
        metadata={"title": "Task one", "kind": "bug", "tags": ["python"]},
    )


def test_token_usage_marks_unreported():
    usage = TokenUsage(reported=False)
    usage.add(TokenUsage(input_tokens=3, output_tokens=4, reported=True))
    assert usage.input_tokens == 3
    assert usage.total == 7
    assert usage.reported is True

    missing = TokenUsage(reported=False)
    missing.add(TokenUsage(reported=False))
    assert missing.reported is False
    assert TokenUsage.from_dict(missing.to_dict()).reported is False


def test_model_turn_assistant_message_and_finish_claim():
    turn = ModelTurn(
        text="working",
        tool_calls=(ToolCall(call_id="c1", name="read_file", arguments={"path": "a.py"}),),
        usage=TokenUsage(input_tokens=10, output_tokens=2),
        finish_reason="tool_calls",
    )
    message = turn.to_assistant_message()
    assert message["role"] == "assistant"
    assert message["content"] == "working"
    assert message["tool_calls"][0]["function"]["name"] == "read_file"
    assert not turn.requests_finish

    claim = ModelTurn(text="done")
    assert claim.requests_finish


def test_tool_result_message_and_serialisation():
    call = ToolCall(call_id="c1", name="shell", arguments={"command": "pwd"})
    result = ToolResult(success=False, output="out", error="boom", metadata={"exit_code": 1})
    message = result.to_tool_message(call)
    assert message["role"] == "tool"
    assert message["tool_call_id"] == "c1"
    assert "boom" in message["content"]
    assert ToolResult.from_dict(result.to_dict()).metadata["exit_code"] == 1


def test_run_state_records_observations_and_errors():
    state = RunState(task=_task(), run_id="r1")
    call = ToolCall(call_id="c1", name="read_file", arguments={"path": "src/a.py"})
    result = ToolResult(success=True, output="x", metadata={"path": "src/a.py"})
    state.add_observation(Observation(step=1, attempt=1, call=call, result=result))
    assert state.files_read == ["src/a.py"]
    assert state.messages[-1]["role"] == "tool"

    bad = ToolResult(success=False, output="", error="nope")
    state.add_observation(
        Observation(step=2, attempt=1, call=ToolCall("c2", "grep", {}), result=bad)
    )
    assert state.diagnostics["tool_errors"][0]["tool"] == "grep"
    assert state.usage.reported is False


def test_grade_and_harness_result_roundtrip():
    grade = GradeResult(
        passed=True,
        score=1.0,
        feedback="ok",
        evidence={"tests": {"passed": 1}},
        authority="harness",
    )
    attempt = AttemptSummary(attempt=1, steps=2, grade=grade, claimed_finish=True)
    result = HarnessResult(
        run_id="r1",
        task_id="t1",
        status="passed",
        success=True,
        score=1.0,
        failure_reason=None,
        failure_category=None,
        attempts=[attempt],
        steps=2,
        model_calls=2,
        tool_calls=1,
        tool_errors=0,
        retries=0,
        usage=TokenUsage(input_tokens=5, output_tokens=1),
        latency_ms=12,
        context_tokens=20,
        files_changed=["src/a.py"],
        files_read=["src/a.py"],
        tests={"passed": 1, "failed": 0, "total": 1},
        grade=grade,
        claimed_finish=True,
    )
    clone = HarnessResult.from_dict(result.to_dict())
    assert clone.success is True
    assert clone.grade.passed is True
    assert clone.attempts[0].grade.authority == "harness"
    assert clone.usage.total == 6
