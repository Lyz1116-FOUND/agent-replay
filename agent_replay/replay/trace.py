"""Convert a harness run into an ``agent-replay/v1`` native trace.

This is the bridge back to the product: the same run that produced
``events.jsonl`` can be imported into the viewer without re-recording it.
"""

from __future__ import annotations

import platform
import sys
from datetime import datetime, timedelta, timezone
from typing import Any

from ..harness.config import HarnessConfig
from ..harness.grader import test_report_from_grade
from ..harness.types import HarnessResult, TaskSpec

_TYPE_BY_TOOL = {
    "read_file": "read",
    "grep": "search",
    "write_file": "edit",
    "shell": "shell",
    "run_tests": "test",
    "git_diff": "tool",
}

_TERMINATION = {
    "passed": "completed",
    "failed": "task_failure",
    "timeout": "timeout",
    "provider_error": "provider_unavailable",
    "harness_error": "agent_error",
}


def _language(path: str) -> str:
    suffix = path.rsplit(".", 1)[-1].lower() if "." in path else ""
    return {
        "py": "python",
        "js": "javascript",
        "mjs": "javascript",
        "ts": "typescript",
        "json": "json",
        "md": "markdown",
        "sh": "shell",
    }.get(suffix, "text")


def _summary_for(call: dict[str, Any]) -> str:
    name = call.get("name", "tool")
    arguments = call.get("arguments") or {}
    if name == "read_file":
        return f"Read {arguments.get('path', '')}"
    if name == "grep":
        return f"Search for {arguments.get('query', '')!r}"
    if name == "write_file":
        return f"Write {arguments.get('path', '')}"
    if name == "shell":
        return f"Run {str(arguments.get('command', ''))[:80]}"
    if name == "run_tests":
        return "Run tests"
    if name == "git_diff":
        return "Inspect workspace diff"
    return name


def _tool_artifacts(call: dict[str, Any]) -> list[dict[str, Any]]:
    name = call.get("name", "")
    arguments = call.get("arguments") or {}
    metadata = call.get("metadata") or {}
    output = str(call.get("output", ""))
    if name == "read_file":
        path = str(metadata.get("path") or arguments.get("path") or "")
        return [
            {
                "kind": "code",
                "path": path,
                "language": _language(path),
                "content": output,
            }
        ]
    if name == "grep":
        results = metadata.get("results") or []
        return [
            {
                "kind": "search",
                "query": str(arguments.get("query", "")),
                "results": [
                    {
                        "path": str(item.get("path", "")),
                        "line": int(item.get("line", 1)),
                        "preview": str(item.get("preview", "")),
                    }
                    for item in results
                    if isinstance(item, dict)
                ],
            }
        ]
    if name == "write_file":
        path = str(metadata.get("path") or arguments.get("path") or "")
        return [
            {
                "kind": "diff",
                "path": path,
                "before": str(metadata.get("before", "")),
                "after": str(metadata.get("after", "")),
                "language": _language(path),
            }
        ]
    if name == "shell":
        return [
            {
                "kind": "terminal",
                "command": str(arguments.get("command", "")),
                "output": output,
                "exitCode": int(metadata.get("exit_code") or 0),
                "cwd": str(metadata.get("cwd", ".")),
            }
        ]
    if name == "run_tests":
        return [
            {
                "kind": "test",
                "command": str(metadata.get("command", "")),
                "passed": int(metadata.get("passed", 0) or 0),
                "failed": int(metadata.get("failed", 0) or 0),
                "total": int(metadata.get("total", 0) or 0),
                "output": output,
                "failedTests": list(metadata.get("failed_tests") or []),
            }
        ]
    if name == "git_diff":
        return [{"kind": "patch", "diff": output}]
    return []


