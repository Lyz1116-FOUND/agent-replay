"""Core execution and evaluation.

Reuses the Node recorder (``dist-cli/agent-replay.mjs``) to run an agent and
mirrors the trusted-verify semantics from ``cli/validation/harness.ts`` to
judge the result. The API layer and the experiment harness both call
:func:`run_task`; neither reimplements agent execution.

Trusted-verify semantics (unchanged from the CLI):
  * The verdict is produced by running the task's own ``verify`` command in the
    final worktree, never by trusting the agent's self-reported result.
  * Protected files (e.g. ``test.mjs``) are hashed before and after; a run that
    rewrote them is ``tests_modified`` and fails regardless of the test output.
"""

from __future__ import annotations

import hashlib
import json
import re
import shutil
import subprocess
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

# --- Test output parsing (mirrors cli/lib/testParser.ts) --------------------

_ANSI_PATTERN = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")


def strip_ansi(text: str) -> str:
    return _ANSI_PATTERN.sub("", text)


@dataclass(frozen=True)
class VerifyResult:
    command: str
    exit_code: Optional[int]
    passed: int
    failed: int
    total: int


def parse_test_output(raw_text: str) -> VerifyResult | None:
    """Parse a test-run summary into (passed, failed, total).

    Mirrors the candidate collection in ``testParser.ts``: pytest, jest,
    cargo, mocha, node:test (TAP) and phpunit summaries are recognised. The
    candidate with the latest position and most information wins.
    """
    text = strip_ansi(raw_text)
    # (end, passed, failed)
    candidates: list[tuple[int, int, int]] = []

    for m in re.finditer(r"(\d+)\s+failed,\s*(\d+)\s+passed", text, re.I):
        candidates.append((m.end(), int(m.group(2)), int(m.group(1))))
    for m in re.finditer(r"(\d+)\s+passed,\s*(\d+)\s+failed", text, re.I):
        candidates.append((m.end(), int(m.group(1)), int(m.group(2))))
    for m in re.finditer(r"(\d+)\s+passed\s+in\s+[\d.]+s", text, re.I):
        candidates.append((m.end(), int(m.group(1)), 0))
    for m in re.finditer(r"(\d+)\s+failed\s+in\s+[\d.]+s", text, re.I):
        candidates.append((m.end(), 0, int(m.group(1))))

    for m in re.finditer(
        r"Tests:\s+(?:(\d+)\s+failed,\s*)?(?:(\d+)\s+skipped,\s*)?(?:(\d+)\s+passed,\s*)?(\d+)\s+total",
        text,
        re.I,
    ):
        failed = int(m.group(1) or 0)
        skipped = int(m.group(2) or 0)
        total = int(m.group(4))
        passed = int(m.group(3)) if m.group(3) else max(total - failed - skipped, 0)
        candidates.append((m.end(), passed, failed))

    for m in re.finditer(r"test result: (?:ok|FAILED)\.\s+(\d+)\s+passed;\s+(\d+)\s+failed;", text, re.I):
        candidates.append((m.end(), int(m.group(1)), int(m.group(2))))

    passing = list(re.finditer(r"(\d+)\s+passing", text, re.I))
    failing = list(re.finditer(r"(\d+)\s+failing", text, re.I))
    if passing or failing:
        end = max(m.end() for m in passing + failing)
        candidates.append(
            (end, int(passing[-1].group(1)) if passing else 0, int(failing[-1].group(1)) if failing else 0)
        )

    tap_pass = list(re.finditer(r"(?:#|\u2139)\s*pass\s+(\d+)", text, re.I))
    tap_fail = list(re.finditer(r"(?:#|\u2139)\s*fail\s+(\d+)", text, re.I))
    if tap_pass or tap_fail:
        end = max(m.end() for m in tap_pass + tap_fail)
        candidates.append(
            (end, int(tap_pass[-1].group(1)) if tap_pass else 0, int(tap_fail[-1].group(1)) if tap_fail else 0)
        )

    for m in re.finditer(r"OK \((\d+) tests?", text, re.I):
        candidates.append((m.end(), int(m.group(1)), 0))
    for m in re.finditer(
        r"Tests:\s+(\d+),\s+Assertions:\s*\d+(?:,\s+Errors:\s*\d+)?(?:,\s+Failures:\s*(\d+))?",
        text,
        re.I,
    ):
        total = int(m.group(1))
        failed = int(m.group(2) or 0)
        candidates.append((m.end(), max(total - failed, 0), failed))

    if not candidates:
        return None

    last_end = max(c[0] for c in candidates)
    best = max(
        (c for c in candidates if c[0] >= last_end - 40),
        key=lambda c: (c[1] + c[2], c[0]),
    )
    passed = max(best[1], 0)
    failed = max(best[2], 0)
    return VerifyResult(command="", exit_code=None, passed=passed, failed=failed, total=passed + failed)


