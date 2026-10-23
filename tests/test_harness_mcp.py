"""MCP adapter boundary: remote tools become native ToolResults."""

from __future__ import annotations

import sys
from pathlib import Path

from agent_replay.harness.registry import ToolRegistry
from agent_replay.harness.types import ToolCall
from agent_replay.mcp.adapter import MCPToolAdapter, load_mcp_tools
from agent_replay.mcp.client import InMemoryMCPClient, StdioMCPClient

SERVER = Path(__file__).parent / "fixtures" / "fake_mcp_server.py"


def _memory_client() -> InMemoryMCPClient:
    return InMemoryMCPClient(
        {
            "echo": {
                "description": "Echo text.",
                "inputSchema": {
                    "type": "object",
                    "properties": {"text": {"type": "string"}},
                    "required": ["text"],
                },
                "handler": lambda args: args.get("text", ""),
            },
            "fail": {
                "description": "Fails.",
                "inputSchema": {"type": "object", "properties": {}},
                "handler": lambda args: (_ for _ in ()).throw(ValueError("boom")),
            },
        }
    )


def test_in_memory_adapter_and_registry():
    client = _memory_client()
    adapters = load_mcp_tools(client, server="demo")
    assert [tool.name for tool in adapters] == ["mcp__demo__echo", "mcp__demo__fail"]

    registry = ToolRegistry()
    registry.register_all(adapters)
    ok = registry.execute(ToolCall("c1", "mcp__demo__echo", {"text": "hello"}))
    assert ok.success
    assert ok.output == "hello"
    assert ok.metadata["mcp_tool"] == "echo"

    bad = registry.execute(ToolCall("c2", "mcp__demo__fail", {}))
    assert not bad.success
    assert "boom" in (bad.error or "")


def test_stdio_client_roundtrip():
    client = StdioMCPClient([sys.executable, str(SERVER)], timeout_seconds=10)
    try:
        tools = client.list_tools()
        assert {tool["name"] for tool in tools} == {"echo", "fail"}
        result = client.call_tool("echo", {"text": "over stdio"})
        assert result["isError"] is False
        assert result["content"][0]["text"] == "over stdio"
        failed = client.call_tool("fail", {})
        assert failed["isError"] is True
    finally:
        client.close()


def test_stdio_adapter_uses_native_contract():
    client = StdioMCPClient([sys.executable, str(SERVER)], timeout_seconds=10)
    try:
        adapters = load_mcp_tools(client, server="stdio")
        echo = next(tool for tool in adapters if tool.name.endswith("echo"))
        result = echo.execute(text="adapter")
        assert result.success
        assert result.output == "adapter"
        assert isinstance(result.to_dict()["success"], bool)
    finally:
        client.close()


def test_client_requires_command():
    import pytest

    from agent_replay.mcp.client import MCPClientError

    with pytest.raises(MCPClientError):
        StdioMCPClient([])
