"""Markdown report for harness benchmarks."""

from __future__ import annotations

from typing import Any


def _pct(value: float | None) -> str:
    return "—" if value is None else f"{value * 100:.1f}%"


def _num(value: Any, digits: int = 1) -> str:
    if value is None:
        return "—"
    if isinstance(value, float):
        return f"{value:.{digits}f}"
    return str(value)


def _table(headers: list[str], rows: list[list[str]]) -> str:
    lines = ["| " + " | ".join(headers) + " |", "|" + "|".join("---" for _ in headers) + "|"]
    for row in rows:
        lines.append("| " + " | ".join(row) + " |")
    return "\n".join(lines)


def build_report(summary: dict[str, Any]) -> str:
    config = summary.get("config") or {}
    variants = summary.get("variants") or {}
    evidence = config.get("evidence_level", "unknown")
    backend = config.get("backend", "unknown")
    tasks = config.get("tasks") or []

    lines: list[str] = ["# Harness benchmark", ""]
    if evidence != "live":
        lines.extend(
            [
                "> **Validation level: mechanics (scripted policy).** The model here is a "
                "deterministic action fixture, not an LLM. These numbers prove the harness "
                "loop, graders, metrics, and artifact pipeline execute correctly. They do "
                "**not** measure model capability and must not be cited as live results.",
                "",
            ]
        )
    else:
        lines.extend(
            [
                "> **Validation level: live model.** Every number below comes from the "
                "configured model endpoint. One run per task is an observation, not a ranking; "
                "no significance test is implied.",
                "",
            ]
        )

    lines.extend(
        [
            "## Setup",
            "",
            f"- Experiment: `{summary.get('experiment_id', 'unknown')}`",
            f"- Backend: `{backend}`",
            f"- Evidence level: `{evidence}`",
            f"- Model: `{config.get('model', 'unknown')}`",
            f"- Tasks: {len(tasks)} — {', '.join(tasks)}",
            f"- Runs per task: {config.get('runs_per_task', 1)}",
            f"- Seed: {config.get('seed', 0)}",
            "",
            "## Results",
            "",
        ]
    )

    headers = [
        "Variant",
        "Runs",
        "Harness success",
        "Verified success",
        "Pass@1",
        "Retry recovery",
        "Regression",
        "False completion",
        "Tool error",
        "Steps",
        "Model calls",
        "Tokens",
        "Latency avg",
        "Context tokens avg",
    ]
    rows: list[list[str]] = []
    for name, data in variants.items():
        recovery = data.get("retry_recovery") or {}
        tokens = data.get("tokens") or {}
        latency = data.get("latency") or {}
        context = data.get("context") or {}
        rows.append(
            [
                f"`{name}`",
                str(data.get("runs", 0)),
                _pct(data.get("success_rate")),
                _pct(data.get("verified_success_rate")),
                _pct(data.get("pass_at_1")),
                _pct(recovery.get("rate")),
                _pct(data.get("regression_rate")),
                _pct(data.get("false_completion_rate")),
                _pct(data.get("tool_error_rate")),
                _num(data.get("avg_steps")),
                _num(data.get("avg_agent_calls")),
                _num(tokens.get("total")) if tokens.get("available") else "n/a*",
                f"{_num(latency.get('avg_ms'))} ms",
                _num(context.get("avg_tokens")),
            ]
        )
    lines.append(_table(headers, rows))
    lines.extend(
        [
            "",
            "`*` Token usage was not reported by the backend; it is shown as unavailable, "
            "not as zero.",
            "",
            "Metric definitions:",
            "",
            "- **Harness success** — final harness verdict (grader authority, or the claim "
            "grader in the no-verification variant).",
            "- **Verified success** — post-hoc task tests pass and protected paths are unchanged, "
            "regardless of what the harness accepted.",
            "- **Pass@1** — the first attempt of the first run of each task passed.",
            "- **Retry recovery** — among runs whose first attempt failed, the fraction that "
            "eventually passed.",
            "- **Regression** — a post-hoc failed test ID that was not failing at baseline.",
            "- **False completion** — the harness accepted the run but post-hoc verification failed.",
            "",
            "## Failure taxonomy",
            "",
        ]
    )

    taxonomy_rows: list[list[str]] = []
    for name, data in variants.items():
        counts = (data.get("failure_taxonomy") or {}).get("counts") or {}
        labels = (data.get("failure_taxonomy") or {}).get("labels") or {}
        if not counts:
            taxonomy_rows.append([f"`{name}`", "—", "—", "—"])
            continue
        for code, count in counts.items():
            taxonomy_rows.append([f"`{name}`", code, labels.get(code, ""), str(count)])
    lines.append(_table(["Variant", "Code", "Category", "Count"], taxonomy_rows))
    lines.extend(
        [
            "",
            "F1–F12 are the planned taxonomy; F13 (constraint violation) and I1 "
            "(infrastructure/provider) are explicit extensions for failures the original "
            "list did not name.",
            "",
            "## Per-task outcomes",
            "",
        ]
    )
    variant_names = list(variants.keys())
    task_rows: list[list[str]] = []
    per_task = summary.get("per_task") or {}
    for task in tasks:
        row = [f"`{task}`"]
        for name in variant_names:
            entry = (per_task.get(task) or {}).get(name) or {}
            harness = "PASS" if entry.get("success") else "fail"
            verified = "verified" if entry.get("verified_success") else "unverified"
            row.append(f"{harness} / {verified}")
        task_rows.append(row)
    lines.append(_table(["Task"] + [f"`{name}`" for name in variant_names], task_rows))

    lines.extend(["", "## Variant notes", ""])
    for name, data in variants.items():
        lines.append(f"- **`{name}`** — {data.get('description', '')}")

    limits = [
        "",
        "## Limits",
        "",
        "- This report is generated from recorded runs; inspect `raw_runs.jsonl` and each "
        "`runs/<run_id>/` directory for events, messages, patches, grades, and the native "
        "trace.",
        "- Post-hoc verification is not used by the no-verification variant's success "
        "decision; it exists to measure the gap.",
    ]
    if evidence == "live":
        limits.extend(
            [
                "- One run per cell at temperature 0 is an observation, not a ranking or a "
                "significance test.",
                "- Provider/network failures are classified I1 and are not model-quality "
                "failures.",
                "- Variant differences (reviewer, skill, retry) are not causal unless repeated "
                "runs show a consistent effect.",
                "- If the live model solves tasks even with verification disabled, false "
                "completion can be zero; use the scripted controlled experiment to validate "
                "that the grader catches false claims.",
            ]
        )
    else:
        limits.extend(
            [
                "- The scripted policy is an oracle, not a language model; it can validate the "
                "pipeline but not model planning, feedback use, or context behavior.",
                "- Live runs require an OpenAI-compatible endpoint and are labelled `live`.",
            ]
        )
    limits.append("")
    lines.extend(limits)
    return "\n".join(lines)
