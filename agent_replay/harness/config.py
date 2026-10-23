"""Harness configuration.

Model credentials are never stored here. The config names the environment
variable that holds the key; :mod:`agent_replay.harness.model_client` reads it
at call time. ``to_dict`` is safe to write into ``config.json``.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any

from ..config import REPO_ROOT
from .errors import ConfigError

CONTEXT_STRATEGIES = ("full", "truncated", "compressed")
MODEL_BACKENDS = ("openai", "scripted")


def _env(env: dict[str, str], name: str, default: str) -> str:
    return env.get(name, default)


def _bool(value: str | bool | None, default: bool = False) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    return value.strip().lower() in ("1", "true", "yes", "on")


@dataclass(frozen=True)
class HarnessConfig:
    repo_root: Path
    tasks_dir: Path
    runs_dir: Path
    work_dir: Path
    skills_dir: Path

    max_steps: int = 12
    max_retries: int = 1
    timeout_seconds: int = 300
    tool_timeout_seconds: int = 120
    max_tool_output_chars: int = 10_000
    max_file_bytes: int = 200_000
    max_patch_bytes: int = 200_000

    context_strategy: str = "truncated"
    context_recent_turns: int = 4
    context_token_budget: int = 24_000
    context_chars_per_token: int = 4
    context_max_tool_output_chars: int = 10_000

    use_skills: bool = False
    skill_name: str | None = None

    reviewer: bool = False
    reviewer_model: str | None = None
    max_rounds: int = 2
    max_agent_calls: int = 12
    max_total_tokens: int | None = None

    model_backend: str = "openai"
    model: str = "glm-5.3-flash"
    model_base_url: str | None = None
    model_api_key_env: str = "AGENT_REPLAY_MODEL_API_KEY"
    model_timeout_seconds: int = 90
    model_max_retries: int = 1
    temperature: float = 0.0
    max_tokens: int | None = None

    keep_workspace: bool = True
    evidence_level: str = "live"
    memory_path: Path | None = None
    metadata: dict[str, Any] | None = None

    def __post_init__(self) -> None:
        if self.context_strategy not in CONTEXT_STRATEGIES:
            raise ConfigError(
                f"unknown context strategy {self.context_strategy!r}; "
                f"choose from {', '.join(CONTEXT_STRATEGIES)}"
            )
        if self.model_backend not in MODEL_BACKENDS:
            raise ConfigError(
                f"unknown model backend {self.model_backend!r}; "
                f"choose from {', '.join(MODEL_BACKENDS)}"
            )
        if self.max_steps < 1:
            raise ConfigError("max_steps must be >= 1")
        if self.max_retries < 0:
            raise ConfigError("max_retries must be >= 0")
        if self.timeout_seconds < 1:
            raise ConfigError("timeout_seconds must be >= 1")
        if self.context_token_budget < 256:
            raise ConfigError("context_token_budget must be >= 256")

    @classmethod
    def from_env(cls, environ: dict[str, str] | None = None) -> "HarnessConfig":
        env = dict(os.environ if environ is None else environ)
        root = Path(env.get("AGENT_REPLAY_ROOT", REPO_ROOT)).resolve()
        runs_dir = Path(
            _env(env, "AGENT_REPLAY_HARNESS_RUNS_DIR", str(root / "results" / "harness" / "runs"))
        ).resolve()
        work_dir = Path(
            _env(env, "AGENT_REPLAY_HARNESS_WORK_DIR", str(root / "results" / "harness" / "work"))
        ).resolve()
        return cls(
            repo_root=root,
            tasks_dir=Path(
                _env(env, "AGENT_REPLAY_HARNESS_TASKS_DIR", str(root / "examples" / "harness_tasks"))
            ).resolve(),
            runs_dir=runs_dir,
            work_dir=work_dir,
            skills_dir=Path(
                _env(
                    env,
                    "AGENT_REPLAY_HARNESS_SKILLS_DIR",
                    str(root / "agent_replay" / "skills" / "builtin"),
                )
            ).resolve(),
            max_steps=int(_env(env, "AGENT_REPLAY_HARNESS_MAX_STEPS", "12")),
            max_retries=int(_env(env, "AGENT_REPLAY_HARNESS_MAX_RETRIES", "1")),
            timeout_seconds=int(_env(env, "AGENT_REPLAY_HARNESS_TIMEOUT", "300")),
            tool_timeout_seconds=int(_env(env, "AGENT_REPLAY_HARNESS_TOOL_TIMEOUT", "120")),
            max_tool_output_chars=int(
                _env(env, "AGENT_REPLAY_HARNESS_MAX_TOOL_OUTPUT", "10000")
            ),
            context_strategy=_env(env, "AGENT_REPLAY_HARNESS_CONTEXT", "truncated"),
            context_recent_turns=int(_env(env, "AGENT_REPLAY_HARNESS_RECENT_TURNS", "4")),
            context_token_budget=int(_env(env, "AGENT_REPLAY_HARNESS_TOKEN_BUDGET", "24000")),
            context_max_tool_output_chars=int(
                _env(env, "AGENT_REPLAY_HARNESS_CONTEXT_MAX_OUTPUT", "10000")
            ),
            use_skills=_bool(env.get("AGENT_REPLAY_HARNESS_SKILLS"), False),
            reviewer=_bool(env.get("AGENT_REPLAY_HARNESS_REVIEWER"), False),
            max_rounds=int(_env(env, "AGENT_REPLAY_HARNESS_MAX_ROUNDS", "2")),
            max_agent_calls=int(_env(env, "AGENT_REPLAY_HARNESS_MAX_AGENT_CALLS", "12")),
            max_total_tokens=(
                int(env["AGENT_REPLAY_HARNESS_MAX_TOTAL_TOKENS"])
                if env.get("AGENT_REPLAY_HARNESS_MAX_TOTAL_TOKENS")
                else None
            ),
            model_backend=_env(env, "AGENT_REPLAY_HARNESS_BACKEND", "openai"),
            model=_env(env, "AGENT_REPLAY_MODEL", "glm-5.3-flash"),
            model_base_url=env.get("AGENT_REPLAY_MODEL_BASE_URL") or None,
            model_api_key_env=_env(
                env, "AGENT_REPLAY_HARNESS_API_KEY_ENV", "AGENT_REPLAY_MODEL_API_KEY"
            ),
            model_timeout_seconds=int(
                _env(env, "AGENT_REPLAY_HARNESS_MODEL_TIMEOUT", "90")
            ),
            keep_workspace=_bool(env.get("AGENT_REPLAY_HARNESS_KEEP_WORKSPACE"), True),
            memory_path=(
                Path(env["AGENT_REPLAY_HARNESS_MEMORY"]).resolve()
                if env.get("AGENT_REPLAY_HARNESS_MEMORY")
                else None
            ),
        )

    def with_overrides(self, **overrides: Any) -> "HarnessConfig":
        unknown = set(overrides) - set(self.__dataclass_fields__)
        if unknown:
            raise ConfigError(f"unknown config field(s): {', '.join(sorted(unknown))}")
        return replace(self, **overrides)

    def to_dict(self) -> dict[str, Any]:
        data: dict[str, Any] = {}
        for key in self.__dataclass_fields__:
            value = getattr(self, key)
            data[key] = str(value) if isinstance(value, Path) else value
        data.pop("metadata", None)
        return data
