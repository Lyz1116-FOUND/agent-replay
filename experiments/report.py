"""Generate the Markdown experiment report from a summary dict.

The report is data-driven: it states the setup, a per-prompt results table,
observed failure categories, and a conclusion that only reflects the measured
numbers (no preset "Prompt C is best" narrative).
"""

from __future__ import annotations

from typing import Any

_FAILURE_LABELS = {
    "timeout": "Execution timeout",
    "provider_unavailable": "Provider unavailable / rate limited",
    "tests_modified": "Rewrote the test files",
    "no_edit": "Made no change (misunderstood the task)",
    "tests_failed": "Tests still failing after the edit",
    "unknown": "No test verdict produced",
    "other": "Other",
}


def _fmt_rate(value: float | None) -> str:
    return f"{value:.1%}" if value is not None else "n/a"


def _fmt_tokens(tokens: dict[str, Any]) -> str:
    if not tokens.get("available"):
        return "unavailable"
    return f"{tokens['total']}"


def _conclusion(summary: dict[str, Any]) -> list[str]:
    per = summary["per_prompt"]
    ranked = sorted(
        per.items(),
        key=lambda kv: kv[1]["success_rate"] if kv[1]["success_rate"] is not None else -1,
        reverse=True,
    )
    lines = []
    if not ranked:
        lines.append("No runs were completed, so no conclusion can be drawn.")
        return lines

    best_name, best = ranked[0]
    best_sr = best["success_rate"]
    others = [v["success_rate"] for _, v in ranked[1:] if v["success_rate"] is not None]

    if best_sr is None:
        lines.append("No prompt produced a measurable success rate.")
        return lines

    lines.append(
        f"The highest success rate was `{best_name}` at {_fmt_rate(best_sr)}."
    )
    if others:
        gap = best_sr - max(others)
        if gap > 0.2:
            lines.append(
                "The gap to the next prompt is substantial, but the sample size "
                "is small, so this is an observation rather than a ranking."
            )
        else:
            lines.append(
                "The differences between prompts are small relative to the "
                "sample size; they may not be stable across more runs."
            )

    # Latency and token notes.
    slowest = max(per.values(), key=lambda v: v["latency"].get("avg_ms") or 0)
    fastest = min(per.values(), key=lambda v: v["latency"].get("avg_ms") or 0)
    if fastest is not slowest and fastest["latency"].get("count"):
        lines.append(
            f"`{fastest.get('_name')}` had the lowest average latency "
            f"({fastest['latency']['avg_ms']} ms) and `{slowest.get('_name')}` the highest "
            f"({slowest['latency']['avg_ms']} ms)."
        )

    lines.append(
        "These results reflect this fixed task set and this model only; they do "
        "not generalise to other tasks or models."
    )
    return lines


def build_report(summary: dict[str, Any]) -> str:
    cfg = summary["config"]
    per = summary["per_prompt"]

    lines: list[str] = []
    lines.append("# Prompt Evaluation Report")
    lines.append("")
    lines.append("## Setup")
    lines.append("")
    lines.append(f"- Model: `{cfg['model']}`")
    lines.append(f"- Adapter: `{cfg['adapter']}`")
    lines.append(f"- Task set: {', '.join(cfg['task_set'])}")
    lines.append(f"- Number of tasks: {cfg['num_tasks']}")
    lines.append(f"- Runs per (prompt, task): {cfg['runs']}")
    lines.append(f"- Experiment date: {cfg['timestamp']}")
    lines.append(f"- Commit: `{cfg['commit']}`")
    lines.append(f"- Seed: {cfg['seed']}")
    lines.append("")
    lines.append(
        "> Success is the trusted verdict from running the task's own verify "
        "command in the final worktree; Pass@1 equals Success Rate when each "
        "task runs exactly once."
    )
    lines.append("")

    lines.append("## Results")
    lines.append("")
    lines.append("| Prompt | Success Rate | Pass@1 | Avg Latency (ms) | Median Latency (ms) | Tokens |")
    lines.append("|---|---|---|---|---|---|")
    for name, res in per.items():
        lat = res["latency"]
        lines.append(
            f"| {name} | {_fmt_rate(res['success_rate'])} | {_fmt_rate(res['pass_at_1'])} "
            f"| {lat['avg_ms'] if lat['avg_ms'] is not None else 'n/a'} "
            f"| {lat['median_ms'] if lat['median_ms'] is not None else 'n/a'} "
            f"| {_fmt_tokens(res['tokens'])} |"
        )
    lines.append("")

    lines.append("## Failure Analysis")
    lines.append("")
    for name, res in per.items():
        failures = res.get("failure_counts") or {}
        if not failures:
            lines.append(f"- `{name}`: no failures recorded.")
            continue
        detail = ", ".join(f"{label}: {count}" for label, count in sorted(failures.items(), key=lambda kv: -kv[1]))
        lines.append(f"- `{name}`: {detail}.")
    lines.append("")

    lines.append("## Conclusion")
    lines.append("")
    lines.extend(_conclusion(summary))
    lines.append("")

    return "\n".join(lines)
