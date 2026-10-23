"""Run the harness experiments.

Examples::

    # Mechanics validation: deterministic scripted policies, NOT model evidence
    python -m experiments.harness_eval --backend scripted --experiments all

    # Live model: requires an OpenAI-compatible endpoint
    AGENT_REPLAY_MODEL_BASE_URL=... AGENT_REPLAY_MODEL_API_KEY=... \
      python -m experiments.harness_eval --backend openai --model <model> --experiments 1,2,3,4

Experiment groups:

1. Harness vs single-shot tool turn
2. No verification vs verified (same model behavior)
3. Full vs truncated vs compressed context
4. Single agent vs coder + reviewer
skills. No skill vs matched skill
retry. No retry vs one grader-driven retry
"""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
from pathlib import Path

from agent_replay.config import REPO_ROOT
from agent_replay.evaluation.benchmark import variants_for_experiments
from agent_replay.evaluation.benchmark import run_benchmark
from agent_replay.harness.config import HarnessConfig
from agent_replay.harness.model_client import model_from_config
from agent_replay.harness.tasks import load_tasks

GROUPS = ["1", "2", "3", "4", "skills", "retry"]


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run harness benchmark experiments.")
    parser.add_argument("--experiments", default="all")
    parser.add_argument("--tasks", default="all", help="comma-separated ids, or 'all'")
    parser.add_argument("--runs", type=int, default=1)
    parser.add_argument("--backend", choices=("scripted", "openai"), default="openai")
    parser.add_argument("--model", default=None)
    parser.add_argument("--base-url", default=None)
    parser.add_argument("--api-key-env", default=None)
    parser.add_argument("--out-dir", default=None)
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--timeout", type=int, default=None)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    base = HarnessConfig.from_env()
    config = base.with_overrides(
        model=args.model or base.model,
        model_base_url=args.base_url or base.model_base_url,
        model_api_key_env=args.api_key_env or base.model_api_key_env,
        timeout_seconds=args.timeout or base.timeout_seconds,
    )
    if args.experiments == "all":
        experiments = list(GROUPS)
    else:
        experiments = [item.strip() for item in args.experiments.split(",") if item.strip()]
    variants = variants_for_experiments(experiments)

    tasks = load_tasks(config.tasks_dir)
    if args.tasks != "all":
        only = [item.strip() for item in args.tasks.split(",") if item.strip()]
        tasks = load_tasks(config.tasks_dir, only=only)
    if not tasks:
        print(f"no tasks found in {config.tasks_dir}")
        return 1

    if args.backend == "openai" and not config.model_base_url:
        print(
            "openai backend needs a base URL. Set AGENT_REPLAY_MODEL_BASE_URL or pass --base-url.\n"
            "For a reproducible mechanics check without a model, use --backend scripted."
        )
        return 2

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out_dir = (
        Path(args.out_dir)
        if args.out_dir
        else (REPO_ROOT / "results" / "harness-bench" / f"exp-{stamp}")
    )
    out_dir.mkdir(parents=True, exist_ok=True)

    print(
        f"experiment groups: {', '.join(experiments)} | tasks: {len(tasks)} | "
        f"variants: {len(variants)} | backend: {args.backend}"
    )
    if args.backend == "scripted":
        print(
            "NOTE: scripted backend = harness mechanics validation, not LLM capability. "
            "It uses the task reference fixes as an oracle policy."
        )

    model_factory = None
    if args.backend == "openai":
        def model_factory(task, variant):  # type: ignore[misc]
            return model_from_config(config, model=config.model)

    progress = lambda message: print(message, flush=True)  # noqa: E731
    try:
        summary = run_benchmark(
            tasks=tasks,
            variants=variants,
            config=config,
            output_dir=out_dir,
            runs=args.runs,
            backend=args.backend,
            evidence_level="mechanics" if args.backend == "scripted" else "live",
            model_factory=model_factory,
            progress=progress,
            seed=args.seed,
        )
    except KeyboardInterrupt:
        print("\ninterrupted; partial raw runs were written")
        return 130

    print("\nsummary")
    for name, data in summary["variants"].items():
        success = data["success_rate"]
        verified = data["verified_success_rate"]
        print(
            f"  {name:20s} harness={success if success is not None else '—'} "
            f"verified={verified if verified is not None else '—'} "
            f"runs={data['runs']}"
        )
    print(f"\nartifacts: {out_dir}")
    print(f"  raw_runs.jsonl\n  summary.json / summary.csv\n  report.md")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