# --- Repository preparation (mirrors harness.ts#prepareRepo) -----------------

def _git(cwd: Path, *args: str) -> tuple[bool, str]:
    result = subprocess.run(
        ["git", *args], cwd=str(cwd), capture_output=True, text=True, timeout=60
    )
    return result.returncode == 0, f"{result.stdout}{result.stderr}".strip()


def prepare_repo(task_dir: Path, dest: Path) -> None:
    """Copy a task's own files into a fresh repo and commit them.

    ``task.json`` and ``reference/`` are excluded so the agent never sees the
    answer. ``dest`` must not already exist: the caller guarantees a unique
    directory. A clean git baseline is required for the recorder to produce
    verified diffs, so a git failure is raised rather than silently swallowed —
    a run without a git baseline cannot be measured with the same fidelity.
    """
    if dest.exists():
        raise RuntimeError(f"destination already exists: {dest}")
    dest.mkdir(parents=True, exist_ok=True)
    for child in task_dir.iterdir():
        if child.name in ("task.json", "reference"):
            continue
        if child.is_dir():
            shutil.copytree(child, dest / child.name)
        else:
            shutil.copy2(child, dest / child.name)

    for args in (
        ("init", "-q"),
        ("config", "user.email", "dev@example.com"),
        ("config", "user.name", "Dev"),
        ("add", "."),
        ("commit", "-qm", "initial"),
    ):
        ok, out = _git(dest, *args)
        if not ok:
            raise RuntimeError(f"git {' '.join(args)} failed in {dest}: {out}")

    ok, status = _git(dest, "status", "--porcelain")
    if not ok or status:
        raise RuntimeError(f"task repo left untracked state: {status}")


def hash_protected(repo: Path, task: Any) -> dict[str, str]:
    """SHA-1 of each protected file (defines the task, must not change)."""
    hashes: dict[str, str] = {}
    for file in getattr(task, "protected_files", ()) or ():
        p = repo / file
        if p.is_file():
            hashes[file] = hashlib.sha1(p.read_bytes()).hexdigest()
    return hashes


def _tests_modified(repo: Path, before: dict[str, str]) -> bool:
    return any(
        (repo / file).is_file() is False
        or hashlib.sha1((repo / file).read_bytes()).hexdigest() != digest
        for file, digest in before.items()
    )


# --- Agent command construction (mirrors cli/validation/agents.ts) -----------

_AGENT_BUILDERS: dict[str, dict[str, Any]] = {
    "opencode": {
        "provider": "opencode",
        "harness_version": "2.0.32",
        # The custom provider (zhipu/glm-5.3-flash) is configured in the
        # user's ~/.config/opencode/opencode.json, so do NOT isolate XDG: an
        # isolated config dir would hide that provider (provider.no-route).
        "isolate": False,
        # --standalone keeps the run out of any interactive server.
        "argv": ["opencode", "run", "--standalone", "--format", "json", "--auto"],
    },
}


def build_agent_command(adapter: str, model: str, prompt: str) -> tuple[list[str], dict[str, Any]]:
    """Return (argv, agent_meta) for the native agent CLI command."""
    meta = _AGENT_BUILDERS.get(adapter)
    if meta is None:
        raise ValueError(f"unsupported adapter: {adapter} (supported: {', '.join(_AGENT_BUILDERS)})")
    argv = list(meta["argv"]) + ["--model", model, prompt]
    return argv, meta


# --- Recorder invocation ------------------------------------------------------

