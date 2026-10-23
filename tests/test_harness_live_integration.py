"""Harness + OpenAI-compatible client against a local fake endpoint."""

from __future__ import annotations

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from agent_replay.harness.loop import AgentHarness
from agent_replay.harness.model_client import OpenAICompatibleModel
from tests.harness_helpers import make_calc_task


def _tool_call(call_id: str, name: str, arguments: dict) -> dict:
    return {
        "id": call_id,
        "type": "function",
        "function": {"name": name, "arguments": json.dumps(arguments)},
    }


def _response(message: dict, finish: str, prompt: int, completion: int) -> dict:
    return {
        "id": "resp",
        "model": "fake",
        "choices": [{"message": message, "finish_reason": finish}],
        "usage": {
            "prompt_tokens": prompt,
            "completion_tokens": completion,
            "total_tokens": prompt + completion,
        },
    }


def test_harness_with_openai_compatible_endpoint(tmp_path, harness_config):
    fixed = "def add(a, b):\n    return a + b\n"
    responses = [
        _response(
            {
                "role": "assistant",
                "content": None,
                "tool_calls": [_tool_call("c1", "read_file", {"path": "src/calc.py"})],
            },
            "tool_calls",
            10,
            2,
        ),
        _response(
            {
                "role": "assistant",
                "content": None,
                "tool_calls": [
                    _tool_call(
                        "c2",
                        "write_file",
                        {"path": "src/calc.py", "content": fixed},
                    )
                ],
            },
            "tool_calls",
            20,
            8,
        ),
        _response(
            {
                "role": "assistant",
                "content": None,
                "tool_calls": [_tool_call("c3", "run_tests", {})],
            },
            "tool_calls",
            30,
            4,
        ),
        _response(
            {"role": "assistant", "content": "Done."},
            "stop",
            40,
            2,
        ),
    ]
    requests: list[dict] = []

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            length = int(self.headers.get("Content-Length", "0"))
            requests.append(json.loads(self.rfile.read(length)))
            payload = responses[min(len(requests) - 1, len(responses) - 1)]
            raw = json.dumps(payload).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

        def log_message(self, *args):
            return None

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        model = OpenAICompatibleModel(
            model="fake",
            base_url=f"http://127.0.0.1:{server.server_port}/v1",
            max_retries=0,
        )
        task = make_calc_task(tmp_path)
        config = harness_config.with_overrides(model_backend="openai", max_retries=0)
        result = AgentHarness(task, config, model=model).run()
    finally:
        server.shutdown()

    assert result.success is True
    assert result.model_calls == 4
    assert result.usage.reported is True
    assert result.usage.input_tokens == 100
    assert result.usage.output_tokens == 16
    assert result.tests["passed"] == 1
    assert len(requests) == 4
    assert requests[0]["messages"][0]["role"] == "system"
