"""Small persistent memory store.

Memory is deliberately not a vector database. It is a JSON key/value log with
keyword search, used for facts that should survive a run (prior outcomes for
the same task). It is separate from context: context is what the next model
call sees; memory is what the harness may recall into a later context.
"""

from __future__ import annotations

import json
import threading
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def _now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


@dataclass
class MemoryEntry:
    key: str
    value: Any
    tags: list[str] = field(default_factory=list)
    created_at: str = field(default_factory=_now)

    def to_dict(self) -> dict[str, Any]:
        return {
            "key": self.key,
            "value": self.value,
            "tags": self.tags,
            "created_at": self.created_at,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "MemoryEntry":
        return cls(
            key=str(data["key"]),
            value=data.get("value"),
            tags=[str(tag) for tag in data.get("tags", [])],
            created_at=str(data.get("created_at") or _now()),
        )


class MemoryStore:
    def __init__(self, path: Path | None = None) -> None:
        self.path = Path(path) if path else None
        self._lock = threading.Lock()
        self._entries: dict[str, MemoryEntry] = {}
        if self.path and self.path.is_file():
            self._load()

    def _load(self) -> None:
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))  # type: ignore[union-attr]
        except (OSError, json.JSONDecodeError):
            return
        for raw in data.get("entries", []) if isinstance(data, dict) else []:
            try:
                entry = MemoryEntry.from_dict(raw)
            except (KeyError, TypeError):
                continue
            self._entries[entry.key] = entry

    def _persist(self) -> None:
        if self.path is None:
            return
        self.path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "version": 1,
            "entries": [entry.to_dict() for entry in self._entries.values()],
        }
        temporary = self.path.with_suffix(self.path.suffix + ".tmp")
        temporary.write_text(
            json.dumps(payload, indent=2, ensure_ascii=False, default=str),
            encoding="utf-8",
        )
        temporary.replace(self.path)

    def put(self, key: str, value: Any, *, tags: list[str] | None = None) -> None:
        with self._lock:
            self._entries[key] = MemoryEntry(key=key, value=value, tags=list(tags or []))
            self._persist()

    def get(self, key: str) -> Any | None:
        with self._lock:
            entry = self._entries.get(key)
            return entry.value if entry else None

    def search(self, query: str, *, limit: int = 10) -> list[MemoryEntry]:
        needle = query.lower()
        with self._lock:
            matches: list[MemoryEntry] = []
            for entry in self._entries.values():
                haystack = " ".join(
                    [
                        entry.key,
                        " ".join(entry.tags),
                        json.dumps(entry.value, ensure_ascii=False, default=str),
                    ]
                ).lower()
                if needle in haystack:
                    matches.append(entry)
            matches.sort(key=lambda entry: entry.created_at, reverse=True)
            return matches[:limit]

    def all(self) -> list[MemoryEntry]:
        with self._lock:
            return list(self._entries.values())

    def delete(self, key: str) -> bool:
        with self._lock:
            removed = self._entries.pop(key, None) is not None
            if removed:
                self._persist()
            return removed

    def to_dict(self) -> dict[str, Any]:
        with self._lock:
            return {
                "version": 1,
                "entries": [entry.to_dict() for entry in self._entries.values()],
            }