def _run_recorder(
    settings: Any,
    workdir: Path,
    *,
    name: str,
    adapter: str,
    model: str,
    agent_argv: list[str],
    agent_meta: dict[str, Any],
    timeout_ms: int,
    env: dict[str, str],
) -> tuple[int, Optional[str]]:
    """Run the Node recorder and return (exit_code, trace_path_or_none)."""
    argv = [
        settings.node,
        str(settings.recorder),
        "record",
        "--adapter", adapter,
        "--name", name,
        "--provider", agent_meta["provider"],
        "--model", model,
        "--harness-version", agent_meta["harness_version"],
        "--isolation", "xdg" if agent_meta["isolate"] else "none",
        "--",
        *agent_argv,
    ]
    try:
        result = subprocess.run(
            argv,
            cwd=str(workdir),
            env=env,
            capture_output=True,
            text=True,
            timeout=timeout_ms / 1000,
        )
    except subprocess.TimeoutExpired:
        return 124, None
    except OSError as exc:  # node missing, etc.
        return 127, None

    trace_path = workdir / "replays" / f"{name}.trace.json"
    return result.returncode, str(trace_path) if trace_path.is_file() else None


def load_trace(path: Optional[str]) -> dict[str, Any] | None:
    if not path:
        return None
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


# --- Evaluation (mirrors harness.ts#evaluateTask) ----------------------------

@dataclass(frozen=True)
class Evaluation:
    verify: VerifyResult | None
    status: str  # "pass" | "fail" | "unknown"
    reason: str | None
    tampered: bool


def run_verify(cwd: Path, command: str) -> tuple[bool, str]:
    try:
        result = subprocess.run(
            command, cwd=str(cwd), shell=True, capture_output=True, text=True, timeout=120
        )
    except subprocess.TimeoutExpired:
        return False, "(verify command timed out)"
    return result.returncode == 0, f"{result.stdout}{result.stderr}"


def evaluate_task(repo: Path, task: Any, baseline_hashes: dict[str, str]) -> Evaluation:
    """Judge the task in the final worktree, refusing rewritten tests first."""
    if _tests_modified(repo, baseline_hashes):
        return Evaluation(verify=None, status="fail", reason="tests_modified", tampered=True)

    ok, output = run_verify(repo, task.verify)
    parsed = parse_test_output(output)
    if parsed is None:
        verify = VerifyResult(command=task.verify, exit_code=0 if ok else 1, passed=0, failed=0, total=0)
    else:
        verify = VerifyResult(
            command=task.verify,
            exit_code=0 if ok else 1,
            passed=parsed.passed,
            failed=parsed.failed,
            total=parsed.total,
        )

    if _tests_modified(repo, baseline_hashes):
        return Evaluation(verify=verify, status="fail", reason="tests_modified", tampered=True)

    if verify.total <= 0:
        return Evaluation(verify=verify, status="unknown", reason=None, tampered=False)
    green = verify.exit_code == 0 and verify.failed == 0 and verify.passed > 0
    return Evaluation(verify=verify, status="pass" if green else "fail", reason=None, tampered=False)


# --- Run outcome --------------------------------------------------------------

@dataclass
class RunOutcome:
    """The result of a single agent run, fully serialisable to JSON."""

    run_id: str
    task_id: str
    status: str  # pass | fail | unknown
    success: bool
    reason: str | None
    latency_ms: int
    exit_code: Optional[int]
    prompt_name: str
    adapter: str
    model: str
    verify: dict[str, Any] | None
    usage: dict[str, Any] | None
    files_changed: list[str]
    termination: dict[str, Any] | None
    tampered: bool
    trace_path: Optional[str]
    trace: dict[str, Any] | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "run_id": self.run_id,
            "task_id": self.task_id,
            "status": self.status,
            "success": self.success,
            "reason": self.reason,
            "latency_ms": self.latency_ms,
            "exit_code": self.exit_code,
            "prompt_name": self.prompt_name,
            "adapter": self.adapter,
            "model": self.model,
            "verify": self.verify,
            "usage": self.usage,
            "files_changed": self.files_changed,
            "termination": self.termination,
            "tampered": self.tampered,
            "trace_path": self.trace_path,
        }


def _extract_usage(trace: dict[str, Any] | None) -> dict[str, Any] | None:
    """Normalise provider-reported token usage to {input, output, total}.

    Returns None when the provider did not report usage; callers must not
    fabricate it.
    """
    raw = (trace or {}).get("metadata", {}).get("usage")
    if not isinstance(raw, dict):
        return None
    inp = raw.get("input_tokens", raw.get("input"))
    out = raw.get("output_tokens", raw.get("output"))
    if inp is None and out is None:
        return None
    try:
        inp = int(inp) if inp is not None else 0
        out = int(out) if out is not None else 0
    except (TypeError, ValueError):
        return None
    return {"input": inp, "output": out, "total": inp + out}