def build_trace(
    result: HarnessResult,
    task: TaskSpec,
    config: HarnessConfig,
) -> dict[str, Any]:
    duration = max(int(result.latency_ms), 1)
    started_at = result.metadata.get("started_at")
    if not started_at:
        started_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    try:
        started_dt = datetime.fromisoformat(str(started_at).replace("Z", "+00:00"))
    except ValueError:
        started_dt = datetime.now(timezone.utc)
    ended_dt = started_dt + timedelta(milliseconds=duration)

    root_id = "harness-root"
    spans: list[dict[str, Any]] = [
        {
            "id": root_id,
            "type": "agent",
            "name": task.title,
            "summary": f"Harness run for {task.task_id}",
            "startMs": 0,
            "endMs": duration,
            "status": "ok" if result.success else "error",
            "files": list(result.files_changed),
            "attributes": {
                "task": task.task_id,
                "attempts": len(result.attempts),
                "steps": result.steps,
                "toolCalls": result.tool_calls,
                "retries": result.retries,
            },
        }
    ]

    diagnostics = result.diagnostics or {}
    for index, model_call in enumerate(diagnostics.get("model_calls") or []):
        start = int(model_call.get("started_ms", 0) or 0)
        end = int(model_call.get("ended_ms", start + int(model_call.get("latency_ms", 0) or 0)) or start)
        start = max(0, min(start, duration))
        end = max(start, min(end, duration))
        text = str(model_call.get("text") or "")
        span: dict[str, Any] = {
            "id": f"model-{index + 1}",
            "parentId": root_id,
            "type": "generation",
            "name": f"Model call {index + 1}",
            "summary": text[:200] if text else f"{model_call.get('tool_call_count', 0)} tool call(s)",
            "startMs": start,
            "endMs": end,
            "status": "ok",
            "attributes": {
                "attempt": int(model_call.get("attempt", 1) or 1),
                "step": int(model_call.get("step", 0) or 0),
                "contextTokens": int(model_call.get("context_tokens", 0) or 0),
                "inputTokens": int((model_call.get("usage") or {}).get("input_tokens", 0) or 0),
                "outputTokens": int((model_call.get("usage") or {}).get("output_tokens", 0) or 0),
            },
        }
        if text:
            span["artifacts"] = [{"kind": "reasoning", "content": text}]
        spans.append(span)

    for index, call in enumerate(diagnostics.get("tool_calls") or []):
        start = int(call.get("started_ms", 0) or 0)
        end = int(call.get("ended_ms", start + int(call.get("duration_ms", 0) or 0)) or start)
        start = max(0, min(start, duration))
        end = max(start, min(end, duration))
        name = str(call.get("name", "tool"))
        success = bool(call.get("success"))
        test_failed = False
        metadata = call.get("metadata") or {}
        if name == "run_tests" and str(metadata.get("status")) == "fail":
            test_failed = True
        status = "ok" if success and not test_failed else ("warning" if test_failed else "error")
        span = {
            "id": f"tool-{index + 1}",
            "parentId": root_id,
            "type": _TYPE_BY_TOOL.get(name, "tool"),
            "name": name,
            "summary": _summary_for(call),
            "startMs": start,
            "endMs": end,
            "status": status,
            "attributes": {
                "tool": name,
                "attempt": int(call.get("attempt", 1) or 1),
                "step": int(call.get("step", 0) or 0),
                "durationMs": int(call.get("duration_ms", 0) or 0),
            },
        }
        files = []
        if name == "read_file" and metadata.get("path"):
            files = [str(metadata["path"])]
        if name == "write_file" and metadata.get("path"):
            files = [str(metadata["path"])]
        if files:
            span["files"] = files
        artifacts = _tool_artifacts(call)
        if artifacts:
            span["artifacts"] = artifacts
        spans.append(span)

    report = test_report_from_grade(result.grade)
    tests = None
    if report and int(report.get("total", 0) or 0) > 0:
        tests = {
            "passed": int(report.get("passed", 0) or 0),
            "failed": int(report.get("failed", 0) or 0),
            "total": int(report.get("total", 0) or 0),
        }
    summary = (
        result.grade.feedback.splitlines()[0]
        if result.grade and result.grade.feedback
        else ("Run passed." if result.success else f"Run failed: {result.failure_reason or result.status}")
    )
    spans.append(
        {
            "id": "result",
            "parentId": root_id,
            "type": "final",
            "name": "Result",
            "summary": summary[:300],
            "startMs": max(0, duration - 1),
            "endMs": duration,
            "status": "ok" if result.success else "error",
            "artifacts": [
                {
                    "kind": "markdown",
                    "content": (
                        f"## Harness result\n\n"
                        f"- status: **{result.status}**\n"
                        f"- attempts: {len(result.attempts)}\n"
                        f"- steps: {result.steps}\n"
                        f"- tool calls: {result.tool_calls}\n"
                        f"- files changed: {', '.join(result.files_changed) or '(none)'}\n\n"
                        f"{summary}"
                    ),
                }
            ],
        }
    )

    termination_kind = _TERMINATION.get(result.status, "agent_error")
    # A claim-grader run is a completed experiment, but its verdict is not
    # harness-verified. The native status makes that distinction visible.
    trace_status = (
        "pass"
        if result.success and result.grade and result.grade.authority == "harness"
        else ("partial" if result.success else "fail")
    )
    return {
        "schemaVersion": "agent-replay/v1",
        "id": result.run_id,
        "task": {
            "id": task.task_id,
            "title": task.title,
            "description": task.instruction,
            "repo": str(task.metadata.get("repo") or "harness-fixture"),
        },
        "agent": {
            "name": "Agent Replay Harness",
            "version": "m6",
            "model": str(result.metadata.get("model") or config.model),
        },
        "status": trace_status,
        "termination": {"kind": termination_kind},
        "environment": {
            "isolation": "none",
            "provider": str(result.metadata.get("model_backend") or config.model_backend),
            "model": str(result.metadata.get("model") or config.model),
            "harnessVersion": "m6",
            "recorderVersion": "python-harness",
            "platform": sys.platform,
            "arch": platform.machine(),
        },
        "startedAt": started_dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
        "endedAt": ended_dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
        "durationMs": duration,
        "result": {
            "summary": summary,
            "filesChanged": list(result.files_changed),
            "patch": result.metadata.get("patch_preview", ""),
            **({"tests": tests} if tests else {}),
        },
        "capture": {
            "fidelity": "native+workspace",
            "timing": "observed",
            "adapter": "agent-replay-harness",
            "sources": ["harness-events", "git-workspace"],
            "workspaceVerification": "verified" if result.grade and result.grade.authority == "harness" else "unavailable",
        },
        "spans": spans,
        "metadata": {
            "runId": result.run_id,
            "evidenceLevel": config.evidence_level,
            "failureCategory": result.failure_category,
            "contextStrategy": config.context_strategy,
            "gradeAuthority": result.grade.authority if result.grade else None,
            "score": result.score,
        },
    }
