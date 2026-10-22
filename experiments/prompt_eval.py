"""Prompt-optimization experiment runner.

Usage::

    python -m experiments.prompt_eval [--prompts default,structured,verify]
                                      [--tasks all] [--runs 1]

Runs every (prompt, task, run) combination through the shared core executor and
emits ``raw_runs.jsonl``, ``config.json``, ``summary.json``, ``summary.csv`` and
``report.md`` under a per-experiment output directory.
"""

from __future__ import annotations

import argparse
import csv
import json
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from agent_replay.config import get_settings
from agent_replay.core.executor import run_task
from agent_replay.core.prompts import PROMPT_NAMES, load_prompt_templates, render_prompt
from agent_replay.core.taskset import load_tasks

from .metrics import bootstrap_ci, latency_stats, pass_at_1, success_rate, token_stats
from .report import build_report


def _git_commit() -> str:
    try:
        result = subprocess.run(
            ["git", "rev-parse", "HEAD"], capture_output=True, text=True, timeout=10
        )
        return result.stdout.strip() or "unknown"
    except Exception:
        return "unknown"


def classify_failure(run: dict[str, Any]) -> str:
    term = (run.get("termination") or {}).get("kind")
    if term == "timeout":
        return "timeout"
    if term in ("provider_unavailable", "rate_limited", "permission_denied"):
        return "provider_unavailable"
    if run.get("tampered") or run.get("reason") == "tests_modified":
        return "tests_modified"
    verify = run.get("verify")
    if verify and verify.get("failed", 0) > 0:
        if not run.get("files_changed"):
            return "no_edit"
        return "tests_failed"
    if run.get("status") == "unknown":
        return "unknown"
    return "other"


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run the prompt-optimization experiment.")
    parser.add_argument("--prompts", default=",".join(PROMPT_NAMES))
    parser.add_argument("--tasks", default="all", help="comma-separated task ids, or 'all'")
    parser.add_argument("--runs", type=int, default=1)
    parser.add_argument("--model", default=None)
    parser.add_argument("--adapter", default=None)
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--out-dir", default=None)
    parser.add_argument("--timeout-ms", type=int, default=None)
    return parser.parse_args(argv)


def _summarize(config: dict[str, Any], runs: list[dict[str, Any]]) -> dict[str, Any]:
    per_prompt: dict[str, Any] = {}
    for name in config["prompts"]:
        subset = [r for r in runs if r["prompt_name"] == name]
        successes = [bool(r["success"]) for r in subset]
        failures: dict[str, int] = {}
        for r in subset:
            if not r["success"]:
                label = classify_failure(r)
                failures[label] = failures.get(label, 0) + 1
        per_prompt[name] = {
            "_name": name,
            "runs": len(subset),
            "tasks": len({r["task_id"] for r in subset}),
            "success_rate": success_rate(subset),
            "success_ci": list(bootstrap_ci(successes, seed=config["seed"]))
            if bootstrap_ci(successes, seed=config["seed"]) is not None
            else None,
            "pass_at_1": pass_at_1(subset),
            "latency": latency_stats([r["latency_ms"] for r in subset]),
            "tokens": token_stats(subset),
            "failure_counts": failures,
        }

    return {
        "experiment_id": config["experiment_id"],
        "config": config,
        "per_prompt": per_prompt,
        "totals": {
            "runs": len(runs),
            "tasks": len({r["task_id"] for r in runs}),
        },
    }


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    settings = get_settings()
    model = args.model or settings.model
    adapter = args.adapter or settings.adapter
    prompt_names = tuple(p.strip() for p in args.prompts.split(",") if p.strip())

    tasks = load_tasks(settings.tasks_dir)
    if args.tasks != "all":
        only = {t.strip() for t in args.tasks.split(",") if t.strip()}
        tasks = [t for t in tasks if t.id in only]
    prompts = load_prompt_templates(settings.prompts_dir, prompt_names)

    experiment_id = datetime.now(timezone.utc).strftime("exp-%Y%m%dT%H%M%SZ")
    out_dir = Path(args.out_dir) if args.out_dir else settings.results_dir / experiment_id
    out_dir.mkdir(parents=True, exist_ok=True)

    config: dict[str, Any] = {
        "experiment_id": experiment_id,
        "model": model,
        "adapter": adapter,
        "task_set": [t.id for t in tasks],
        "num_tasks": len(tasks),
        "runs": args.runs,
        "prompts": list(prompt_names),
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "commit": _git_commit(),
        "seed": args.seed,
    }

    raw_path = out_dir / "raw_runs.jsonl"
    runs: list[dict[str, Any]] = []
    total = len(prompt_names) * len(tasks) * args.runs
    done = 0

    try:
        for pname in prompt_names:
            template = prompts[pname]
            for task in tasks:
                for run_idx in range(1, args.runs + 1):
                    prompt = render_prompt(template, task.prompt)
                    run_id = f"{task.id}-{pname}-r{run_idx}"
                    outcome = run_task(
                        settings,
                        task,
                        run_id=run_id,
                        prompt=prompt,
                        prompt_name=pname,
                        adapter=adapter,
                        model=model,
                        timeout_ms=args.timeout_ms,
                    )
                    record = outcome.to_dict()
                    record["run"] = run_idx
                    runs.append(record)
                    with raw_path.open("a", encoding="utf-8") as handle:
                        handle.write(json.dumps(record, ensure_ascii=False) + "\n")
                    done += 1
                    print(
                        f"[{done}/{total}] {pname:10s} {task.id:16s} r{run_idx} "
                        f"{outcome.status:7s} {outcome.latency_ms}ms "
                        f"{outcome.verify['passed'] if outcome.verify else '-'}/"
                        f"{outcome.verify['total'] if outcome.verify else '-'}"
                    )
    except KeyboardInterrupt:
        print("\ninterrupted; writing partial results")

    summary = _summarize(config, runs)

    (out_dir / "config.json").write_text(
        json.dumps(config, indent=2), encoding="utf-8"
    )
    (out_dir / "summary.json").write_text(
        json.dumps(summary, indent=2), encoding="utf-8"
    )

    # summary.csv — one row per prompt
    with (out_dir / "summary.csv").open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(
            ["prompt", "runs", "success_rate", "pass_at_1", "avg_latency_ms",
             "median_latency_ms", "p95_latency_ms", "tokens_total", "tokens_available"]
        )
        for name, res in summary["per_prompt"].items():
            lat = res["latency"]
            tok = res["tokens"]
            writer.writerow(
                [
                    name,
                    res["runs"],
                    res["success_rate"],
                    res["pass_at_1"],
                    lat["avg_ms"],
                    lat["median_ms"],
                    lat["p95_ms"],
                    tok["total"],
                    tok["available"],
                ]
            )

    (out_dir / "report.md").write_text(build_report(summary), encoding="utf-8")

    print(f"\nresults written to {out_dir}")
    print(f"  raw_runs.jsonl  {len(runs)} runs")
    print(f"  summary.json / summary.csv / report.md")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
