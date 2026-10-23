"""Benchmark plumbing, metrics, and failure taxonomy."""

from __future__ import annotations

import json
from pathlib import Path

from agent_replay.evaluation.benchmark import EXPERIMENT_VARIANTS, run_benchmark
from agent_replay.evaluation.failure_taxonomy import classify_failure
from agent_replay.evaluation.metrics import (
    pass_at_1,
    retry_recovery,
    token_stats,
)
from tests.harness_helpers import make_calc_task


def test_small_scripted_benchmark_end_to_end(tmp_path, harness_config):
    tasks = [
        make_calc_task(tmp_path, task_id="toy_a"),
        make_calc_task(
            tmp_path,
            task_id="toy_b",
            buggy="def add(a, b):\n    return a * b\n",
            tests="from calc import add\n\ndef test_add():\n    assert add(2, 3) == 5\n",
        ),
    ]
    variants = [
        EXPERIMENT_VARIANTS["2"][0],
        EXPERIMENT_VARIANTS["2"][1],
        EXPERIMENT_VARIANTS["retry"][1],
    ]
    output = tmp_path / "bench"
    summary = run_benchmark(
        tasks=tasks,
        variants=variants,
        config=harness_config,
        output_dir=output,
        runs=1,
        backend="scripted",
        evidence_level="mechanics",
    )

    assert summary["variants"]["no_verification"]["success_rate"] == 1.0
    assert summary["variants"]["no_verification"]["verified_success_rate"] == 0.0
    assert summary["variants"]["no_verification"]["false_completions"] == 2
    assert summary["variants"]["verified"]["success_rate"] == 0.0
    assert summary["variants"]["retry_once"]["success_rate"] == 1.0
    assert summary["variants"]["retry_once"]["retry_recovery"]["rate"] == 1.0
    assert summary["variants"]["retry_once"]["failure_taxonomy"]["counts"] == {}

    assert (output / "config.json").is_file()
    assert (output / "summary.json").is_file()
    assert (output / "summary.csv").is_file()
    assert (output / "report.md").is_file()
    report = (output / "report.md").read_text(encoding="utf-8")
    assert "Validation level: mechanics" in report
    assert "not model capability" in report or "not an LLM" in report
    raw_lines = (output / "raw_runs.jsonl").read_text(encoding="utf-8").splitlines()
    assert len(raw_lines) == 6
    for line in raw_lines:
        record = json.loads(line)
        assert "verified_success" in record
        assert "posthoc" in record
        assert "baseline_failed_tests" in record


def test_token_stats_do_not_fabricate_zeros():
    records = [
        {"usage": {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0, "reported": False}}
    ]
    stats = token_stats(records)
    assert stats["available"] is False
    assert stats["total"] is None

    stats = token_stats(
        records
        + [
            {
                "usage": {
                    "input_tokens": 10,
                    "output_tokens": 5,
                    "total_tokens": 15,
                    "reported": True,
                }
            }
        ]
    )
    assert stats == {
        "available": True,
        "runs_with_usage": 1,
        "total_input": 10,
        "total_output": 5,
        "total": 15,
        "avg_input": 10.0,
        "avg_output": 5.0,
    }


def test_pass_at_1_is_one_observation_per_task():
    records = [
        {
            "task_id": "toy",
            "run": 1,
            "attempts": [{"grade": {"passed": False}}, {"grade": {"passed": True}}],
        },
        {
            "task_id": "toy",
            "run": 2,
            "attempts": [{"grade": {"passed": True}}],
        },
        {
            "task_id": "other",
            "run": 1,
            "attempts": [{"grade": {"passed": True}}],
        },
    ]
    assert pass_at_1(records) == 0.5


def test_retry_recovery_definition():
    records = [
        {"attempts": [{"grade": {"passed": False}}, {"grade": {"passed": True}}], "success": True},
        {"attempts": [{"grade": {"passed": False}}], "success": False},
        {"attempts": [{"grade": {"passed": True}}], "success": True},
    ]
    recovery = retry_recovery(records)
    assert recovery["initial_failures"] == 2
    assert recovery["recovered"] == 1
    assert recovery["rate"] == 0.5


def _record(**overrides):
    record = {
        "success": False,
        "verified_success": False,
        "status": "failed",
        "failure_reason": "tests_failed",
        "claimed_finish": True,
        "steps": 4,
        "files_changed": [],
        "expected_paths": [],
        "diagnostics": {},
        "posthoc": {"tests": {"status": "fail", "failed_tests": ["tests/test_a.py::test_a"]}},
        "baseline_failed_tests": ["tests/test_a.py::test_a"],
        "regression": False,
    }
    record.update(overrides)
    return record


def test_failure_taxonomy_covers_planned_categories():
    assert classify_failure(_record(status="timeout", failure_reason="timeout"))["code"] == "F12"
    assert classify_failure(_record(status="provider_error", failure_reason="provider_error"))["code"] == "I1"
    assert classify_failure(_record(failure_reason="max_steps"))["code"] == "F10"
    assert classify_failure(
        _record(failure_reason="tests_modified", posthoc={"protected_modified": True})
    )["code"] == "F13"
    assert classify_failure(
        _record(
            regression=True,
            baseline_failed_tests=["tests/test_a.py::test_a"],
            posthoc={"tests": {"status": "fail", "failed_tests": ["tests/test_b.py::test_b"]}},
        )
    )["code"] == "F9"
    assert classify_failure(
        _record(
            diagnostics={
                "tool_calls": [{"metadata": {"invalid_kind": "unknown_tool"}}],
            }
        )
    )["code"] == "F3"
    assert classify_failure(
        _record(
            diagnostics={
                "tool_calls": [{"metadata": {"invalid_kind": "invalid_arguments"}}],
            }
        )
    )["code"] == "F4"
    assert classify_failure(_record(claimed_finish=True, steps=2))["code"] == "F11"
    assert classify_failure(
        _record(
            claimed_finish=False,
            diagnostics={"test_runs": [{"stage": "agent", "status": "fail"}]},
        )
    )["code"] == "F1"
    assert classify_failure(
        _record(
            files_changed=["src/a.py"],
            expected_paths=["src/a.py"],
            diagnostics={"test_runs": [{"stage": "agent", "status": "fail"}]},
        )
    )["code"] == "F8"
    assert classify_failure(
        _record(
            files_changed=["src/wrong.py"],
            expected_paths=["src/a.py"],
            diagnostics={"test_runs": [{"stage": "agent", "status": "pass"}]},
        )
    )["code"] == "F2"
    assert classify_failure(
        _record(
            files_changed=["src/a.py"],
            expected_paths=["src/a.py"],
            diagnostics={"test_runs": [{"stage": "agent", "status": "pass"}]},
        )
    )["code"] == "F6"
    assert classify_failure(
        _record(
            diagnostics={
                "context": [{"dropped_messages": 2}],
                "reads_by_file": {"src/a.py": 4},
            }
        )
    )["code"] == "F5"
    assert classify_failure(
        _record(
            diagnostics={"test_runs": [{"stage": "agent", "status": "fail"}]},
            claimed_finish=True,
            steps=5,
        )
    )["code"] == "F1"


def test_success_is_not_a_failure():
    assert classify_failure(_record(success=True, verified_success=True)) is None
