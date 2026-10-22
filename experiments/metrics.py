"""Metric definitions for prompt evaluation.

Every metric has an explicit definition so the numbers are auditable:

* ``success_rate`` — the fraction of runs whose trusted verdict is ``pass``.
* ``pass_at_1`` — the fraction of tasks whose *first* run passes. When the
  experiment runs each task exactly once, this equals ``success_rate``.
* ``latency_stats`` — avg / median / p95 / min / max over wall-clock run times.
* ``token_stats`` — summed and averaged token usage; ``available=False`` when
  the provider reported no usage (never fabricated).
"""

from __future__ import annotations

import math
import random
from typing import Any, Iterable


def success_rate(runs: list[dict[str, Any]]) -> float | None:
    total = len(runs)
    if total == 0:
        return None
    return sum(1 for r in runs if bool(r.get("success"))) / total


def pass_at_1(runs: list[dict[str, Any]]) -> float | None:
    """First run per task; a task keyed by ``task_id`` contributes once."""
    first_by_task: dict[str, dict[str, Any]] = {}
    for r in sorted(runs, key=lambda x: int(x.get("run", 1))):
        first_by_task.setdefault(r["task_id"], r)
    firsts = list(first_by_task.values())
    if not firsts:
        return None
    return sum(1 for r in firsts if bool(r.get("success"))) / len(firsts)


def _percentile(sorted_vals: list[float], p: float) -> float:
    if len(sorted_vals) == 1:
        return sorted_vals[0]
    k = (len(sorted_vals) - 1) * p
    f, c = math.floor(k), math.ceil(k)
    if f == c:
        return sorted_vals[int(k)]
    return sorted_vals[f] + (sorted_vals[c] - sorted_vals[f]) * (k - f)


def latency_stats(latencies: Iterable[int | None]) -> dict[str, Any]:
    vals = sorted(float(x) for x in latencies if x is not None)
    if not vals:
        return {
            "count": 0,
            "avg_ms": None,
            "median_ms": None,
            "p95_ms": None,
            "min_ms": None,
            "max_ms": None,
        }
    return {
        "count": len(vals),
        "avg_ms": round(sum(vals) / len(vals), 1),
        "median_ms": round(_percentile(vals, 0.5), 1),
        "p95_ms": round(_percentile(vals, 0.95), 1),
        "min_ms": vals[0],
        "max_ms": vals[-1],
    }


def token_stats(runs: list[dict[str, Any]]) -> dict[str, Any]:
    with_usage = [r for r in runs if r.get("usage")]
    if not with_usage:
        return {
            "available": False,
            "runs_with_usage": 0,
            "total_input": None,
            "total_output": None,
            "total": None,
            "avg_input": None,
            "avg_output": None,
        }
    n = len(with_usage)
    total_input = sum(int(r["usage"]["input"]) for r in with_usage)
    total_output = sum(int(r["usage"]["output"]) for r in with_usage)
    return {
        "available": True,
        "runs_with_usage": n,
        "total_input": total_input,
        "total_output": total_output,
        "total": total_input + total_output,
        "avg_input": round(total_input / n, 1),
        "avg_output": round(total_output / n, 1),
    }


def bootstrap_ci(
    successes: list[bool], n: int = 2000, seed: int = 0
) -> tuple[float, float] | None:
    """Percentile bootstrap 95% confidence interval for a success rate."""
    if not successes:
        return None
    rng = random.Random(seed)
    rates: list[float] = []
    for _ in range(n):
        sample = [rng.choice(successes) for _ in successes]
        rates.append(sum(sample) / len(sample))
    rates.sort()
    return rates[int(0.025 * n)], rates[int(0.975 * n)]
