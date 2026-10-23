"""Minimal MCP clients.

``StdioMCPClient`` speaks newline-delimited JSON-RPC to a local MCP server and
implements the three calls the adapter needs: initialize, tools/list, and
tools/call. It is intentionally small; the adapter boundary is the important
part, not a full protocol SDK.
"""

from __future__ import annotations

import json
import os
import select
import subprocess
import threading
import time
from typing import Any, Callable


class MCPClientError(RuntimeError):
    pass


class InMemoryMCPClient:
    """Test/demo client with local handlers implementing the same contract."""

    def __init__(self, tools: dict[str, dict[str, Any]]) -> None:
        self.tools = tools

    def list_tools(self) -> list[dict[str, Any]]:
        return [
            {
                "name": name,
                "description": spec.get("description", ""),
                "inputSchema": spec.get("inputSchema", {"type": "object"}),
            }
            for name, spec in self.tools.items()
        ]

    def call_tool(self, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        spec = self.tools.get(name)
        if spec is None:
            return {
                "isError": True,
                "content": [{"type": "text", "text": f"unknown tool: {name}"}],
            }
        handler: Callable[[dict[str, Any]], Any] = spec.get("handler") or (lambda args: "")
        try:
            value = handler(arguments)
        except Exception as exc:
            return {
                "isError": True,
                "content": [{"type": "text", "text": f"{type(exc).__name__}: {exc}"}],
            }
        if isinstance(value, dict):
            return {
                "isError": False,
                "content": [{"type": "text", "text": json.dumps(value, ensure_ascii=False)}],
                "structuredContent": value,
            }
        return {"isError": False, "content": [{"type": "text", "text": str(value)}]}

    def close(self) -> None:
        return None


class StdioMCPClient:
    def __init__(self, command: list[str], *, timeout_seconds: int = 30) -> None:
        if not command:
            raise MCPClientError("MCP command is empty")
        self.command = command
        self.timeout_seconds = timeout_seconds
        self._process: subprocess.Popen[str] | None = None
        self._next_id = 0
        self._lock = threading.Lock()
        self._read_buffer = b""
        self.execution_deadline: float | None = None

    def _start(self) -> None:
        if self._process is not None:
            return
        try:
            self._process = subprocess.Popen(
                self.command,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                text=True,
                bufsize=1,
                env=dict(os.environ),
            )
        except OSError as exc:
            raise MCPClientError(f"failed to start MCP server: {exc}") from exc
        self._request(
            "initialize",
            {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {"name": "agent-replay-harness", "version": "1.0"},
            },
        )
        self._write({"jsonrpc": "2.0", "method": "notifications/initialized"})

    def _write(self, message: dict[str, Any]) -> None:
        if self._process is None or self._process.stdin is None:
            raise MCPClientError("MCP server is not running")
        self._process.stdin.write(json.dumps(message, ensure_ascii=False) + "\n")
        self._process.stdin.flush()

    def _read_response(self, request_id: int) -> dict[str, Any]:
        if self._process is None or self._process.stdout is None:
            raise MCPClientError("MCP server is not running")
        deadline = time.monotonic() + self.timeout_seconds
        if self.execution_deadline is not None:
            deadline = min(deadline, self.execution_deadline)
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise MCPClientError("MCP request timed out")
            if b"\n" not in self._read_buffer:
                ready, _, _ = select.select([self._process.stdout], [], [], remaining)
                if not ready:
                    raise MCPClientError("MCP request timed out")
                chunk = os.read(self._process.stdout.fileno(), 65536)
                if not chunk:
                    raise MCPClientError("MCP server closed the connection")
                self._read_buffer += chunk
                if len(self._read_buffer) > 4_000_000:
                    raise MCPClientError("MCP response exceeds the size limit")
                continue
            raw, self._read_buffer = self._read_buffer.split(b"\n", 1)
            line = raw.decode("utf-8", errors="replace")
            line = line.strip()
            if not line:
                continue
            try:
                message = json.loads(line)
            except json.JSONDecodeError:
                continue
            if not isinstance(message, dict) or message.get("id") != request_id:
                continue
            if message.get("error"):
                raise MCPClientError(f"MCP error: {message['error']}")
            return message.get("result") or {}

    def _request(self, method: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        with self._lock:
            self._next_id += 1
            request_id = self._next_id
            self._write(
                {
                    "jsonrpc": "2.0",
                    "id": request_id,
                    "method": method,
                    "params": params or {},
                }
            )
            return self._read_response(request_id)

    def list_tools(self) -> list[dict[str, Any]]:
        self._start()
        result = self._request("tools/list", {})
        return list(result.get("tools") or [])

    def call_tool(self, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        self._start()
        return self._request("tools/call", {"name": name, "arguments": arguments})

    def close(self) -> None:
        with self._lock:
            if self._process is None:
                return
            try:
                if self._process.stdin:
                    self._process.stdin.close()
                self._process.wait(timeout=1)
            except (OSError, subprocess.TimeoutExpired):
                self._process.terminate()
                try:
                    self._process.wait(timeout=1)
                except subprocess.TimeoutExpired:
                    self._process.kill()
                    self._process.wait()
            finally:
                for stream in (self._process.stdin, self._process.stdout):
                    if stream:
                        stream.close()
                self._process = None
                self._read_buffer = b""

    def __enter__(self) -> "StdioMCPClient":
        self._start()
        return self

    def __exit__(self, *_: Any) -> None:
        self.close()
