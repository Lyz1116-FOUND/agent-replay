"""Supervisor-worker orchestration (M10).

The supervisor does not let agents chat freely. It drives capped rounds of
coder → grader → reviewer, records every message, and leaves the success
verdict with the harness grader. Reviewer feedback can trigger another coder
round; the supervisor never turns "looks good" into a pass.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from ..harness.config import HarnessConfig
from ..harness.loop import AgentHarness
from ..harness.model_client import ModelClient
from ..harness.types import HarnessResult, TaskSpec, TokenUsage
from .a2a import AgentMessage, MessageBus
from .coder import CoderAgent
from .reviewer import ReviewerAgent


@dataclass
class MultiAgentState:
    task: TaskSpec
    shared_context: list[str] = field(default_factory=list)
    coder_result: dict[str, Any] | None = None
    reviewer_result: dict[str, Any] | None = None
    round: int = 0
    max_rounds: int = 2
    max_agent_calls: int = 12
    max_total_tokens: int | None = None
    tokens_used: TokenUsage = field(default_factory=lambda: TokenUsage(reported=False))
    messages: list[dict[str, Any]] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "task": self.task.task_id,
            "shared_context": self.shared_context,
            "coder_result": self.coder_result,
            "reviewer_result": self.reviewer_result,
            "round": self.round,
            "max_rounds": self.max_rounds,
            "max_agent_calls": self.max_agent_calls,
            "max_total_tokens": self.max_total_tokens,
            "tokens_used": self.tokens_used.to_dict(),
            "messages": self.messages,
        }


class Supervisor:
    def __init__(
        self,
        task: TaskSpec,
        config: HarnessConfig,
        *,
        model: ModelClient,
        reviewer_model: ModelClient | None = None,
        run_id: str | None = None,
        abort_check=None,
    ) -> None:
        self.task = task
        self.config = config.with_overrides(reviewer=True)
        self.model = model
        self.reviewer_model = reviewer_model or model
        self.run_id = run_id
        self.abort_check = abort_check
        self.bus = MessageBus()
        self.state = MultiAgentState(
            task=task,
            max_rounds=self.config.max_rounds,
            max_agent_calls=self.config.max_agent_calls,
            max_total_tokens=self.config.max_total_tokens,
        )

    def run(self) -> HarnessResult:
        harness = AgentHarness(
            self.task,
            self.config,
            agent=CoderAgent(self.model),
            reviewer=ReviewerAgent(self.reviewer_model),
            on_agent_message=self.bus.record,
            abort_check=self.abort_check,
            run_id=self.run_id,
        )
        result = harness.run()
        self.state.round = len(result.attempts)
        self.state.shared_context = [
            str(message.payload.get("feedback", ""))
            for message in self.bus.messages
            if message.type == "feedback" and message.payload.get("feedback")
        ]
        if result.attempts:
            last = result.attempts[-1]
            self.state.coder_result = {
                "attempt": last.attempt,
                "grade_passed": last.grade.passed if last.grade else None,
                "claimed_finish": last.claimed_finish,
                "failure_reason": last.failure_reason,
                "usage": last.usage.to_dict(),
            }
        reviews = result.diagnostics.get("reviews") or []
        if reviews:
            self.state.reviewer_result = reviews[-1]
        self.state.tokens_used = result.usage
        self.state.messages = self.bus.to_list()
        result.metadata["multi_agent"] = self.state.to_dict()
        result.diagnostics["a2a_messages"] = self.bus.to_list()

        if result.run_dir:
            run_dir = Path(result.run_dir)
            try:
                (run_dir / "multi_agent.json").write_text(
                    json.dumps(self.state.to_dict(), indent=2, ensure_ascii=False, default=str),
                    encoding="utf-8",
                )
                if (run_dir / "result.json").is_file():
                    (run_dir / "result.json").write_text(
                        json.dumps(result.to_dict(), indent=2, ensure_ascii=False, default=str),
                        encoding="utf-8",
                    )
                if (run_dir / "trace.json").is_file():
                    trace = json.loads((run_dir / "trace.json").read_text(encoding="utf-8"))
                    trace.setdefault("metadata", {})["multiAgent"] = True
                    (run_dir / "trace.json").write_text(
                        json.dumps(trace, indent=2, ensure_ascii=False),
                        encoding="utf-8",
                    )
            except (OSError, json.JSONDecodeError):
                pass
        return result
