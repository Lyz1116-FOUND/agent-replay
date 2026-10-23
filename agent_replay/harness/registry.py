"""Tool registry: schemas in, uniform results out.

The loop never branches on tool names. It asks the registry for schemas and
hands it tool calls. Unknown tools and invalid arguments become typed
``ToolResult`` failures so the model can correct itself in the next turn.
"""

from __future__ import annotations

import time
from typing import Any

from ..tools.base import Tool
from .errors import ToolArgumentError
from .types import ToolCall, ToolResult


class ToolRegistry:
    def __init__(self, *, max_output_chars: int = 10_000) -> None:
        self._tools: dict[str, Tool] = {}
        self.max_output_chars = max_output_chars

    def register(self, tool: Tool) -> None:
        if tool.name in self._tools:
            raise ValueError(f"tool already registered: {tool.name}")
        self._tools[tool.name] = tool

    def register_all(self, tools: list[Tool]) -> None:
        for tool in tools:
            self.register(tool)

    def get(self, name: str) -> Tool | None:
        return self._tools.get(name)

    def names(self) -> list[str]:
        return list(self._tools)

    def set_deadline(self, deadline: float) -> None:
        for tool in self._tools.values():
            tool.execution_deadline = deadline

    def schemas(self) -> list[dict[str, Any]]:
        return [tool.schema() for tool in self._tools.values()]

    def execute(self, call: ToolCall) -> ToolResult:
        started = time.monotonic()
        tool = self._tools.get(call.name)
        if tool is None:
            return ToolResult(
                success=False,
                error=f"unknown tool: {call.name}. Available tools: {', '.join(self._tools)}",
                metadata={"tool": call.name, "invalid_kind": "unknown_tool"},
                duration_ms=int((time.monotonic() - started) * 1000),
            )
        try:
            tool.validate(call.arguments)
        except ToolArgumentError as exc:
            return ToolResult(
                success=False,
                error=f"invalid arguments for {call.name}: {exc}",
                metadata={
                    "tool": call.name,
                    "invalid_kind": "invalid_arguments",
                    "arguments": call.arguments,
                },
                duration_ms=int((time.monotonic() - started) * 1000),
            )
        try:
            result = tool.execute(**call.arguments)
        except Exception as exc:  # a tool bug is an observation, not a crash
            return ToolResult(
                success=False,
                error=f"{type(exc).__name__}: {exc}",
                metadata={"tool": call.name, "invalid_kind": "tool_exception"},
                duration_ms=int((time.monotonic() - started) * 1000),
            )
        if not isinstance(result, ToolResult):
            return ToolResult(
                success=False,
                error=f"tool {call.name} returned {type(result).__name__}, not ToolResult",
                metadata={"tool": call.name, "invalid_kind": "tool_contract"},
                duration_ms=int((time.monotonic() - started) * 1000),
            )
        result.metadata.setdefault("tool", call.name)
        if result.duration_ms == 0:
            result.duration_ms = int((time.monotonic() - started) * 1000)
        if len(result.output) > self.max_output_chars:
            result.output = (
                result.output[: self.max_output_chars]
                + f"\n... (tool output truncated at {self.max_output_chars} characters)"
            )
            result.metadata["output_truncated"] = True
        return result
