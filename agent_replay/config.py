"""Configuration for the Agent Replay service and experiments.

All paths default to the repository layout and can be overridden with
environment variables. No secrets are stored here; model credentials are owned
by the underlying agent CLI (e.g. OpenCode), not by this package.
"""

from __future__ import annotations

import os
import shutil
from dataclasses import dataclass
from pathlib import Path

# agent_replay/config.py -> <repo-root>/agent_replay/config.py
REPO_ROOT = Path(__file__).resolve().parents[1]

DEFAULT_ADAPTER = "opencode"
DEFAULT_MODEL = "zhipu/glm-5.3-flash"
DEFAULT_TIMEOUT_MS = 300_000


def _which(cmd: str) -> str:
    found = shutil.which(cmd)
    return found or cmd


@dataclass(frozen=True)
class Settings:
    """Resolved runtime settings. Immutable; build with :meth:`from_env`."""

    repo_root: Path
    recorder: Path
    node: str
    tasks_dir: Path
    prompts_dir: Path
    adapter: str
    model: str
    timeout_ms: int
    store_dir: Path
    work_dir: Path
    results_dir: Path

    @classmethod
    def from_env(cls, environ: dict | None = None) -> "Settings":
        env = dict(os.environ if environ is None else environ)
        root = Path(env.get("AGENT_REPLAY_ROOT", REPO_ROOT)).resolve()
        store_dir = Path(
            env.get("AGENT_REPLAY_STORE_DIR", root / ".agent_replay" / "store")
        ).resolve()
        work_dir = Path(
            env.get("AGENT_REPLAY_WORK_DIR", root / ".agent_replay" / "work")
        ).resolve()
        results_dir = Path(
            env.get("AGENT_REPLAY_RESULTS_DIR", root / "results")
        ).resolve()
        return cls(
            repo_root=root,
            recorder=root / "dist-cli" / "agent-replay.mjs",
            node=env.get("AGENT_REPLAY_NODE") or _which("node"),
            tasks_dir=root / "examples" / "tasks",
            prompts_dir=root / "agent_replay" / "prompts",
            adapter=env.get("AGENT_REPLAY_ADAPTER", DEFAULT_ADAPTER),
            model=env.get("AGENT_REPLAY_MODEL", DEFAULT_MODEL),
            timeout_ms=int(env.get("AGENT_REPLAY_TIMEOUT_MS", DEFAULT_TIMEOUT_MS)),
            store_dir=store_dir,
            work_dir=work_dir,
            results_dir=results_dir,
        )


def get_settings() -> Settings:
    return Settings.from_env()
