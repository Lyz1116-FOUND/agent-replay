"""Prompt template loading and rendering.

Templates live as standalone files under ``agent_replay/prompts/`` and are never
hard-coded in business logic. ``{{ instruction }}`` is replaced with the task's
own instruction; the rest of the template is the experimental variable.
"""

from __future__ import annotations

from pathlib import Path

PROMPT_NAMES = ("default", "structured", "verify")

_INSTRUCTION_PLACEHOLDER = "{{ instruction }}"


def load_prompt_templates(prompts_dir: Path, names: tuple[str, ...] = PROMPT_NAMES) -> dict[str, str]:
    """Read every prompt template file; raise on a missing or empty file."""
    templates: dict[str, str] = {}
    for name in names:
        path = prompts_dir / f"{name}.txt"
        if not path.is_file():
            raise FileNotFoundError(f"prompt template not found: {path}")
        text = path.read_text(encoding="utf-8")
        if _INSTRUCTION_PLACEHOLDER not in text:
            raise ValueError(f"prompt template {name} is missing {_INSTRUCTION_PLACEHOLDER!r}")
        templates[name] = text
    return templates


def render_prompt(template: str, instruction: str) -> str:
    """Substitute the task instruction into a prompt template."""
    return template.replace(_INSTRUCTION_PLACEHOLDER, instruction).strip()
