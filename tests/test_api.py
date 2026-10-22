"""Tests for the FastAPI REST API (schema, task lifecycle, health, lookups)."""

from __future__ import annotations

from fastapi.testclient import TestClient

from agent_replay.schemas import Evaluation, Run, TestResult, Usage


def test_health(client: TestClient):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_create_task(client: TestClient):
    response = client.post(
        "/tasks", json={"task": "single-file-bug", "prompt_template": "structured"}
    )
    assert response.status_code == 201
    body = response.json()
    assert body["status"] == "created"
    assert body["task_id"]
    assert body["task"] == "single-file-bug"
    assert body["prompt_template"] == "structured"


def test_create_task_default_prompt(client: TestClient):
    response = client.post("/tasks", json={"task": "single-file-bug"})
    assert response.status_code == 201
    assert response.json()["prompt_template"] == "default"


def test_create_task_invalid_prompt_template(client: TestClient):
    response = client.post("/tasks", json={"task": "single-file-bug", "prompt_template": "nope"})
    assert response.status_code == 400


def test_create_task_unknown_task(client: TestClient):
    response = client.post("/tasks", json={"task": "does-not-exist"})
    assert response.status_code == 400


def test_create_task_missing_task_field(client: TestClient):
    response = client.post("/tasks", json={})
    assert response.status_code == 422  # Pydantic validation error


def test_get_task(client: TestClient):
    task_id = client.post("/tasks", json={"task": "single-file-bug"}).json()["task_id"]
    response = client.get(f"/tasks/{task_id}")
    assert response.status_code == 200
    assert response.json()["task_id"] == task_id


def test_get_task_not_found(client: TestClient):
    response = client.get("/tasks/does-not-exist")
    assert response.status_code == 404


def test_get_run_not_found(client: TestClient):
    response = client.get("/runs/does-not-exist")
    assert response.status_code == 404


def test_start_run_mocked(client: TestClient, monkeypatch):
    task_id = client.post("/tasks", json={"task": "single-file-bug"}).json()["task_id"]
    fake_run = Run(
        run_id="run-123",
        task_id=task_id,
        status="pass",
        success=True,
        latency_ms=1500,
        prompt_name="default",
        adapter="opencode",
        model="opencode/glm-5.3-flash-free",
        test_result=TestResult(passed=3, failed=0, total=3),
        evaluation=Evaluation(status="pass"),
        usage=Usage(input=100, output=50, total=150),
    )
    monkeypatch.setattr(client.app.state.run_service, "start_run", lambda _task_id: fake_run)

    response = client.post(f"/tasks/{task_id}/run")
    assert response.status_code == 200
    body = response.json()
    assert body["task_id"] == task_id
    assert body["run_id"] == "run-123"
    assert body["status"] == "completed"


def test_get_run_mocked(client: TestClient, monkeypatch):
    fake_run = Run(
        run_id="run-123",
        task_id="task-123",
        status="pass",
        success=True,
        latency_ms=1500,
        prompt_name="structured",
        adapter="opencode",
        model="opencode/glm-5.3-flash-free",
        test_result=TestResult(passed=3, failed=0, total=3),
        evaluation=Evaluation(status="pass"),
        usage=Usage(input=100, output=50, total=150),
    )
    monkeypatch.setattr(client.app.state.run_service, "get_run", lambda _run_id: fake_run)

    response = client.get("/runs/run-123")
    assert response.status_code == 200
    body = response.json()
    assert body["run_id"] == "run-123"
    assert body["success"] is True
    assert body["latency_ms"] == 1500
    assert body["usage"]["total"] == 150


def test_openapi_lists_all_endpoints(client: TestClient):
    paths = client.get("/openapi.json").json()["paths"]
    assert "/health" in paths
    assert "/tasks" in paths
    assert "/tasks/{task_id}" in paths
    assert "/tasks/{task_id}/run" in paths
    assert "/runs/{run_id}" in paths


def test_full_run_lifecycle_maps_task_ids(client: TestClient, monkeypatch):
    """End-to-end (with the agent mocked): the run must reference the stored
    task's uuid, not the task-set id, and expose the task-set id as task_ref."""
    from agent_replay.api.services import run_service as rs
    from agent_replay.core.executor import RunOutcome

    task_id = client.post(
        "/tasks", json={"task": "single-file-bug", "prompt_template": "structured"}
    ).json()["task_id"]

    def fake_run_task(settings, task, *, run_id, prompt, prompt_name, **kwargs):
        return RunOutcome(
            run_id=run_id,
            task_id=task.id,  # the task-set id, e.g. "single-file-bug"
            status="pass",
            success=True,
            reason=None,
            latency_ms=100,
            exit_code=0,
            prompt_name=prompt_name,
            adapter="opencode",
            model="m",
            verify={"command": "node --test", "exit_code": 0, "passed": 3, "failed": 0, "total": 3},
            usage={"input": 10, "output": 5, "total": 15},
            files_changed=["calc.mjs"],
            termination={"kind": "completed"},
            tampered=False,
            trace_path="/x/run.trace.json",
        )

    monkeypatch.setattr(rs, "run_task", fake_run_task)

    resp = client.post(f"/tasks/{task_id}/run")
    assert resp.status_code == 200
    run_id = resp.json()["run_id"]

    run = client.get(f"/runs/{run_id}").json()
    assert run["task_id"] == task_id  # the uuid returned by POST /tasks
    assert run["task_ref"] == "single-file-bug"  # the fixed task-set id
    assert run["success"] is True
    assert run["trace"] == "/x/run.trace.json"
