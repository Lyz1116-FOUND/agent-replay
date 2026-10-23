"""Bounded subprocess output and process-group cleanup for native tools.

POSIX process groups cover ordinary descendants, not processes that deliberately
escape the session. This is resource control, not an OS security sandbox.
"""
from __future__ import annotations

import os
import selectors
import signal
import subprocess
import time
from dataclasses import dataclass


@dataclass
class CommandResult:
    returncode: int | None
    output: str
    timed_out: bool
    truncated: bool


def run_bounded_command(command: str, *, cwd: str, env: dict[str, str],
                        timeout_seconds: float, max_output_chars: int) -> CommandResult:
    limit = max(1, max_output_chars)
    # Preserve both the beginning and the summary at the end, while draining
    # all output to avoid pipe deadlocks. Storage is O(limit), not O(output).
    byte_limit = limit * 4
    head = bytearray()
    tail = bytearray()
    total = 0
    timed_out = False
    deadline = time.monotonic() + timeout_seconds
    process = subprocess.Popen(command, shell=True, cwd=cwd, env=env,
                               stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                               start_new_session=True)
    assert process.stdout is not None
    group_killed = False

    def kill_group() -> None:
        nonlocal group_killed
        if group_killed:
            return
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        group_killed = True

    try:
        with selectors.DefaultSelector() as selector:
            selector.register(process.stdout, selectors.EVENT_READ)
            while selector.get_map():
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    timed_out = True
                    kill_group()
                    break
                for key, _ in selector.select(remaining):
                    chunk = os.read(key.fd, 65536)
                    if not chunk:
                        selector.unregister(key.fileobj)
                        continue
                    total += len(chunk)
                    missing = byte_limit // 2 - len(head)
                    if missing > 0:
                        head.extend(chunk[:missing])
                        chunk = chunk[missing:]
                    if chunk:
                        tail.extend(chunk)
                        del tail[:max(0, len(tail) - byte_limit // 2)]
            try:
                process.wait(timeout=max(0.001, deadline - time.monotonic()))
            except subprocess.TimeoutExpired:
                timed_out = True
                kill_group()
                process.wait()
    finally:
        # Background descendants must not mutate the workspace after grading.
        kill_group()
        process.wait()
        process.stdout.close()
    raw = bytes(head + tail).decode('utf-8', errors='replace')
    truncated = total > byte_limit or len(raw) > limit
    if truncated:
        note = '\n... (output truncated) ...\n'
        keep = max(0, limit - len(note))
        raw = raw[:keep // 2] + note + raw[-(keep - keep // 2):] if keep else note[:limit]
    return CommandResult(None if timed_out else process.returncode, raw, timed_out, truncated)
