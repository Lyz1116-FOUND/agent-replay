"""Persistent memory is separate from model context."""

from __future__ import annotations

import json
from pathlib import Path

from agent_replay.harness.memory import MemoryStore
from tests.harness_helpers import failing_actions, make_calc_task, oracle_actions, run_scripted


def test_memory_store_roundtrip_and_search(tmp_path):
    path = tmp_path / "memory.json"
    store = MemoryStore(path)
    store.put("run-1", {"task_id": "toy", "status": "failed"}, tags=["toy", "failure"])
    store.put("run-2", {"task_id": "other", "status": "passed"}, tags=["other"])

    assert store.get("run-1")["status"] == "failed"
    assert [entry.key for entry in store.search("FAILED")] == ["run-1"]
    assert [entry.key for entry in store.search("other")] == ["run-2"]

    reopened = MemoryStore(path)
    assert reopened.get("run-1")["task_id"] == "toy"
    payload = json.loads(path.read_text())
    assert payload["version"] == 1
    assert len(payload["entries"]) == 2

    assert reopened.delete("run-1") is True
    assert reopened.get("run-1") is None


def test_harness_recalls_prior_run_and_writes_memory(tmp_path, harness_config):
    task = make_calc_task(tmp_path)
    memory_path = tmp_path / "harness-memory.json"
    config = harness_config.with_overrides(memory_path=memory_path, max_retries=0)

    first = run_scripted(task, config, failing_actions())
    assert first.success is False
    assert memory_path.is_file()
    assert MemoryStore(memory_path).search(task.task_id)

    second = run_scripted(task, config, oracle_actions())
    assert second.success is True
    assert second.metadata["memory_path"] == str(memory_path)

    messages = [
        json.loads(line)
        for line in (Path(second.run_dir) / "messages.jsonl").read_text().splitlines()
    ]
    system = next(message for message in messages if message["role"] == "system")
    assert "Prior harness memory" in system["content"]
    assert first.run_id in system["content"]
    events = [
        json.loads(line)
        for line in (Path(second.run_dir) / "events.jsonl").read_text().splitlines()
    ]
    assert any(event["type"] == "memory_recalled" for event in events)
    assert any(event["type"] == "memory_written" for event in events)
    assert len(MemoryStore(memory_path).all()) == 2
