"""Per-run artifact directory.

Layout (the M2 contract):

    runs/<run_id>/
        task.json
        config.json
        events.jsonl
        messages.jsonl
        patch.diff
        test_results.json
        grade.json
        metrics.json
        result.json
        trace.json        # importable into the Agent Replay viewer
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .config import HarnessConfig
from .events import EventLogger, JsonlWriter
from .grader import test_report_from_grade
from .types import GradeResult, HarnessResult, RunState, TaskSpec


class RunArtifacts:
    def __init__(
        self,
        run_dir: Path,
        task: TaskSpec,
        config: HarnessConfig,
        *,
        listener=None,
    ) -> None:
        self.run_dir = run_dir
        self.run_dir.mkdir(parents=True, exist_ok=True)
        self.events = EventLogger(run_dir / "events.jsonl", listener=listener)
        self._messages = JsonlWriter(run_dir / "messages.jsonl")
        self._write_json("task.json", task.to_dict())
        self._write_json("config.json", config.to_dict())

    def _write_json(self, name: str, data: Any) -> None:
        (self.run_dir / name).write_text(
            json.dumps(data, indent=2, ensure_ascii=False, default=str),
            encoding="utf-8",
        )

    def record_message(self, attempt: int, step: int, message: dict[str, Any]) -> None:
        self._messages.write(
            {
                "attempt": attempt,
                "step": step,
                **message,
            }
        )

    def finalize(
        self,
        result: HarnessResult,
        state: RunState,
        grade: GradeResult | None,
        *,
        patch: str,
        metrics: dict[str, Any],
        trace: dict[str, Any] | None,
    ) -> None:
        (self.run_dir / "patch.diff").write_text(patch, encoding="utf-8")
        report = test_report_from_grade(grade)
        self._write_json("test_results.json", report or result.tests)
        self._write_json("grade.json", grade.to_dict() if grade else None)
        self._write_json("metrics.json", metrics)
        self._write_json("result.json", result.to_dict())
        if trace is not None:
            self._write_json("trace.json", trace)

    def close(self) -> None:
        self.events.close()
        self._messages.close()
