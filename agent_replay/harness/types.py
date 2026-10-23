"""Frozen harness contracts (M0).

Five objects define the boundary between the harness, models, tools, and
graders:

* :class:`TaskSpec` — what is being solved.
* :class:`RunState` — what the agent has done so far.
* :class:`ModelTurn` — what a model returned in one call.
* :class:`ToolResult` — what a tool returned, whatever the tool.
* :class:`GradeResult` — the harness-owned verdict.

Everything else builds on these. They deliberately carry no provider-specific
fields: swapping OpenAI-compatible APIs for another backend must not change the
loop, the graders, or the replay format.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any


# Run status values. ``passed`` and ``failed`` are verdicts; the rest describe
# how a run stopped without a normal verdict.
RUNNING = "running"
PASSED = "passed"
FAILED = "failed"
TIMEOUT = "timeout"
PROVIDER_ERROR = "provider_error"
HARNESS_ERROR = "harness_error"


@dataclass
class TokenUsage:
    input_tokens: int = 0
    output_tokens: int = 0
    total_tokens: int | None = None
    # False means the backend did not report usage (e.g. the scripted fixture
    # model). Metrics must not present a fabricated zero as measured usage.
    reported: bool = False

    def add(self, other: "TokenUsage") -> None:
        total = self.total + other.total
        self.input_tokens += other.input_tokens
        self.output_tokens += other.output_tokens
        self.total_tokens = total
        self.reported = self.reported or other.reported

    @property
    def total(self) -> int:
        if self.total_tokens is not None:
            return self.total_tokens
        return self.input_tokens + self.output_tokens

    def to_dict(self) -> dict[str, Any]:
        return {
            "input_tokens": self.input_tokens,
            "output_tokens": self.output_tokens,
            "total_tokens": self.total,
            "reported": self.reported,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> "TokenUsage":
        data = data or {}
        total = data.get("total_tokens")
        return cls(
            input_tokens=int(data.get("input_tokens", 0) or 0),
            output_tokens=int(data.get("output_tokens", 0) or 0),
            total_tokens=int(total) if total is not None else None,
            reported=bool(data.get("reported", True)),
        )


@dataclass
class TaskSpec:
    """A task in the form every harness entry point accepts.

    ``repo_path`` is the fixture directory the workspace is copied from. The
    test command may contain the ``{python}`` token, replaced with the
    interpreter running the harness, so tasks do not depend on a shell PATH.
    """

    task_id: str
    repo_path: str
    instruction: str
    test_command: str | None = None
    timeout_seconds: int = 300
    protected_paths: tuple[str, ...] = ()
    expected_paths: tuple[str, ...] = ()
    metadata: dict[str, Any] = field(default_factory=dict)

    @property
    def title(self) -> str:
        return str(self.metadata.get("title") or self.task_id)

    @property
    def kind(self) -> str:
        return str(self.metadata.get("kind") or "bug")

    @property
    def tags(self) -> tuple[str, ...]:
        raw = self.metadata.get("tags") or ()
        return tuple(str(x) for x in raw)

    def to_dict(self) -> dict[str, Any]:
        return {
            "task_id": self.task_id,
            "repo_path": self.repo_path,
            "instruction": self.instruction,
            "test_command": self.test_command,
            "timeout_seconds": self.timeout_seconds,
            "protected_paths": list(self.protected_paths),
            "expected_paths": list(self.expected_paths),
            "metadata": self.metadata,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "TaskSpec":
        return cls(
            task_id=str(data["task_id"]),
            repo_path=str(data.get("repo_path", "")),
            instruction=str(data["instruction"]),
            test_command=data.get("test_command"),
            timeout_seconds=int(data.get("timeout_seconds", 300)),
            protected_paths=tuple(data.get("protected_paths", ()) or ()),
            expected_paths=tuple(data.get("expected_paths", ()) or ()),
            metadata=dict(data.get("metadata", {}) or {}),
        )


@dataclass
class ToolCall:
    call_id: str
    name: str
    arguments: dict[str, Any] = field(default_factory=dict)
    raw_arguments: str | None = None

    def to_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "call_id": self.call_id,
            "name": self.name,
            "arguments": self.arguments,
        }
        if self.raw_arguments is not None:
            out["raw_arguments"] = self.raw_arguments
        return out

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "ToolCall":
        return cls(
            call_id=str(data.get("call_id", "")),
            name=str(data["name"]),
            arguments=dict(data.get("arguments", {}) or {}),
            raw_arguments=data.get("raw_arguments"),
        )


@dataclass
class ModelTurn:
    """One model response, provider-independent."""

    text: str | None = None
    tool_calls: tuple[ToolCall, ...] = ()
    usage: TokenUsage = field(default_factory=TokenUsage)
    finish_reason: str = "stop"
    latency_ms: int = 0
    raw: dict[str, Any] | None = None

    @property
    def requests_finish(self) -> bool:
        """A turn without tool calls is the model's *claim* of completion.

        It is never a success verdict; the harness still grades the workspace.
        """
        return not self.tool_calls

    def to_assistant_message(self) -> dict[str, Any]:
        message: dict[str, Any] = {"role": "assistant"}
        if self.text is not None:
            message["content"] = self.text
        if self.tool_calls:
            message["tool_calls"] = [
                {
                    "id": call.call_id,
                    "type": "function",
                    "function": {
                        "name": call.name,
                        "arguments": json.dumps(call.arguments, ensure_ascii=False),
                    },
                }
                for call in self.tool_calls
            ]
        return message

    def to_dict(self) -> dict[str, Any]:
        return {
            "text": self.text,
            "tool_calls": [c.to_dict() for c in self.tool_calls],
            "usage": self.usage.to_dict(),
            "finish_reason": self.finish_reason,
            "latency_ms": self.latency_ms,
            "raw": self.raw,
        }


@dataclass
class ToolResult:
    """Uniform tool output.

    ``success`` means the tool ran as requested. A test run with failing tests
    is still a successful *tool execution*; the structured ``metadata`` carries
    the test verdict. This keeps the tool-error rate meaningful.
    """

    success: bool
    output: str = ""
    error: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)
    duration_ms: int = 0

    def to_tool_message(self, call: ToolCall) -> dict[str, Any]:
        content = self.output if self.error is None else f"{self.output}\nERROR: {self.error}".strip()
        return {
            "role": "tool",
            "tool_call_id": call.call_id,
            "name": call.name,
            "content": content,
        }

    def to_dict(self) -> dict[str, Any]:
        return {
            "success": self.success,
            "output": self.output,
            "error": self.error,
            "metadata": self.metadata,
            "duration_ms": self.duration_ms,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "ToolResult":
        return cls(
            success=bool(data.get("success")),
            output=str(data.get("output", "")),
            error=data.get("error"),
            metadata=dict(data.get("metadata", {}) or {}),
            duration_ms=int(data.get("duration_ms", 0) or 0),
        )


@dataclass
class Observation:
    step: int
    attempt: int
    call: ToolCall
    result: ToolResult

    def to_dict(self) -> dict[str, Any]:
        return {
            "step": self.step,
            "attempt": self.attempt,
            "call": self.call.to_dict(),
            "result": self.result.to_dict(),
        }


@dataclass
class GradeResult:
    """The harness-owned verdict.

    ``authority`` names who decided: ``harness`` for tests/constraints,
    ``agent`` for the explicit no-verification experiment, or ``llm`` for an
    advisory model judge. Evidence must be serialisable and specific.
    """

    passed: bool
    score: float
    feedback: str = ""
    evidence: dict[str, Any] = field(default_factory=dict)
    authority: str = "harness"

    def to_dict(self) -> dict[str, Any]:
        return {
            "passed": self.passed,
            "score": self.score,
            "feedback": self.feedback,
            "evidence": self.evidence,
            "authority": self.authority,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "GradeResult":
        return cls(
            passed=bool(data.get("passed")),
            score=float(data.get("score", 0.0) or 0.0),
            feedback=str(data.get("feedback", "")),
            evidence=dict(data.get("evidence", {}) or {}),
            authority=str(data.get("authority", "harness")),
        )


@dataclass
class AttemptSummary:
    attempt: int
    steps: int = 0
    model_calls: int = 0
    tool_calls: int = 0
    tool_errors: int = 0
    claimed_finish: bool = False
    grade: GradeResult | None = None
    failure_reason: str | None = None
    usage: TokenUsage = field(default_factory=lambda: TokenUsage(reported=False))
    latency_ms: int = 0
    context_tokens: int = 0

    def to_dict(self) -> dict[str, Any]:
        return {
            "attempt": self.attempt,
            "steps": self.steps,
            "model_calls": self.model_calls,
            "tool_calls": self.tool_calls,
            "tool_errors": self.tool_errors,
            "claimed_finish": self.claimed_finish,
            "grade": self.grade.to_dict() if self.grade else None,
            "failure_reason": self.failure_reason,
            "usage": self.usage.to_dict(),
            "latency_ms": self.latency_ms,
            "context_tokens": self.context_tokens,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "AttemptSummary":
        grade = data.get("grade")
        return cls(
            attempt=int(data["attempt"]),
            steps=int(data.get("steps", 0)),
            model_calls=int(data.get("model_calls", 0)),
            tool_calls=int(data.get("tool_calls", 0)),
            tool_errors=int(data.get("tool_errors", 0)),
            claimed_finish=bool(data.get("claimed_finish")),
            grade=GradeResult.from_dict(grade) if grade else None,
            failure_reason=data.get("failure_reason"),
            usage=TokenUsage.from_dict(data.get("usage")),
            latency_ms=int(data.get("latency_ms", 0)),
            context_tokens=int(data.get("context_tokens", 0)),
        )


@dataclass
class RunState:
    """Mutable runtime state for one run.

    ``messages`` is the model-facing history. ``observations`` keeps the typed
    record used by artifacts and diagnostics. ``files_read`` / ``files_changed``
    are facts reported by tools and the workspace, never model claims.
    """

    task: TaskSpec
    run_id: str
    step: int = 0
    attempt: int = 1
    messages: list[dict[str, Any]] = field(default_factory=list)
    tool_calls: list[ToolCall] = field(default_factory=list)
    observations: list[Observation] = field(default_factory=list)
    files_changed: list[str] = field(default_factory=list)
    files_read: list[str] = field(default_factory=list)
    status: str = RUNNING
    failure_reason: str | None = None
    claimed_finish: bool = False
    usage: TokenUsage = field(default_factory=lambda: TokenUsage(reported=False))
    attempts: list[AttemptSummary] = field(default_factory=list)
    grader_feedback: list[str] = field(default_factory=list)
    started_at: str = ""
    ended_at: str | None = None
    diagnostics: dict[str, Any] = field(default_factory=dict)

    def add_message(self, message: dict[str, Any]) -> None:
        self.messages.append(message)

    def add_observation(self, observation: Observation) -> None:
        self.observations.append(observation)
        self.add_message(observation.result.to_tool_message(observation.call))
        if observation.call.name in ("read_file", "grep"):
            path = observation.result.metadata.get("path")
            if path and observation.call.name == "read_file" and path not in self.files_read:
                self.files_read.append(path)
        if not observation.result.success:
            errors = self.diagnostics.setdefault("tool_errors", [])
            errors.append(
                {
                    "tool": observation.call.name,
                    "error": observation.result.error,
                    "arguments": observation.call.arguments,
                }
            )

    def to_dict(self) -> dict[str, Any]:
        return {
            "task": self.task.to_dict(),
            "run_id": self.run_id,
            "step": self.step,
            "attempt": self.attempt,
            "messages": self.messages,
            "tool_calls": [c.to_dict() for c in self.tool_calls],
            "observations": [o.to_dict() for o in self.observations],
            "files_changed": self.files_changed,
            "files_read": self.files_read,
            "status": self.status,
            "failure_reason": self.failure_reason,
            "claimed_finish": self.claimed_finish,
            "usage": self.usage.to_dict(),
            "attempts": [a.to_dict() for a in self.attempts],
            "grader_feedback": self.grader_feedback,
            "started_at": self.started_at,
            "ended_at": self.ended_at,
            "diagnostics": self.diagnostics,
        }


@dataclass
class HarnessResult:
    """The final, serialisable outcome of a harness run."""

    run_id: str
    task_id: str
    status: str
    success: bool
    score: float
    failure_reason: str | None
    failure_category: str | None
    attempts: list[AttemptSummary]
    steps: int
    model_calls: int
    tool_calls: int
    tool_errors: int
    retries: int
    usage: TokenUsage
    latency_ms: int
    context_tokens: int
    files_changed: list[str]
    files_read: list[str]
    tests: dict[str, Any] | None
    grade: GradeResult | None
    claimed_finish: bool
    run_dir: str | None = None
    trace_path: str | None = None
    workspace_dir: str | None = None
    diagnostics: dict[str, Any] = field(default_factory=dict)
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "run_id": self.run_id,
            "task_id": self.task_id,
            "status": self.status,
            "success": self.success,
            "score": self.score,
            "failure_reason": self.failure_reason,
            "failure_category": self.failure_category,
            "attempts": [a.to_dict() for a in self.attempts],
            "steps": self.steps,
            "model_calls": self.model_calls,
            "tool_calls": self.tool_calls,
            "tool_errors": self.tool_errors,
            "retries": self.retries,
            "usage": self.usage.to_dict(),
            "latency_ms": self.latency_ms,
            "context_tokens": self.context_tokens,
            "files_changed": self.files_changed,
            "files_read": self.files_read,
            "tests": self.tests,
            "grade": self.grade.to_dict() if self.grade else None,
            "claimed_finish": self.claimed_finish,
            "run_dir": self.run_dir,
            "trace_path": self.trace_path,
            "workspace_dir": self.workspace_dir,
            "diagnostics": self.diagnostics,
            "metadata": self.metadata,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "HarnessResult":
        grade = data.get("grade")
        return cls(
            run_id=str(data["run_id"]),
            task_id=str(data["task_id"]),
            status=str(data.get("status", FAILED)),
            success=bool(data.get("success")),
            score=float(data.get("score", 0.0) or 0.0),
            failure_reason=data.get("failure_reason"),
            failure_category=data.get("failure_category"),
            attempts=[AttemptSummary.from_dict(a) for a in data.get("attempts", [])],
            steps=int(data.get("steps", 0)),
            model_calls=int(data.get("model_calls", 0)),
            tool_calls=int(data.get("tool_calls", 0)),
            tool_errors=int(data.get("tool_errors", 0)),
            retries=int(data.get("retries", 0)),
            usage=TokenUsage.from_dict(data.get("usage")),
            latency_ms=int(data.get("latency_ms", 0)),
            context_tokens=int(data.get("context_tokens", 0)),
            files_changed=list(data.get("files_changed", []) or []),
            files_read=list(data.get("files_read", []) or []),
            tests=data.get("tests"),
            grade=GradeResult.from_dict(grade) if grade else None,
            claimed_finish=bool(data.get("claimed_finish")),
            run_dir=data.get("run_dir"),
            trace_path=data.get("trace_path"),
            workspace_dir=data.get("workspace_dir"),
            diagnostics=dict(data.get("diagnostics", {}) or {}),
            metadata=dict(data.get("metadata", {}) or {}),
        )
