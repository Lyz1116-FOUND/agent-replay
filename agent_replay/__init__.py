"""Agent Replay — Python service layer and experiment framework.

This package exposes the existing Node recorder (``dist-cli/agent-replay.mjs``)
through a thin FastAPI service and a reproducible prompt-evaluation harness.
The core execution and trusted-verify semantics live in
:mod:`agent_replay.core.executor` and reuse the Node CLI rather than
reimplementing it.
"""

__version__ = "1.0.0-beta.1"
