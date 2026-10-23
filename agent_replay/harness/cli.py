"""Command-line entry point for the coding harness.

    python -m agent_replay.harness run task_001_add_bug --backend scripted
    python -m agent_replay.harness list
    python -m agent_replay.harness validate-tasks
    python -m agent_replay.harness benchmark --backend scripted --experiments all
"""

from __future__ import annotations

import argparse
import json
import shlex
from pathlib import Path
from typing import Any

from ..agents.a2a import MessageBus
from ..agents.reviewer import ReviewerAgent
from ..evaluation.benchmark import run_benchmark, variants_for_experiments
from ..mcp.client import StdioMCPClient
from ..mcp.adapter import load_mcp_tools
from .config import HarnessConfig
from .events import utc_now
from .loop import AgentHarness
from .model_client import ModelClient, ScriptedModel, model_from_config
from .scripted import noop_actions, oracle_actions
from .tasks import load_tasks, validate_task
from .types import TaskSpec


def _compact(value: Any, limit: int = 120) -> str:
    text = json.dumps(value, ensure_ascii=False, default=str)
    return text if len(text) <= limit else text[: limit - 3] + "..."


def _print_event(event: dict[str, Any]) -> None:
    kind = event.get("type")
    step = event.get("step")
    if kind == "model_called":
        print(
            f"[{step}] model  ({event.get('tool_calls', 0)} tool call(s), "
            f"ctx≈{event.get('context_tokens', 0)} tokens)"
        )
    elif kind == "tool_called":
        print(f"    -> {event.get('tool')}({_compact(event.get('arguments', {}))})")
    elif kind == "tool_returned":
        state = "ok" if event.get("success") else "error"
        print(f"    <- {event.get('tool')} {state} ({event.get('duration_ms')} ms)")
        if event.get("error"):
            print(f"       {str(event['error'])[:160]}")
    elif kind == "file_changed":
        print(f"    * changed {event.get('path')}")
    elif kind == "test_finished":
        print(
            f"    [test:{event.get('stage', 'agent')}] "
            f"{event.get('passed', 0)} passed, {event.get('failed', 0)} failed "
            f"(exit {event.get('exit_code')})"
        )
    elif kind == "grader_finished":
        verdict = "PASS" if event.get("passed") else "FAIL"
        print(f"[grader] {verdict} — {str(event.get('feedback', '')).splitlines()[0] if event.get('feedback') else ''}")
    elif kind == "reviewer_called":
        print(f"[reviewer] approved={event.get('approved')} issues={event.get('issues')}")
    elif kind == "retry":
        print(f"[retry] attempt {event.get('attempt')}")
    elif kind == "skill_loaded":
        print(f"[skill] {event.get('skill')}")
    elif kind == "mcp_server_started":
        print(f"[mcp] {event.get('server')}")
    elif kind == "harness_error":
        print(f"[harness error] {event.get('error')}")
    elif kind == "stuck_loop_detected":
        print(f"[loop] repeated {event.get('tool')} — stopping attempt")


def _base_config(args: argparse.Namespace) -> HarnessConfig:
    base = HarnessConfig.from_env()
    overrides: dict[str, Any] = {
        "model_backend": args.backend,
        "evidence_level": "mechanics" if args.backend == "scripted" else "live",
        "context_strategy": args.context,
        "max_steps": args.max_steps,
        "max_retries": args.max_retries,
        "timeout_seconds": args.timeout,
        "tool_timeout_seconds": args.tool_timeout,
        "use_skills": args.skills,
        "reviewer": args.reviewer,
        "max_rounds": args.max_rounds,
        "keep_workspace": not args.cleanup,
    }
    if args.model:
        overrides["model"] = args.model
    if args.base_url:
        overrides["model_base_url"] = args.base_url
    if args.api_key_env:
        overrides["model_api_key_env"] = args.api_key_env
    if args.runs_dir:
        overrides["runs_dir"] = Path(args.runs_dir).resolve()
    if args.work_dir:
        overrides["work_dir"] = Path(args.work_dir).resolve()
    if getattr(args, "tasks_dir", None):
        overrides["tasks_dir"] = Path(args.tasks_dir).resolve()
    if getattr(args, "memory", None):
        overrides["memory_path"] = Path(args.memory).resolve()
    return base.with_overrides(**overrides)


