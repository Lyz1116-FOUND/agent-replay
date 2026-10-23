"""Benchmark runner for harness configurations.

A variant changes harness policy (context, verification, reviewer, skills,
step/retry budget), not the task set. Every run is graded by the harness and
then re-checked post hoc with the same test command so false completion and
regressions remain measurable even when verification is disabled.
"""

from __future__ import annotations

import csv
import json
import shutil
import subprocess
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from ..agents.supervisor import Supervisor
from ..harness.config import HarnessConfig
from ..harness.grader import AgentClaimGrader, build_default_grader
from ..harness.loop import AgentHarness
from ..harness.model_client import ModelClient, ScriptedModel
from ..harness.scripted import noop_actions, oracle_actions
from ..harness.types import TaskSpec
from ..harness.workspace import TaskWorkspace
from ..tools.test_parsing import run_test_command
from .failure_taxonomy import classify_failure, failure_counts
from .metrics import summarize_records
from .report import build_report


@dataclass(frozen=True)
class Variant:
    name: str
    experiment: str
    description: str
    scripted_policy: str = "oracle"  # oracle | oracle_compact | noop | fail_first
    grader_mode: str = "composite"  # composite | claim
    context_strategy: str = "truncated"
    context_recent_turns: int = 4
    context_max_output: int | None = None
    use_skills: bool = False
    reviewer: bool = False
    max_steps: int = 12
    max_retries: int = 1
    max_rounds: int = 2


EXPERIMENT_VARIANTS: dict[str, list[Variant]] = {
    "1": [
        Variant(
            "harness",
            "1",
            "ReAct harness with tools, verification and one retry.",
        ),
        Variant(
            "single_shot",
            "1",
            "One model turn with the same tools, no observations or retries.",
            scripted_policy="oracle_compact",
            max_steps=1,
            max_retries=0,
        ),
    ],
    "2": [
        Variant(
            "no_verification",
            "2",
            "Accept the model's completion claim; no test or constraint grader.",
            scripted_policy="noop",
            grader_mode="claim",
            max_retries=0,
        ),
        Variant(
            "verified",
            "2",
            "Same model behavior, but tests and protected paths are graded.",
            scripted_policy="noop",
            max_retries=0,
        ),
    ],
    "3": [
        Variant(
            "context_full",
            "3",
            "Full history, including a large repository note observation.",
            scripted_policy="oracle_context",
            context_strategy="full",
            max_retries=0,
        ),
        Variant(
            "context_truncated",
            "3",
            "Full history with per-observation truncation (1.5k characters).",
            scripted_policy="oracle_context",
            context_strategy="truncated",
            context_max_output=1500,
            max_retries=0,
        ),
        Variant(
            "context_compressed",
            "3",
            "Extractive summary of old turns plus a two-turn recent window.",
            scripted_policy="oracle_context",
            context_strategy="compressed",
            context_recent_turns=2,
            context_max_output=1500,
            max_retries=0,
        ),
    ],
    "4": [
        Variant(
            "single_agent",
            "4",
            "Coder with harness verification and retry.",
            max_retries=1,
        ),
        Variant(
            "coder_reviewer",
            "4",
            "Coder plus an advisory reviewer; the grader still decides.",
            reviewer=True,
            max_rounds=2,
        ),
    ],
    "skills": [
        Variant(
            "no_skill",
            "skills",
            "No skill instructions in the system prompt.",
            max_retries=0,
        ),
        Variant(
            "with_skill",
            "skills",
            "Python test-debugging skill matched into the system prompt.",
            use_skills=True,
            max_retries=0,
        ),
    ],
    "retry": [
        Variant(
            "no_retry",
            "retry",
            "First completion claim fails verification; no retry budget.",
            scripted_policy="fail_first",
            max_retries=0,
        ),
        Variant(
            "retry_once",
            "retry",
            "First completion claim fails; grader feedback drives one retry.",
            scripted_policy="fail_first",
            max_retries=1,
        ),
    ],
}


def variants_for_experiments(experiments: list[str]) -> list[Variant]:
    variants: list[Variant] = []
    for experiment in experiments:
        if experiment not in EXPERIMENT_VARIANTS:
            raise ValueError(
                f"unknown experiment {experiment!r}; "
                f"choose from {', '.join(EXPERIMENT_VARIANTS)}"
            )
        variants.extend(EXPERIMENT_VARIANTS[experiment])
    return variants


