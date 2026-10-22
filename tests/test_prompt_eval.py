"""Tests for prompt loading, failure classification, and report generation."""

from __future__ import annotations

from pathlib import Path

import pytest

from agent_replay.core.prompts import load_prompt_templates, render_prompt
from experiments.prompt_eval import _summarize, classify_failure
from experiments.report import build_report


def test_load_prompt_templates(tmp_path: Path):
    (tmp_path / "default.txt").write_text("A {{ instruction }} Z", encoding="utf-8")
    (tmp_path / "structured.txt").write_text("S {{ instruction }} S", encoding="utf-8")
    templates = load_prompt_templates(tmp_path, ("default", "structured"))
    assert templates["default"] == "A {{ instruction }} Z"
    assert templates["structured"] == "S {{ instruction }} S"


def test_load_prompt_templates_missing_placeholder(tmp_path: Path):
    (tmp_path / "default.txt").write_text("no placeholder", encoding="utf-8")
    with pytest.raises(ValueError):
        load_prompt_templates(tmp_path, ("default",))


def test_load_prompt_templates_missing_file(tmp_path: Path):
    with pytest.raises(FileNotFoundError):
        load_prompt_templates(tmp_path, ("default",))


def test_render_prompt_substitutes_instruction():
    assert render_prompt("do {{ instruction }} now", "the thing") == "do the thing now"


def test_render_prompt_strips_whitespace():
    assert render_prompt("  {{ instruction }}  \n", "x") == "x"


def test_classify_failure_timeout():
    run = {"success": False, "termination": {"kind": "timeout"}}
    assert classify_failure(run) == "timeout"


def test_classify_failure_provider():
    run = {"success": False, "termination": {"kind": "provider_unavailable"}}
    assert classify_failure(run) == "provider_unavailable"


def test_classify_failure_no_edit():
    run = {
        "success": False,
        "files_changed": [],
        "verify": {"failed": 2},
        "termination": {"kind": "task_failure"},
    }
    assert classify_failure(run) == "no_edit"


def test_classify_failure_tests_failed():
    run = {
        "success": False,
        "files_changed": ["a.mjs"],
        "verify": {"failed": 2},
        "termination": {"kind": "task_failure"},
    }
    assert classify_failure(run) == "tests_failed"


def test_classify_failure_tests_modified():
    run = {"success": False, "tampered": True, "reason": "tests_modified"}
    assert classify_failure(run) == "tests_modified"


def test_summarize_and_report_builds_markdown():
    config = {
        "experiment_id": "exp-test",
        "model": "m",
        "adapter": "opencode",
        "task_set": ["a", "b"],
        "num_tasks": 2,
        "runs": 1,
        "prompts": ["default", "structured"],
        "timestamp": "2026-01-01T00:00:00+00:00",
        "commit": "abc123",
        "seed": 0,
    }
    runs = [
        {
            "task_id": "a", "run": 1, "prompt_name": "default", "success": True,
            "latency_ms": 100, "usage": {"input": 10, "output": 5, "total": 15},
            "files_changed": ["a.mjs"], "verify": {"passed": 3, "failed": 0, "total": 3},
            "termination": {"kind": "completed"},
        },
        {
            "task_id": "b", "run": 1, "prompt_name": "default", "success": False,
            "latency_ms": 200, "usage": {"input": 10, "output": 5, "total": 15},
            "files_changed": [], "verify": {"passed": 1, "failed": 2, "total": 3},
            "termination": {"kind": "task_failure"},
        },
        {
            "task_id": "a", "run": 1, "prompt_name": "structured", "success": True,
            "latency_ms": 150, "usage": {"input": 12, "output": 6, "total": 18},
            "files_changed": ["a.mjs"], "verify": {"passed": 3, "failed": 0, "total": 3},
            "termination": {"kind": "completed"},
        },
        {
            "task_id": "b", "run": 1, "prompt_name": "structured", "success": True,
            "latency_ms": 180, "usage": {"input": 12, "output": 6, "total": 18},
            "files_changed": ["b.mjs"], "verify": {"passed": 3, "failed": 0, "total": 3},
            "termination": {"kind": "completed"},
        },
    ]
    summary = _summarize(config, runs)
    assert summary["per_prompt"]["default"]["success_rate"] == pytest.approx(0.5)
    assert summary["per_prompt"]["structured"]["success_rate"] == pytest.approx(1.0)

    report = build_report(summary)
    assert "# Prompt Evaluation Report" in report
    assert "## Setup" in report
    assert "## Results" in report
    assert "## Failure Analysis" in report
    assert "## Conclusion" in report