def _scripted_model(task: TaskSpec, policy: str) -> ModelClient:
    if policy == "oracle":
        return ScriptedModel(oracle_actions(task))
    if policy == "noop":
        return ScriptedModel(noop_actions())
    if policy == "fail_first":
        return ScriptedModel(oracle_actions(task, fail_first=True))
    raise ValueError(f"unknown scripted policy: {policy}")


def _reviewer_model(
    args: argparse.Namespace, config: HarnessConfig, task: TaskSpec
) -> ModelClient:
    if args.backend == "scripted":
        approval = json.dumps(
            {"approved": True, "issues": [], "feedback": "The patch is minimal and tests pass."}
        )
        return ScriptedModel([{"text": approval} for _ in range(max(args.max_rounds, 1) + 1)])
    return _openai_model(args, config)


def _openai_model(args: argparse.Namespace, config: HarnessConfig) -> ModelClient:
    if not config.model_base_url:
        raise SystemExit(
            "openai backend needs a base URL: set AGENT_REPLAY_MODEL_BASE_URL or pass --base-url"
        )
    return model_from_config(config, model=config.model)


def command_run(args: argparse.Namespace) -> int:
    config = _base_config(args)
    tasks = load_tasks(config.tasks_dir, only=[args.task_id])
    if not tasks:
        available = ", ".join(task.task_id for task in load_tasks(config.tasks_dir))
        print(f"unknown task {args.task_id!r}. Available: {available}")
        return 2
    task = tasks[0]

    if args.backend == "scripted":
        print(
            "NOTE: scripted backend uses the fixture reference as an oracle policy. "
            "This demonstrates harness mechanics, not model capability."
        )
        model: ModelClient = _scripted_model(task, args.scripted_policy)
    else:
        model = _openai_model(args, config)

    reviewer = None
    if args.reviewer:
        reviewer = ReviewerAgent(_reviewer_model(args, config, task))

    mcp_client: StdioMCPClient | None = None
    tool_factory = None
    if args.mcp_command:
        mcp_client = StdioMCPClient(shlex.split(args.mcp_command))
        def tool_factory(workspace):  # type: ignore[misc]
            return load_mcp_tools(mcp_client, server="local")

    print(f"Task: {task.title}")
    bus = MessageBus()
    try:
        result = AgentHarness(
            task,
            config,
            model=model,
            reviewer=reviewer,
            tool_factory=tool_factory,
            listener=_print_event,
            on_agent_message=bus.record,
            run_id=args.run_id,
        ).run()
    finally:
        if mcp_client is not None:
            mcp_client.close()

    usage = result.usage
    tokens = f"{usage.total} (reported)" if usage.reported else "unavailable (backend did not report usage)"
    print()
    print("PASS" if result.success else f"FAIL ({result.failure_reason})")
    print(f"steps: {result.steps}")
    print(f"tool_calls: {result.tool_calls}")
    print(f"tokens: {tokens}")
    print(f"latency: {result.latency_ms / 1000:.1f}s")
    print(f"retries: {result.retries}")
    print(f"result: {'PASS' if result.success else 'FAIL'}")
    print(f"artifacts: {result.run_dir}")
    if result.trace_path:
        print(f"trace: {result.trace_path}")
    return 0 if result.success else 1


def command_list(args: argparse.Namespace) -> int:
    config = _base_config(args)
    tasks = load_tasks(config.tasks_dir)
    if not tasks:
        print(f"no tasks in {config.tasks_dir}")
        return 1
    for task in tasks:
        print(f"{task.task_id:26} {task.kind:8} {task.title}")
    return 0


def command_validate(args: argparse.Namespace) -> int:
    config = _base_config(args)
    tasks = load_tasks(
        config.tasks_dir,
        only=[item.strip() for item in args.tasks.split(",")] if args.tasks != "all" else None,
    )
    failures = 0
    for task in tasks:
        result = validate_task(task)
        baseline = result["baseline"]
        reference = result["reference"]
        status = "valid" if result["valid"] else "INVALID"
        if not result["valid"]:
            failures += 1
        print(
            f"{task.task_id:26} {status:8} baseline={baseline['status']} "
            f"({baseline['passed']}/{baseline['failed']}) reference={reference['status']} "
            f"({reference['passed']}/{reference['failed']})"
        )
    return 0 if failures == 0 else 1


