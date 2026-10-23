"""Context strategies and budget enforcement."""

from __future__ import annotations

from agent_replay.context.manager import (
    CompressedContextManager,
    FullContextManager,
    TruncatingContextManager,
    context_fingerprint,
)
from agent_replay.context.truncation import enforce_budget, estimate_tokens
from agent_replay.harness.types import RunState, TaskSpec


def _state() -> RunState:
    task = TaskSpec(
        task_id="ctx",
        repo_path="/tmp/repo",
        instruction="Fix the failing tests and do not edit tests.",
        test_command="pytest",
        protected_paths=("tests/",),
    )
    state = RunState(task=task, run_id="r1")
    for index in range(8):
        state.add_message(
            {
                "role": "assistant",
                "content": f"step {index}",
                "tool_calls": [
                    {
                        "id": f"c{index}",
                        "type": "function",
                        "function": {
                            "name": "read_file",
                            "arguments": '{"path": "src/calc.py"}',
                        },
                    }
                ],
            }
        )
        state.add_message(
            {
                "role": "tool",
                "tool_call_id": f"c{index}",
                "name": "read_file",
                "content": f"OBSERVATION {index} " + ("detail " * 600),
            }
        )
    state.files_read = ["src/calc.py"]
    state.files_changed = ["src/calc.py"]
    state.grader_feedback = ["Tests still failing in test_add"]
    state.diagnostics["test_runs"] = [
        {"stage": "agent", "passed": 0, "failed": 1, "exit_code": 1}
    ]
    return state


def test_full_truncated_compressed_are_ordered():
    state = _state()
    system = "SYSTEM"
    full = FullContextManager(
        max_tool_output_chars=10_000, token_budget=100_000
    ).build(system, state)
    truncated = TruncatingContextManager(
        max_tool_output_chars=400, token_budget=100_000
    ).build(system, state)
    compressed = CompressedContextManager(
        recent_turns=1,
        max_tool_output_chars=400,
        token_budget=100_000,
    ).build(system, state)

    assert full.strategy == "full"
    assert truncated.strategy == "truncated"
    assert compressed.strategy == "compressed"
    assert truncated.estimated_tokens < full.estimated_tokens
    assert compressed.estimated_tokens < truncated.estimated_tokens
    assert compressed.summary
    assert compressed.extra["summarized_messages"] >= 1
    assert compressed.messages[0]["role"] == "system"
    assert compressed.messages[1]["role"] == "user"  # summary
    assert "Compressed history" in compressed.messages[1]["content"]
    assert compressed.structured_state["goal"] == state.task.instruction
    assert compressed.structured_state["files_read"] == ["src/calc.py"]
    assert compressed.structured_state["tests_failed"] == []
    fingerprint = context_fingerprint(compressed)
    assert fingerprint["estimated_tokens"] == compressed.estimated_tokens
    assert fingerprint["structured_state"]["files_changed"] == ["src/calc.py"]


def test_compression_keeps_tool_pairing():
    state = _state()
    build = CompressedContextManager(
        recent_turns=2,
        max_tool_output_chars=200,
        token_budget=100_000,
    ).build("SYSTEM", state)
    body = build.messages[1:]
    for index, message in enumerate(body):
        if message.get("role") == "tool":
            assert index > 0
            assert body[index - 1].get("role") == "assistant"


def test_budget_drops_whole_units_and_keeps_system():
    messages = [{"role": "system", "content": "system"}]
    for index in range(5):
        messages.append(
            {
                "role": "assistant",
                "content": "act",
                "tool_calls": [
                    {
                        "id": f"c{index}",
                        "type": "function",
                        "function": {"name": "read_file", "arguments": "{}"},
                    }
                ],
            }
        )
        messages.append(
            {
                "role": "tool",
                "tool_call_id": f"c{index}",
                "name": "read_file",
                "content": "observation " * 100,
            }
        )
    result, dropped, truncated = enforce_budget(messages, 120, 4)
    assert result[0]["role"] == "system"
    assert dropped >= 1
    assert estimate_tokens(result, 4) <= 120 or truncated
    assert result[1]["role"] != "tool"


def test_truncation_marks_observation():
    state = _state()
    build = TruncatingContextManager(
        max_tool_output_chars=50, token_budget=100_000
    ).build("SYSTEM", state)
    assert build.truncated is True
    tool_messages = [message for message in build.messages if message["role"] == "tool"]
    assert all(len(message["content"]) <= 120 for message in tool_messages)
