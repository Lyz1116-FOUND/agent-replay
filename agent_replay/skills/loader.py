"""Skill loading and task matching.

A skill is instructions + metadata, not a new runtime. Loading a skill adds a
section to the system prompt and emits an event; the loop, tools, and grader
are unchanged. That keeps ``skills on/off`` a clean experiment variable.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from ..harness.types import TaskSpec


@dataclass
class Skill:
    name: str
    description: str
    instructions: str
    path: Path
    triggers: tuple[str, ...] = ()
    min_score: int = 1
    metadata: dict[str, Any] = field(default_factory=dict)

    def matches(self, task: TaskSpec) -> bool:
        return self.score(task) >= self.min_score

    def score(self, task: TaskSpec) -> int:
        haystack = " ".join(
            [
                task.task_id,
                task.instruction,
                task.kind,
                " ".join(task.tags),
            ]
        ).lower()
        return sum(1 for trigger in self.triggers if trigger.lower() in haystack)

    def system_section(self) -> str:
        return f"## Skill: {self.name}\n{self.instructions.strip()}"

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "description": self.description,
            "triggers": list(self.triggers),
            "min_score": self.min_score,
            "path": str(self.path),
            "metadata": self.metadata,
        }


class SkillRegistry:
    def __init__(self, skills: list[Skill] | None = None) -> None:
        self.skills = skills or []

    @classmethod
    def load_dir(cls, directory: Path) -> "SkillRegistry":
        skills: list[Skill] = []
        if not directory.is_dir():
            return cls(skills)
        for entry in sorted(directory.iterdir()):
            if not entry.is_dir():
                continue
            instructions_path = entry / "SKILL.md"
            metadata_path = entry / "metadata.json"
            if not instructions_path.is_file():
                continue
            metadata: dict[str, Any] = {}
            if metadata_path.is_file():
                try:
                    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
                except json.JSONDecodeError:
                    metadata = {}
            skills.append(
                Skill(
                    name=str(metadata.get("name") or entry.name),
                    description=str(metadata.get("description") or ""),
                    instructions=instructions_path.read_text(encoding="utf-8"),
                    path=entry,
                    triggers=tuple(str(x) for x in metadata.get("triggers", ())),
                    min_score=int(metadata.get("min_score", 1)),
                    metadata=metadata,
                )
            )
        return cls(skills)

    def get(self, name: str) -> Skill | None:
        for skill in self.skills:
            if skill.name == name:
                return skill
        return None

    def match(self, task: TaskSpec, *, name: str | None = None) -> Skill | None:
        if name:
            return self.get(name)
        candidates = [skill for skill in self.skills if skill.matches(task)]
        if not candidates:
            return None
        candidates.sort(key=lambda skill: (-skill.score(task), skill.name))
        return candidates[0]

    def names(self) -> list[str]:
        return [skill.name for skill in self.skills]