def command_benchmark(args: argparse.Namespace) -> int:
    config = _base_config(args)
    experiments = (
        ["1", "2", "3", "4", "skills", "retry"]
        if args.experiments == "all"
        else [item.strip() for item in args.experiments.split(",") if item.strip()]
    )
    variants = variants_for_experiments(experiments)
    tasks = load_tasks(
        config.tasks_dir,
        only=[item.strip() for item in args.tasks.split(",")] if args.tasks != "all" else None,
    )
    if not tasks:
        print(f"no tasks in {config.tasks_dir}")
        return 1
    if args.backend == "openai" and not config.model_base_url:
        print("openai backend needs AGENT_REPLAY_MODEL_BASE_URL or --base-url")
        return 2
    if args.backend == "scripted":
        print(
            "NOTE: scripted benchmark = harness mechanics validation, not model capability."
        )
    stamp = utc_now().replace(":", "").replace("-", "")[:15]
    out_dir = Path(args.out_dir) if args.out_dir else config.repo_root / "results" / "harness-bench" / f"exp-{stamp}"
    model_factory = None
    if args.backend == "openai":
        def model_factory(task, variant):  # type: ignore[misc]
            return _openai_model(args, config)

    summary = run_benchmark(
        tasks=tasks,
        variants=variants,
        config=config,
        output_dir=out_dir,
        runs=args.runs,
        backend=args.backend,
        evidence_level="mechanics" if args.backend == "scripted" else "live",
        model_factory=model_factory,
        progress=print,
        seed=args.seed,
    )
    for name, data in summary["variants"].items():
        print(f"{name:20s} harness={data['success_rate']} verified={data['verified_success_rate']}")
    print(f"artifacts: {out_dir}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="agent-replay-harness", description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    def common(p: argparse.ArgumentParser) -> None:
        p.add_argument("--tasks-dir", default=None)
        p.add_argument("--backend", choices=("scripted", "openai"), default="openai")
        p.add_argument("--model", default=None)
        p.add_argument("--base-url", default=None)
        p.add_argument("--api-key-env", default=None)
        p.add_argument("--context", choices=("full", "truncated", "compressed"), default="truncated")
        p.add_argument("--max-steps", type=int, default=12)
        p.add_argument("--max-retries", type=int, default=1)
        p.add_argument("--max-rounds", type=int, default=2)
        p.add_argument("--timeout", type=int, default=300)
        p.add_argument("--tool-timeout", type=int, default=120)
        p.add_argument("--skills", action="store_true")
        p.add_argument("--reviewer", action="store_true")
        p.add_argument("--cleanup", action="store_true", help="remove the workspace after the run")
        p.add_argument("--runs-dir", default=None)
        p.add_argument("--work-dir", default=None)

    run = sub.add_parser("run", help="run one task")
    run.add_argument("task_id")
    run.add_argument("--scripted-policy", choices=("oracle", "noop", "fail_first"), default="oracle")
    run.add_argument("--mcp-command", default=None)
    run.add_argument("--run-id", default=None)
    run.add_argument("--memory", default=None, help="optional JSON memory file")
    common(run)
    run.set_defaults(func=command_run)

    listing = sub.add_parser("list", help="list fixed tasks")
    common(listing)
    listing.set_defaults(func=command_list)

    validate = sub.add_parser("validate-tasks", help="prove baseline fails and reference passes")
    validate.add_argument("--tasks", default="all")
    common(validate)
    validate.set_defaults(func=command_validate)

    benchmark = sub.add_parser("benchmark", help="run experiment variants")
    benchmark.add_argument("--experiments", default="all")
    benchmark.add_argument("--tasks", default="all")
    benchmark.add_argument("--runs", type=int, default=1)
    benchmark.add_argument("--seed", type=int, default=0)
    benchmark.add_argument("--out-dir", default=None)
    common(benchmark)
    benchmark.set_defaults(func=command_benchmark)
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return int(args.func(args))


if __name__ == "__main__":
    raise SystemExit(main())
