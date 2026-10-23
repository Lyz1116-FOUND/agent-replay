"""Skill loading and task matching."""

from __future__ import annotations

from pathlib import Path

from agent_replay.harness.types import TaskSpec
from agent_replay.skills.loader import SkillRegistry

SKILLS = Path(__file__).resolve().parents[1] / "agent_replay" / "skills" / "builtin"


def _task(instruction: str, tags: tuple[str, ...] = ("python", "pytest")) -> TaskSpec:
    return TaskSpec(
        task_id="skill-task",
        repo_path="/tmp/repo",
        instruction=instruction,
        metadata={"title": "Skill task", "kind": "bug", "tags": list(tags)},
    )


def test_builtin_skill_loads_and_matches():
    registry = SkillRegistry.load_dir(SKILLS)
    assert registry.names() == ["python_test_debug"]
    skill = registry.match(_task("Fix the failing pytest test."))
    assert skill is not None
    assert skill.name == "python_test_debug"
    assert "Never modify" in skill.system_section()


def test_skill_match_can_be_named_or_absent():
    registry = SkillRegistry.load_dir(SKILLS)
    assert registry.match(_task("unrelated"), name="python_test_debug") is not None
    unrelated = _task("unrelated", tags=())
    unrelated.metadata["kind"] = "feature"
    assert registry.match(unrelated, name=None) is None
    assert registry.get("missing") is None


def test_skill_metadata_is_exposed():
    registry = SkillRegistry.load_dir(SKILLS)
    skill = registry.get("python_test_debug")
    assert skill is not None
    assert skill.score(_task("fix a bug")) >= 1
    payload = skill.to_dict()
    assert payload["triggers"]
    assert "description" in payload
