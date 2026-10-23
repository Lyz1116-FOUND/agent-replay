"""The coder role.

The harness loop already *is* the coder runtime; this wrapper names the role
and keeps the multi-agent boundary explicit without duplicating the loop.
"""

from __future__ import annotations

from typing import Any

from ..harness.model_client import ModelClient
from ..harness.types import ModelTurn


class CoderAgent:
    name = "coder"

    def __init__(self, model: ModelClient) -> None:
        self.model = model

    @property
    def model_name(self) -> str:
        return self.model.model

    def act(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]],
        *,
        timeout_seconds: int | None = None,
    ) -> ModelTurn:
        return self.model.complete(messages, tools, timeout_seconds=timeout_seconds)
