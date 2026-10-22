"""Tests for the experiment metric functions."""

from __future__ import annotations

import pytest

from experiments.metrics import (
    bootstrap_ci,
    latency_stats,
    pass_at_1,
    success_rate,
    token_stats,
)


def test_success_rate_empty():
    assert success_rate([]) is None


def test_success_rate():
    runs = [{"success": True}, {"success": False}, {"success": True}]
    assert success_rate(runs) == pytest.approx(2 / 3)


def test_pass_at_1_uses_first_run_only():
    runs = [
        {"task_id": "a", "run": 1, "success": True},
        {"task_id": "a", "run": 2, "success": False},
        {"task_id": "b", "run": 1, "success": False},
    ]
    assert pass_at_1(runs) == pytest.approx(0.5)


def test_pass_at_1_equals_success_rate_when_single_run():
    runs = [
        {"task_id": "a", "run": 1, "success": True},
        {"task_id": "b", "run": 1, "success": False},
        {"task_id": "c", "run": 1, "success": True},
    ]
    assert pass_at_1(runs) == success_rate(runs)


def test_latency_stats():
    stats = latency_stats([100, 200, 300])
    assert stats["count"] == 3
    assert stats["avg_ms"] == 200
    assert stats["median_ms"] == 200
    assert stats["min_ms"] == 100
    assert stats["max_ms"] == 300


def test_latency_stats_empty():
    stats = latency_stats([])
    assert stats["count"] == 0
    assert stats["avg_ms"] is None
    assert stats["p95_ms"] is None


def test_latency_stats_p95():
    stats = latency_stats(list(range(1, 101)))  # 1..100
    assert stats["p95_ms"] == pytest.approx(95.0, rel=0.06)


def test_token_stats_available():
    runs = [
        {"usage": {"input": 10, "output": 5, "total": 15}},
        {"usage": {"input": 20, "output": 10, "total": 30}},
    ]
    stats = token_stats(runs)
    assert stats["available"] is True
    assert stats["runs_with_usage"] == 2
    assert stats["total"] == 45
    assert stats["avg_input"] == 15


def test_token_stats_unavailable_when_no_usage():
    runs = [{"usage": None}, {"usage": None}]
    stats = token_stats(runs)
    assert stats["available"] is False
    assert stats["total"] is None


def test_bootstrap_ci_bounds():
    ci = bootstrap_ci([True, False, True, True, False], seed=0)
    assert ci is not None
    lo, hi = ci
    assert 0.0 <= lo <= hi <= 1.0


def test_bootstrap_ci_empty():
    assert bootstrap_ci([]) is None