def run_task(
    settings: Any,
    task: Any,
    *,
    run_id: str,
    prompt: str,
    prompt_name: str = "default",
    adapter: str | None = None,
    model: str | None = None,
    timeout_ms: int | None = None,
    keep_repo: bool = False,
    cleanup: bool = False,
) -> RunOutcome:
    """Execute one agent run and evaluate it in the final worktree.

    Returns a :class:`RunOutcome`; raises ``ValueError`` only for an unsupported
    adapter. Agent/provider failures are captured in the outcome, not raised,
    so a bad model call never crashes the API server.

    ``cleanup`` controls whether the ephemeral run/isolation directories are
    removed afterwards. It defaults to ``False`` because batch deletion can be
    gated by sandbox safety prompts; the trace is persisted independently, so
    leaving the directories in place never loses replay evidence.
    """
    adapter = adapter or settings.adapter
    model = model or settings.model
    timeout_ms = timeout_ms or settings.timeout_ms
    agent_argv, agent_meta = build_agent_command(adapter, model, prompt)

    work_root = settings.work_dir
    # A unique suffix per run means a fresh destination every time; the
    # executor never has to delete a previous run's directory.
    unique = uuid.uuid4().hex[:12]
    repo = work_root / "runs" / f"{task.id}--{run_id}--{unique}"
    prepare_repo(task.dir, repo)
    baseline_hashes = hash_protected(repo, task)

    env = dict(__import__("os").environ)
    env["PWD"] = str(repo)
    env["FORCE_COLOR"] = "0"
    iso_dir: Path | None = None
    if agent_meta["isolate"]:
        iso = work_root / "iso" / f"{task.id}--{run_id}--{unique}"
        iso_dir = iso
        for key, sub in (
            ("XDG_DATA_HOME", "data"),
            ("XDG_CONFIG_HOME", "config"),
            ("XDG_STATE_HOME", "state"),
            ("XDG_CACHE_HOME", "cache"),
        ):
            (iso / sub).mkdir(parents=True, exist_ok=True)
            env[key] = str(iso / sub)

    started = time.monotonic()
    exit_code, trace_path = _run_recorder(
        settings, repo, name=run_id, adapter=adapter, model=model,
        agent_argv=agent_argv, agent_meta=agent_meta, timeout_ms=timeout_ms, env=env,
    )
    latency_ms = int((time.monotonic() - started) * 1000)

    trace = load_trace(trace_path)

    # Persist the trace outside the ephemeral run directory so the replay link
    # survives cleanup. The original path lives inside the run dir that is
    # removed below; both the API and the experiment harness read this copy.
    persisted_trace_path: str | None = None
    if trace is not None:
        traces_dir = settings.results_dir / "traces"
        traces_dir.mkdir(parents=True, exist_ok=True)
        dest = traces_dir / f"{run_id}.trace.json"
        dest.write_text(json.dumps(trace, ensure_ascii=False), encoding="utf-8")
        persisted_trace_path = str(dest)

    evaluation = evaluate_task(repo, task, baseline_hashes)

    files_changed = (trace or {}).get("result", {}).get("filesChanged", []) or []
    termination = (trace or {}).get("termination")

    outcome = RunOutcome(
        run_id=run_id,
        task_id=task.id,
        status=evaluation.status,
        success=evaluation.status == "pass",
        reason=evaluation.reason,
        latency_ms=latency_ms,
        exit_code=exit_code if exit_code not in (None,) else None,
        prompt_name=prompt_name,
        adapter=adapter,
        model=model,
        verify=(
            {
                "command": evaluation.verify.command,
                "exit_code": evaluation.verify.exit_code,
                "passed": evaluation.verify.passed,
                "failed": evaluation.verify.failed,
                "total": evaluation.verify.total,
            }
            if evaluation.verify
            else None
        ),
        usage=_extract_usage(trace),
        files_changed=files_changed,
        termination=termination,
        tampered=evaluation.tampered,
        trace_path=persisted_trace_path,
        trace=trace,
    )

    # Cleanup the ephemeral run directory and isolation dir only when asked.
    # The trace has already been persisted above, so this never removes replay
    # evidence regardless of cleanup.
    if cleanup and not keep_repo:
        shutil.rmtree(repo, ignore_errors=True)
        if iso_dir:
            shutil.rmtree(iso_dir, ignore_errors=True)
    return outcome
