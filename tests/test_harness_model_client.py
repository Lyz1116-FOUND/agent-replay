"""OpenAI-compatible response parsing and the scripted fixture model."""

from __future__ import annotations

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from agent_replay.harness.config import HarnessConfig
from agent_replay.harness.errors import ModelError
from agent_replay.harness.model_client import (
    OpenAICompatibleModel,
    ScriptedModel,
    model_from_config,
)


def _server(responses: list[tuple[int, dict]]):
    requests: list[dict] = []

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            length = int(self.headers.get("Content-Length", "0"))
            body = json.loads(self.rfile.read(length))
            requests.append({"body": body, "headers": dict(self.headers)})
            index = min(len(requests) - 1, len(responses) - 1)
            status, payload = responses[index]
            raw = json.dumps(payload).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

        def log_message(self, *args):
            return None

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, requests


def _response(message: dict, usage: dict | None = None, finish: str = "tool_calls") -> dict:
    return {
        "id": "resp-1",
        "model": "test-model",
        "choices": [{"message": message, "finish_reason": finish}],
        "usage": usage or {},
    }


def test_openai_client_parses_tool_calls_and_usage():
    server, requests = _server(
        [
            (
                200,
                _response(
                    {
                        "role": "assistant",
                        "content": "thinking",
                        "tool_calls": [
                            {
                                "id": "call_9",
                                "type": "function",
                                "function": {
                                    "name": "read_file",
                                    "arguments": '{"path": "src/calc.py"}',
                                },
                            }
                        ],
                    },
                    {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15},
                ),
            )
        ]
    )
    try:
        client = OpenAICompatibleModel(
            model="test-model",
            base_url=f"http://127.0.0.1:{server.server_port}/v1",
            api_key="secret",
            max_retries=0,
        )
        turn = client.complete(
            [{"role": "user", "content": "hi"}],
            [{"type": "function", "function": {"name": "read_file", "parameters": {}}}],
        )
    finally:
        server.shutdown()
    assert turn.text == "thinking"
    assert turn.tool_calls[0].name == "read_file"
    assert turn.tool_calls[0].arguments == {"path": "src/calc.py"}
    assert turn.usage.input_tokens == 10
    assert turn.usage.total == 15
    assert turn.usage.reported is True
    assert requests[0]["headers"]["Authorization"] == "Bearer secret"
    assert requests[0]["body"]["tools"][0]["function"]["name"] == "read_file"


def test_openai_client_malformed_arguments_are_visible():
    server, _ = _server(
        [
            (
                200,
                _response(
                    {
                        "role": "assistant",
                        "content": None,
                        "tool_calls": [
                            {
                                "id": "call_bad",
                                "type": "function",
                                "function": {"name": "read_file", "arguments": "{not json"},
                            }
                        ],
                    }
                ),
            )
        ]
    )
    try:
        client = OpenAICompatibleModel(
            model="m",
            base_url=f"http://127.0.0.1:{server.server_port}/v1",
            max_retries=0,
        )
        turn = client.complete([{"role": "user", "content": "hi"}], [])
    finally:
        server.shutdown()
    assert turn.tool_calls[0].arguments == {}
    assert turn.tool_calls[0].raw_arguments == "{not json"


def test_openai_client_retries_retryable_status(monkeypatch):
    monkeypatch.setattr("agent_replay.harness.model_client.time.sleep", lambda _: None)
    server, requests = _server(
        [
            (500, {"error": "temporary"}),
            (
                200,
                _response(
                    {"role": "assistant", "content": "ok"},
                    {"prompt_tokens": 1, "completion_tokens": 1},
                    finish="stop",
                ),
            ),
        ]
    )
    try:
        client = OpenAICompatibleModel(
            model="m",
            base_url=f"http://127.0.0.1:{server.server_port}/v1",
            max_retries=1,
        )
        turn = client.complete([{"role": "user", "content": "hi"}], [])
    finally:
        server.shutdown()
    assert turn.text == "ok"
    assert len(requests) == 2


def test_openai_client_non_retryable_error():
    server, _ = _server([(400, {"error": "bad request"})])
    try:
        client = OpenAICompatibleModel(
            model="m",
            base_url=f"http://127.0.0.1:{server.server_port}/v1",
            max_retries=3,
        )
        with pytest.raises(ModelError, match="HTTP 400"):
            client.complete([{"role": "user", "content": "hi"}], [])
    finally:
        server.shutdown()


def test_base_url_is_required():
    with pytest.raises(ModelError):
        OpenAICompatibleModel(model="m", base_url="")
    config = HarnessConfig.from_env().with_overrides(model_base_url=None)
    with pytest.raises(ModelError):
        model_from_config(config)


def test_scripted_model_reports_no_usage_and_queues_actions():
    model = ScriptedModel([{"tool": "read_file", "arguments": {"path": "a"}}])
    turn = model.complete([], [])
    assert turn.tool_calls[0].name == "read_file"
    assert turn.usage.reported is False
    exhausted = model.complete([], [])
    assert exhausted.requests_finish
