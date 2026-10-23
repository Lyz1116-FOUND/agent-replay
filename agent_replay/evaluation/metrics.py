"""Harness metrics with explicit definitions.

Every number here is computed from recorded runs. Missing provider usage is
reported as unavailable, never as zero. Scripted-mechanics runs are labelled
by the caller and must not be read as model capability.
"""

from __future__ import annotations

import math
import random
from typing import Any, Iterable


def _percentile(sorted_values: list[float], p: float) -> float:
    if not sorted_values:
        return 0.0
    if len(sorted_values) == 1:
        return sorted_values[0]
    k = (len(sorted_values) - 1) * p
    lower, upper = math.floor(k), math.ceil(k)
    if lower == upper:
        return sorted_values[int(k)]
    return sorted_values[lower] + (sorted_values[upper] - sorted_values[lower]) * (k - lower)


def latency_stats(values: Iterable[int | float | None]) -> dict[str, Any]:
    numbers = sorted(float(value) for value in values if value is not None)
    if not numbers:
        return {
            "count": 0,
            "avg_ms": None,
            "median_ms": None,
            "p95_ms": None,
            "min_ms": None,
            "max_ms": None,
        }
    return {
        "count": len(numbers),
        "avg_ms": round(sum(numbers) / len(numbers), 1),
        "median_ms": round(_percentile(numbers, 0.5), 1),
        "p95_ms": round(_percentile(numbers, 0.95), 1),
        "min_ms": numbers[0],
        "max_ms": numbers[-1],
    }


def token_stats(records: list[dict[str, Any]]) -> dict[str, Any]:
    reported = [
        record
        for record in records
        if isinstance(record.get("usage"), dict) and record["usage"].get("reported")
    ]
    if not reported:
        return {
            "available": False,
            "runs_with_usage": 0,
            "total_input": None,
            "total_output": None,
            "total": None,
            "avg_input": None,
            "avg_output": None,
        }
    total_input = sum(int(record["usage"].get("input_tokens", 0)) for record in reported)
    total_output = sum(int(record["usage"].get("output_tokens", 0)) for record in reported)
    return {
        "available": True,
        "runs_with_usage": len(reported),
        "total_input": total_input,
        "total_output": total_output,
        "total": sum(int(record["usage"].get("total_tokens") or (
            int(record["usage"].get("input_tokens", 0)) + int(record["usage"].get("output_tokens", 0))
        )) for record in reported),
        "avg_input": round(total_input / len(reported), 1),
        "avg_output": round(total_output / len(reported), 1),
    }


def context_stats(records: list[dict[str, Any]]) -> dict[str, Any]:
    values = [int(record.get("context_tokens", 0) or 0) for record in records]
    if not values:
        return {"count": 0, "avg_tokens": None, "median_tokens": None, "p95_tokens": None}
    ordered = sorted(float(value) for value in values)
    return {
        "count": len(values),
        "avg_tokens": round(sum(ordered) / len(ordered), 1),
        "median_tokens": round(_percentile(ordered, 0.5), 1),
        "p95_tokens": round(_percentile(ordered, 0.95), 1),
    }


def success_rate(records: list[dict[str, Any]], key: str = "success") -> float | None:
    if not records:
        return None
    return sum(1 for record in records if record.get(key)) / len(records)


def pass_at_1(records: list[dict[str, Any]]) -> float | None:
    """First run of each task, then its first attempt.

    With multiple runs per task, this stays one observation per task rather
    than silently weighting tasks by how many times they were run.
    """
    if not records:
        return None
    first_by_task: dict[str, tuple[int, int, dict[str, Any]]] = {}
    for index, record in enumerate(records):
        task_id = str(record.get("task_id"))
        run_index = int(record.get("run", 1) or 1)
        candidate = (run_index, index, record)
        current = first_by_task.get(task_id)
        if current is None or candidate[:2] < current[:2]:
            first_by_task[task_id] = candidate
    passed = 0
    for _, _, record in first_by_task.values():
        attempts = record.get("attempts") or []
        first = attempts[0] if attempts else None
        grade = (first or {}).get("grade") or {}
        if bool(grade.get("passed")):
            passed += 1
    return passed / len(first_by_task)


def retry_recovery(records: list[dict[str, Any]]) -> dict[str, Any]:
    initial_failures = 0
    recovered = 0
    for record in records:
        attempts = record.get("attempts") or []
        if not attempts:
            continue
        first_grade = (attempts[0].get("grade") or {}).get("passed")
        if first_grade:
            continue
        initial_failures += 1
        if record.get("success"):
            recovered += 1
    return {
        "initial_failures": initial_failures,
        "recovered": recovered,
        "rate": (recovered / initial_failures) if initial_failures else None,
    }


def bootstrap_ci(successes: list[bool], n: int = 2000, seed: int = 0) -> tuple[float, float] | None:
    if not successes:
        return None
    rng = random.Random(seed)
    rates: list[float] = []
    for _ in range(n):
        sample = [rng.choice(successes) for _ in successes]
        rates.append(sum(sample) / len(sample))
    rates.sort()
    return rates[int(0.025 * n)], rates[int(0.975 * n)]


def summarize_records(records: list[dict[str, Any]], seed: int = 0) -> dict[str, Any]:
    total = len(records)
    harness_successes = [bool(record.get("success")) for record in records]
    verified_successes = [bool(record.get("verified_success")) for record in records]
    tool_calls = sum(int(record.get("tool_calls", 0) or 0) for record in records)
    tool_errors = sum(int(record.get("tool_errors", 0) or 0) for record in records)
    return {
        "runs": total,
        "tasks": len({record.get("task_id") for record in records}),
        "success_rate": success_rate(records),
        "success_ci": list(bootstrap_ci(harness_successes, seed=seed))
        if bootstrap_ci(harness_successes, seed=seed)
        else None,
        "verified_success_rate": success_rate(records, key="verified_success"),
        "verified_success_ci": list(bootstrap_ci(verified_successes, seed=seed))
        if bootstrap_ci(verified_successes, seed=seed)
        else None,
        "pass_at_1": pass_at_1(records),
        "retry_recovery": retry_recovery(records),
        "tool_error_rate": round(tool_errors / tool_calls, 4) if tool_calls else 0.0,
        "tool_calls": tool_calls,
        "tool_calls_per_task": round(tool_calls / total, 2) if total else None,
        "avg_steps": round(sum(int(r.get("steps", 0) or 0) for r in records) / total, 2)
        if total
        else None,
        "avg_agent_calls": round(sum(int(r.get("model_calls", 0) or 0) for r in records) / total, 2)
        if total
        else None,
        "latency": latency_stats(record.get("latency_ms") for record in records),
        "tokens": token_stats(records),
        "context": context_stats(records),
        "regression_rate": round(
            sum(1 for record in records if record.get("regression")) / total, 4
        )
        if total
        else None,
        "regressions": sum(1 for record in records if record.get("regression")),
        "false_completion_rate": round(
            sum(1 for record in records if record.get("false_completion")) / total, 4
        )
        if total
        else None,
        "false_completions": sum(1 for record in records if record.get("false_completion")),
        "false_failures": sum(
            1
            for record in records
            if record.get("verified_success") and not record.get("success")
        ),
    }
