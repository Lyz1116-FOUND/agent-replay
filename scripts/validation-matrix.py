#!/usr/bin/env python3
"""Validation matrix: tasks x agents x runs.

Each run gets a fresh git repo, a clean process, and the recorder's own trace.
The ledger records task outcome and availability outcome separately, because a
provider outage is not a failed task.

Usage:
    python3 scripts/validation-matrix.py --agents opencode --runs 3
    python3 scripts/validation-matrix.py --agents opencode,claude,zcode,qoder
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import signal
import subprocess
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
CLI = REPO / "dist-cli" / "agent-replay.mjs"
TASKS_DIR = REPO / "examples" / "tasks"
OUT_DIR = REPO / "examples" / "validation"
TRACE_DIR = OUT_DIR / "traces"
WORK_ROOT = Path("/private/tmp/ar-validation")
ISO_ROOT = Path("/private/tmp/ar-validation-iso")

OPENCODE_MODEL = "opencode/glm-5.3-flash-free"
ZCODE_MODEL = "bigmodel-standard-api-2/GLM-5.3-Flash"

AGENTS = {
    "opencode": {
        "adapter": "opencode",
        "provider": "opencode",
        "harness": "2.0.32",
        "isolate": True,
        "cmd": lambda prompt: [
            "opencode", "run", "--standalone", "--format", "json", "--auto",
            "--model", OPENCODE_MODEL, prompt,
        ],
        "env": {"PATH_PREFIX": os.path.expanduser("~/.opencode/bin")},
    },
    "claude": {
        "adapter": "claude",
        "provider": "anthropic",
        "harness": "2.1.304",
        "isolate": False,
        "cmd": lambda prompt: [
            "claude", "-p", "--output-format", "stream-json", "--verbose",
            "--permission-mode", "acceptEdits",
            "--allowedTools", "Read,Edit,Write,Bash(node --test)", prompt,
        ],
        "env": {},
    },
    "zcode": {
        "adapter": "zcode",
        "provider": "bigmodel-standard-api-2",
        "harness": "3.15.3-37",
        "isolate": False,
        "cmd": lambda prompt: [
            "zcode", "--json", "--no-color", "-p", prompt, "--model", ZCODE_MODEL,
        ],
        "env": {},
    },
    "qoder": {
        "adapter": "qoder",
        "provider": "qoder",
        "harness": "1.1.74",
        "isolate": False,
        "cmd": lambda prompt: [
            "qodercli", "-p", "-o", "stream-json", "-m", "DeepSeek-Flash",
            "--permission-mode", "accept_edits",
            "--allowed-tools", "Read,Edit,Write,Bash(node --test)", prompt,
        ],
        "env": {},
    },
}


def load_tasks(names: list[str]) -> list[dict]:
    tasks = []
    for path in sorted(TASKS_DIR.iterdir()):
        if not path.is_dir() or not (path / "task.json").exists():
            continue
        meta = json.loads((path / "task.json").read_text())
        if names and meta["id"] not in names:
            continue
        meta["dir"] = path
        tasks.append(meta)
    return tasks


def build_env(agent: dict, repo: Path) -> dict:
    env = os.environ.copy()
    prefix = agent["env"].get("PATH_PREFIX")
    if prefix:
        env["PATH"] = prefix + ":" + env.get("PATH", "")
    env["PWD"] = str(repo)
    env["FORCE_COLOR"] = "0"
    # Codex needs an explicit proxy on this host; harmless for the others.
    if os.environ.get("AGENT_MATRIX_PROXY"):
        proxy = os.environ["AGENT_MATRIX_PROXY"]
        env["HTTPS_PROXY"] = env["HTTP_PROXY"] = env["ALL_PROXY"] = proxy
    if agent["isolate"]:
        for key, sub in (
            ("XDG_DATA_HOME", "data"),
            ("XDG_CONFIG_HOME", "config"),
            ("XDG_STATE_HOME", "state"),
            ("XDG_CACHE_HOME", "cache"),
        ):
            target = ISO_ROOT / repo.name / sub
            target.mkdir(parents=True, exist_ok=True)
            env[key] = str(target)
    return env


def prepare_repo(task: dict, agent_name: str, run: int) -> Path:
    repo = WORK_ROOT / f"{task['id']}--{agent_name}--{run}"
    shutil.rmtree(repo, ignore_errors=True)
    # task.json is harness metadata, not part of the task; never leak it.
    shutil.copytree(task["dir"], repo, ignore=shutil.ignore_patterns("task.json"))
    for cmd in (
        ["git", "init", "-q"],
        ["git", "config", "user.email", "dev@example.com"],
        ["git", "config", "user.name", "Dev"],
        ["git", "add", "."],
        ["git", "commit", "-qm", "initial"],
    ):
        subprocess.run(cmd, cwd=repo, check=True, capture_output=True)
    return repo


def run_once(task: dict, agent_name: str, run: int, timeout: int) -> dict:
    agent = AGENTS[agent_name]
    repo = prepare_repo(task, agent_name, run)
    name = f"{task['id']}-{agent_name}-{run}"
    cmd = [
        "node", str(CLI), "record",
        "--adapter", agent["adapter"],
        "--name", name,
        "--provider", agent["provider"],
        "--harness-version", agent["harness"],
        "--isolation", "xdg" if agent["isolate"] else "none",
        "--",
        *agent["cmd"](task["prompt"]),
    ]
    started = time.time()
    proc = subprocess.Popen(
        cmd, cwd=repo, env=build_env(agent, repo),
        stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        text=True, start_new_session=True,
    )
    timed_out = False
    try:
        stdout, stderr = proc.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        timed_out = True
        try:
            os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
        except Exception:
            pass
        try:
            stdout, stderr = proc.communicate(timeout=10)
        except Exception:
            stdout, stderr = "", ""
    elapsed = round(time.time() - started, 1)

    record = {
        "task": task["id"],
        "task_kind": task["kind"],
        "agent": agent_name,
        "run": run,
        "timed_out": timed_out,
        "elapsed_s": elapsed,
        "exit": proc.returncode,
        "status": None,
        "termination": None,
        "tests": None,
        "integrity": None,
        "files_changed": None,
        "expected_files": task["expectedFiles"],
        "recovery": None,
        "fidelity": None,
        "trace": None,
        "log_tail": (stdout + "\n" + stderr)[-800:] if timed_out else "",
    }

    traces = sorted((repo / "replays").glob("*.trace.json"))
    if traces:
        trace = json.loads(traces[0].read_text())
        capture = trace.get("capture") or {}
        record.update(
            status=trace.get("status"),
            termination=trace.get("termination"),
            tests=(trace.get("result") or {}).get("tests"),
            integrity=capture.get("integrity"),
            files_changed=(trace.get("result") or {}).get("filesChanged"),
            recovery=(trace.get("metadata") or {}).get("recoveryDetected"),
            fidelity=capture.get("fidelity"),
        )
        TRACE_DIR.mkdir(parents=True, exist_ok=True)
        dest = TRACE_DIR / f"{name}.trace.json"
        shutil.copyfile(traces[0], dest)
        record["trace"] = str(dest.relative_to(REPO))

    shutil.rmtree(repo, ignore_errors=True)
    return record


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--agents", default="opencode")
    parser.add_argument("--tasks", default="")
    parser.add_argument("--runs", type=int, default=3)
    parser.add_argument("--timeout", type=int, default=240)
    args = parser.parse_args()

    agents = [a.strip() for a in args.agents.split(",") if a.strip()]
    unknown = [a for a in agents if a not in AGENTS]
    if unknown:
        print(f"unknown agents: {unknown}", file=sys.stderr)
        return 2
    tasks = load_tasks([t.strip() for t in args.tasks.split(",") if t.strip()])
    if not tasks:
        print("no tasks found", file=sys.stderr)
        return 2

    WORK_ROOT.mkdir(parents=True, exist_ok=True)
    TRACE_DIR.mkdir(parents=True, exist_ok=True)
    ledger = OUT_DIR / "runs.jsonl"
    ledger.write_text("")

    results = []
    for task in tasks:
        for agent_name in agents:
            for run in range(1, args.runs + 1):
                record = run_once(task, agent_name, run, args.timeout)
                results.append(record)
                with ledger.open("a") as fh:
                    fh.write(json.dumps(record, ensure_ascii=False) + "\n")
                tests = record["tests"] or {}
                integ = record["integrity"] or {}
                term = (record["termination"] or {}).get("kind")
                print(
                    f"{task['id']:16} {agent_name:9} run{run} "
                    f"{str(record['status']):8} {record['elapsed_s']:6.1f}s "
                    f"term={str(term):22} tests={tests.get('passed')}/{tests.get('total')} "
                    f"recall={integ.get('confirmedEdits', integ.get('matchedEdits'))}/{integ.get('nativeEdits')}",
                    flush=True,
                )

    unavailable = {"provider_unavailable", "rate_limited", "permission_denied", "recorder_error"}
    summary = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "runs": len(results),
        "tasks": sorted({r["task"] for r in results}),
        "agents": agents,
        "per_agent": {},
    }
    for agent_name in agents:
        rows = [r for r in results if r["agent"] == agent_name]
        attempted = [r for r in rows if (r["termination"] or {}).get("kind") not in unavailable]
        passed = [r for r in attempted if r["status"] == "pass"]
        verified = sum(
            (r["integrity"] or {}).get("confirmedEdits")
            or (r["integrity"] or {}).get("matchedEdits", 0)
            for r in rows
        )
        native = sum((r["integrity"] or {}).get("nativeEdits", 0) for r in rows)
        summary["per_agent"][agent_name] = {
            "runs": len(rows),
            "attempted": len(attempted),
            "passed": len(passed),
            "unavailable": len(rows) - len(attempted),
            "pass_rate": round(len(passed) / len(attempted), 3) if attempted else None,
            "edit_recall": round(verified / native, 3) if native else None,
            "median_elapsed_s": sorted(r["elapsed_s"] for r in rows)[len(rows) // 2] if rows else None,
        }

    (OUT_DIR / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    print(json.dumps(summary["per_agent"], indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
