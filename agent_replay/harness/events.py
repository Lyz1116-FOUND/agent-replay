"""Append-only event and JSONL logging.

Events are the replay source of truth: every model call, tool call, file
change, test run, grader verdict, and retry is emitted once, in order. The
same records drive the CLI stream, ``events.jsonl``, metrics, and the native
Agent Replay trace.
"""

from __future__ import annotations

import json
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


class JsonlWriter:
    """Line-buffered JSONL writer that never lets logging break a run."""

    def __init__(self, path: Path | None) -> None:
        self.path = path
        self._handle = None
        self._lock = threading.Lock()
        if path is not None:
            path.parent.mkdir(parents=True, exist_ok=True)
            self._handle = path.open("a", encoding="utf-8")

    def write(self, record: dict[str, Any]) -> None:
        if self._handle is None:
            return
        line = json.dumps(record, ensure_ascii=False, default=str)
        with self._lock:
            self._handle.write(line + "\n")
            self._handle.flush()

    def close(self) -> None:
        with self._lock:
            if self._handle is not None:
                self._handle.close()
                self._handle = None


class EventLogger:
    """Ordered event log with an optional live listener for the CLI."""

    def __init__(
        self,
        path: Path | None = None,
        *,
        listener: Callable[[dict[str, Any]], None] | None = None,
    ) -> None:
        self.events: list[dict[str, Any]] = []
        self._writer = JsonlWriter(path)
        self._listener = listener
        self._started = time.monotonic()
        self._seq = 0
        self._lock = threading.Lock()

    def emit(self, event_type: str, **data: Any) -> dict[str, Any]:
        with self._lock:
            self._seq += 1
            event = {
                "seq": self._seq,
                "type": event_type,
                "timestamp": utc_now(),
                "elapsed_ms": int((time.monotonic() - self._started) * 1000),
                **data,
            }
            self.events.append(event)
            self._writer.write(event)
        if self._listener is not None:
            try:
                self._listener(event)
            except Exception:
                # A display callback must never affect the run.
                pass
        return event

    def close(self) -> None:
        self._writer.close()

    def types(self) -> list[str]:
        return [str(event["type"]) for event in self.events]

    def of_type(self, event_type: str) -> list[dict[str, Any]]:
        return [event for event in self.events if event["type"] == event_type]