def _scripted_model(task: TaskSpec, variant: Variant) -> ModelClient:
    if variant.scripted_policy == "oracle":
        return ScriptedModel(oracle_actions(task))
    if variant.scripted_policy == "oracle_compact":
        return ScriptedModel(oracle_actions(task, compact=True))
    if variant.scripted_policy == "oracle_context":
        from ..harness.scripted import oracle_context_actions

        return ScriptedModel(oracle_context_actions(task))
    if variant.scripted_policy == "noop":
        return ScriptedModel(noop_actions())
    if variant.scripted_policy == "fail_first":
        return ScriptedModel(oracle_actions(task, fail_first=True))
    raise ValueError(f"unknown scripted policy: {variant.scripted_policy}")


def _scripted_reviewer(variant: Variant) -> ModelClient:
    approval = json.dumps(
        {
            "approved": True,
            "issues": [],
            "feedback": "The patch is minimal and the tests pass.",
        }
    )
    return ScriptedModel([{"text": approval} for _ in range(max(variant.max_rounds, 1) + 1)])


def _baseline(task: TaskSpec, base_dir: Path, config: HarnessConfig) -> dict[str, Any]:
    destination = base_dir / f"{task.task_id}-{uuid.uuid4().hex[:6]}"
    destination.parent.mkdir(parents=True, exist_ok=True)
    workspace = TaskWorkspace.prepare(Path(task.repo_path), destination)
    try:
        report = run_test_command(
            task.test_command or "",
            str(workspace.root),
            timeout_seconds=config.tool_timeout_seconds,
        )
    finally:
        shutil.rmtree(destination, ignore_errors=True)
    return report.to_dict()


def _posthoc(workspace_dir: Path, task: TaskSpec, config: HarnessConfig) -> dict[str, Any]:
    workspace = TaskWorkspace(workspace_dir)
    # Git status can be clean after the agent commits rewritten tests. Compare
    # filesystem facts against the trusted task source before executing them.
    before = TaskWorkspace(Path(task.repo_path)).snapshot(task.protected_paths)
    modified = workspace.modified_since(before)
    report = None
    if not modified:
        report = run_test_command(
            task.test_command or "",
            str(workspace.root),
            timeout_seconds=config.tool_timeout_seconds,
        )
        modified = workspace.modified_since(before)
    protected_modified = bool(modified)
    status_output = "\n".join(modified)
    verified = report is not None and report.status == "pass" and not protected_modified
    return {
        "tests": report.to_dict() if report else None,
        "protected_modified": protected_modified,
        "protected_status": status_output[:2000],
        "verified_success": verified,
        "workspace_diff_status": workspace.git("status", "--porcelain").stdout.strip()[:2000],
    }


def _git_commit(repo_root: Path) -> str:
    try:
        result = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=str(repo_root),
            capture_output=True,
            text=True,
            timeout=10,
        )
        return result.stdout.strip() or "unknown"
    except Exception:
        return "unknown"


def _new_failed_tests(final: list[str], baseline: list[str]) -> list[str]:
    baseline_set = set(baseline)
    return [test for test in final if test not in baseline_set]


