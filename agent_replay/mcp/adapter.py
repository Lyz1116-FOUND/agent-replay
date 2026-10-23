"""Expose MCP tools through the native ``Tool`` interface.

The registry does not know whether a tool is local or remote. An MCP tool is
just another ``Tool.execute() -> ToolResult`` implementation.
"""

from __future__ import annotations

import json
import re
import time
from typing import Any, Protocol

from ..harness.types import ToolResult
from ..tools.base import Tool


class MCPClient(Protocol):
    def list_tools(self) -> list[dict[str, Any]]: ...
    def call_tool(self, name: str, arguments: dict[str, Any]) -> dict[str, Any]: ...


def _safe_name(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9_-]", "_", value)


class MCPToolAdapter(Tool):
    def __init__(
        self,
        client: MCPClient,
        *,
        remote_name: str,
        alias: str,
        description: str = "",
        input_schema: dict[str, Any] | None = None,
        server: str = "mcp",
    ) -> None:
        self.client = client
        self.remote_name = remote_name
        self.name = alias
        self.description = description or f"MCP tool {remote_name} from {server}."
        self.parameters = input_schema or {"type": "object", "properties": {}}
        self.server = server

    @classmethod
    def from_remote(
        cls,
        client: MCPClient,
        tool: dict[str, Any],
        *,
        server: str = "mcp",
        prefix: str | None = None,
    ) -> "MCPToolAdapter":
        remote_name = str(tool.get("name") or "")
        label = prefix or server
        alias = f"mcp__{_safe_name(label)}__{_safe_name(remote_name)}"
        return cls(
            client,
            remote_name=remote_name,
            alias=alias,
            description=str(tool.get("description") or ""),
            input_schema=tool.get("inputSchema")
            if isinstance(tool.get("inputSchema"), dict)
            else None,
            server=server,
        )

    def execute(self, **kwargs: Any) -> ToolResult:
        started = time.monotonic()
        try:
            if hasattr(self.client, "execution_deadline"):
                self.client.execution_deadline = self.execution_deadline
            result = self.client.call_tool(self.remote_name, kwargs)
        except Exception as exc:
            return ToolResult(
                success=False,
                error=f"MCP tool failed: {type(exc).__name__}: {exc}",
                metadata={"mcp_server": self.server, "mcp_tool": self.remote_name},
                duration_ms=int((time.monotonic() - started) * 1000),
            )
        blocks = result.get("content") or []
        parts: list[str] = []
        for block in blocks:
            if isinstance(block, dict) and block.get("type") == "text":
                parts.append(str(block.get("text", "")))
            else:
                parts.append(json.dumps(block, ensure_ascii=False, default=str))
        output = "\n".join(parts)
        is_error = bool(result.get("isError"))
        structured = result.get("structuredContent")
        if structured is not None:
            output = output or json.dumps(structured, ensure_ascii=False)
        return ToolResult(
            success=not is_error,
            output=output,
            error=output if is_error else None,
            metadata={
                "mcp_server": self.server,
                "mcp_tool": self.remote_name,
                "structured_content": structured,
            },
            duration_ms=int((time.monotonic() - started) * 1000),
        )


def load_mcp_tools(
    client: MCPClient, *, server: str = "mcp", prefix: str | None = None
) -> list[MCPToolAdapter]:
    return [
        MCPToolAdapter.from_remote(client, tool, server=server, prefix=prefix)
        for tool in client.list_tools()
    ]
