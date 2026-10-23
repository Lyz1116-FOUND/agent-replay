"""Tiny newline-delimited JSON-RPC MCP server for adapter tests."""

from __future__ import annotations

import json
import sys


def respond(request_id, result):
    sys.stdout.write(json.dumps({"jsonrpc": "2.0", "id": request_id, "result": result}) + "\n")
    sys.stdout.flush()


for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    message = json.loads(line)
    if "id" not in message:
        continue
    request_id = message["id"]
    method = message.get("method")
    if method == "initialize":
        respond(
            request_id,
            {
                "protocolVersion": "2024-11-05",
                "capabilities": {"tools": {}},
                "serverInfo": {"name": "fake", "version": "0"},
            },
        )
    elif method == "tools/list":
        respond(
            request_id,
            {
                "tools": [
                    {
                        "name": "echo",
                        "description": "Echo text.",
                        "inputSchema": {
                            "type": "object",
                            "properties": {"text": {"type": "string"}},
                            "required": ["text"],
                            "additionalProperties": False,
                        },
                    },
                    {
                        "name": "fail",
                        "description": "Always fails.",
                        "inputSchema": {"type": "object", "properties": {}},
                    },
                ]
            },
        )
    elif method == "tools/call":
        params = message.get("params") or {}
        name = params.get("name")
        arguments = params.get("arguments") or {}
        if name == "echo":
            respond(
                request_id,
                {
                    "content": [{"type": "text", "text": arguments.get("text", "")}],
                    "isError": False,
                },
            )
        else:
            respond(
                request_id,
                {
                    "content": [{"type": "text", "text": "intentional failure"}],
                    "isError": True,
                },
            )
    else:
        sys.stdout.write(
            json.dumps(
                {
                    "jsonrpc": "2.0",
                    "id": request_id,
                    "error": {"code": -32601, "message": "method not found"},
                }
            )
            + "\n"
        )
        sys.stdout.flush()