def run_benchmark(
    *,
    tasks: list[TaskSpec],
    variants: list[Variant],
    config: HarnessConfig,
    output_dir: Path,
    runs: int = 1,
    backend: str = "scripted",
    evidence_level: str = "mechanics",
    model_factory: Callable[[TaskSpec, Variant], ModelClient] | None = None,
    reviewer_model_factory: Callable[[TaskSpec, Variant], ModelClient | None] | None = None,
    progress: Callable[[str], None] | None = None,
    seed: int = 0,
) -> dict[str, Any]:
    if backend not in ("scripted", "openai"):
        raise ValueError(f"unknown benchmark backend: {backend}")
    if backend == "openai" and model_factory is None:
        raise ValueError("openai benchmark requires a live model_factory")
    expected_evidence = "mechanics" if backend == "scripted" else "live"
    if evidence_level != expected_evidence:
        raise ValueError(f"{backend} backend requires evidence_level={expected_evidence!r}")
    if runs < 1:
        raise ValueError("runs must be >= 1")
    output_dir = output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    runs_dir = output_dir / "runs"
    work_dir = output_dir / "work"
    baseline_dir = output_dir / "baseline"
    for directory in (runs_dir, work_dir, baseline_dir):
        directory.mkdir(parents=True, exist_ok=True)

    experiment_id = output_dir.name
    raw_path = output_dir / "raw_runs.jsonl"
    raw_path.write_text("", encoding="utf-8")
    records: list[dict[str, Any]] = []
    baselines: dict[str, dict[str, Any]] = {}

    if progress:
        progress(f"computing baseline tests for {len(tasks)} tasks")
    for task in tasks:
        baselines[task.task_id] = _baseline(task, baseline_dir, config)
    shutil.rmtree(baseline_dir, ignore_errors=True)

    run_config = config.with_overrides(
        runs_dir=runs_dir,
        work_dir=work_dir,
        model_backend=backend,
        evidence_level=evidence_level,
        keep_workspace=True,
    )
    benchmark_config = {
        "experiment_id": experiment_id,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "backend": backend,
        "evidence_level": evidence_level,
        "model": "scripted-fixture" if backend == "scripted" else config.model,
        "commit": _git_commit(config.repo_root),
        "tasks": [task.task_id for task in tasks],
        "variants": [
            {
                "name": variant.name,
                "experiment": variant.experiment,
                "description": variant.description,
                "scripted_policy": variant.scripted_policy if backend == "scripted" else None,
                "grader_mode": variant.grader_mode,
                "context_strategy": variant.context_strategy,
                "use_skills": variant.use_skills,
                "reviewer": variant.reviewer,
                "max_steps": variant.max_steps,
                "max_retries": variant.max_retries,
                "max_rounds": variant.max_rounds,
            }
            for variant in variants
        ],
        "runs_per_task": runs,
        "seed": seed,
        "baselines": baselines,
    }
    (output_dir / "config.json").write_text(
        json.dumps(benchmark_config, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )

    total = len(variants) * len(tasks) * runs
    done = 0
    for variant in variants:
        context_overrides: dict[str, Any] = {
            "context_strategy": variant.context_strategy,
            "context_recent_turns": variant.context_recent_turns,
        }
        if variant.context_max_output is not None:
            context_overrides["context_max_tool_output_chars"] = variant.context_max_output
        variant_config = run_config.with_overrides(
            **context_overrides,
            use_skills=variant.use_skills,
            reviewer=variant.reviewer,
            max_steps=variant.max_steps,
            max_retries=variant.max_retries,
            max_rounds=variant.max_rounds,
        )
        for task in tasks:
            baseline = baselines[task.task_id]
            for run_index in range(1, runs + 1):
                done += 1
                if progress:
                    progress(
                        f"[{done}/{total}] {variant.name:18s} {task.task_id:26s} r{run_index}"
                    )
                run_id = f"{variant.name}--{task.task_id}--r{run_index}--{uuid.uuid4().hex[:6]}"
                try:
                    model = (
                        model_factory(task, variant)
                        if model_factory is not None
                        else _scripted_model(task, variant)
                    )
                    reviewer_model = (
                        reviewer_model_factory(task, variant)
                        if reviewer_model_factory is not None
                        else (_scripted_reviewer(variant) if backend == "scripted" else None)
                    )
                    grader = (
                        AgentClaimGrader()
                        if variant.grader_mode == "claim"
                        else build_default_grader(
                            task,
                            timeout_seconds=min(
                                variant_config.tool_timeout_seconds, task.timeout_seconds
                            ),
                            max_patch_bytes=variant_config.max_patch_bytes,
                            verification="composite",
                        )
                    )
                    if variant.reviewer:
                        result = Supervisor(
                            task,
                            variant_config,
                            model=model,
                            reviewer_model=reviewer_model,
                            run_id=run_id,
                        ).run()
                    else:
                        result = AgentHarness(
                            task,
                            variant_config,
                            model=model,
                            grader=grader,
                            run_id=run_id,
                        ).run()
                    workspace_dir = Path(result.workspace_dir) if result.workspace_dir else None
                    if workspace_dir and workspace_dir.is_dir():
                        posthoc = _posthoc(workspace_dir, task, variant_config)
                    else:
                        posthoc = {
                            "tests": None,
                            "protected_modified": False,
                            "verified_success": False,
                            "error": "workspace_not_found",
                        }
                    record = result.to_dict()
                    final_failed = list((posthoc.get("tests") or {}).get("failed_tests") or [])
                    new_failures = _new_failed_tests(
                        final_failed, list(baseline.get("failed_tests") or [])
                    )
                    verified = bool(posthoc.get("verified_success"))
                    regression = bool(new_failures)
                    record.update(
                        {
                            "variant": variant.name,
                            "experiment": variant.experiment,
                            "run": run_index,
                            "backend": backend,
                            "evidence_level": evidence_level,
                            "expected_paths": list(task.expected_paths),
                            "task_kind": task.kind,
                            "task_tags": list(task.tags),
                            "baseline_failed_tests": list(baseline.get("failed_tests") or []),
                            "baseline_tests": baseline,
                            "posthoc": posthoc,
                            "new_failed_tests": new_failures,
                            "verified_success": verified,
                            "regression": regression,
                            "false_completion": bool(result.success) and not verified,
                            "false_failure": verified and not bool(result.success),
                        }
                    )
                    classification = classify_failure(record)
                    record["failure_category"] = (
                        classification["code"] if classification else None
                    )
                    if result.run_dir:
                        posthoc_path = Path(result.run_dir) / "posthoc.json"
                        try:
                            posthoc_path.write_text(
                                json.dumps(posthoc, indent=2, ensure_ascii=False),
                                encoding="utf-8",
                            )
                            result_path = Path(result.run_dir) / "result.json"
                            result_path.write_text(
                                json.dumps(record, indent=2, ensure_ascii=False, default=str),
                                encoding="utf-8",
                            )
                        except OSError:
                            pass
                    if workspace_dir:
                        shutil.rmtree(workspace_dir, ignore_errors=True)
                except Exception as exc:
                    record = {
                        "run_id": run_id,
                        "task_id": task.task_id,
                        "variant": variant.name,
                        "experiment": variant.experiment,
                        "run": run_index,
                        "status": "harness_error",
                        "success": False,
                        "verified_success": False,
                        "failure_reason": "benchmark_error",
                        "attempts": [],
                        "steps": 0,
                        "tool_calls": 0,
                        "tool_errors": 0,
                        "latency_ms": 0,
                        "context_tokens": 0,
                        "files_changed": [],
                        "usage": {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0, "reported": False},
                        "posthoc": None,
                        "baseline_failed_tests": list(baseline.get("failed_tests") or []),
                        "expected_paths": list(task.expected_paths),
                        "regression": False,
                        "false_completion": False,
                        "false_failure": False,
                        "error": f"{type(exc).__name__}: {exc}",
                        "diagnostics": {},
                        "metadata": {},
                    }
                    record["failure_category"] = "I1"
                records.append(record)
                with raw_path.open("a", encoding="utf-8") as handle:
                    handle.write(json.dumps(record, ensure_ascii=False, default=str) + "\n")

    shutil.rmtree(work_dir, ignore_errors=True)

    per_variant: dict[str, Any] = {}
    for variant in variants:
        subset = [record for record in records if record.get("variant") == variant.name]
        per_variant[variant.name] = {
            "experiment": variant.experiment,
            "description": variant.description,
            **summarize_records(subset, seed=seed),
            "failure_taxonomy": failure_counts(subset),
        }

    per_task: dict[str, dict[str, Any]] = {}
    for record in records:
        task_entry = per_task.setdefault(record["task_id"], {})
        task_entry[record["variant"]] = {
            "success": bool(record.get("success")),
            "verified_success": bool(record.get("verified_success")),
            "steps": int(record.get("steps", 0) or 0),
            "latency_ms": int(record.get("latency_ms", 0) or 0),
            "failure": (record.get("failure_reason") or None),
        }

    summary = {
        "experiment_id": experiment_id,
        "config": benchmark_config,
        "variants": per_variant,
        "per_task": per_task,
        "totals": {"runs": len(records), "tasks": len({record["task_id"] for record in records})},
    }

    (output_dir / "summary.json").write_text(
        json.dumps(summary, indent=2, ensure_ascii=False, default=str),
        encoding="utf-8",
    )

    with (output_dir / "summary.csv").open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(
            [
                "variant",
                "experiment",
                "runs",
                "success_rate",
                "verified_success_rate",
                "pass_at_1",
                "retry_recovery_rate",
                "regression_rate",
                "false_completion_rate",
                "tool_error_rate",
                "avg_steps",
                "avg_agent_calls",
                "avg_latency_ms",
                "context_tokens_avg",
                "tokens_total",
                "tokens_available",
            ]
        )
        for variant in variants:
            data = per_variant[variant.name]
            latency = data["latency"]
            writer.writerow(
                [
                    variant.name,
                    variant.experiment,
                    data["runs"],
                    data["success_rate"],
                    data["verified_success_rate"],
                    data["pass_at_1"],
                    data["retry_recovery"]["rate"],
                    data["regression_rate"],
                    data["false_completion_rate"],
                    data["tool_error_rate"],
                    data["avg_steps"],
                    data["avg_agent_calls"],
                    latency["avg_ms"],
                    data["context"]["avg_tokens"],
                    data["tokens"]["total"],
                    data["tokens"]["available"],
                ]
            )

    (output_dir / "report.md").write_text(
        build_report(summary), encoding="utf-8"
    )
    return summary
