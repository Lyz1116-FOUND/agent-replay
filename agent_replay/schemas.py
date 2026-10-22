"""Pydantic schemas for the Agent Replay REST API."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field

PROMPT_TEMPLATES = ("default", "structured", "verify")


class TaskCreate(BaseModel):
    """Request body for ``POST /tasks``.

    ``task`` is a fixed task-set id (e.g. ``single-file-bug``). The task set is
    the source of truth for the instruction, verify command, and protected
    files; it keeps every run reproducible.
    """

    repo: str | None = Field(None, description="Optional repository label for metadata.")
    task: str = Field(..., min_length=1, description="Fixed task-set id.")
    prompt_template: str = Field("default", description="default | structured | verify")
    metadata: dict[str, Any] = Field(default_factory=dict)


class Task(BaseModel):
    task_id: str
    status: str
    repo: str | None
    task: str
    prompt_template: str
    metadata: dict[str, Any]
    created_at: str
    runs: list[str] = Field(default_factory=list)


class RunStartResponse(BaseModel):
    task_id: str
    run_id: str
    status: str


class TestResult(BaseModel):
    # Not a pytest test case: the leading "Test" would otherwise be collected.
    __test__ = False

    passed: int
    failed: int
    total: int
    exit_code: int | None = None


class Evaluation(BaseModel):
    status: str
    reason: str | None = None
    tampered: bool = False


class Usage(BaseModel):
    input: int
    output: int
    total: int


class Run(BaseModel):
    run_id: str
    task_id: str  # the stored task's id (POST /tasks returns this)
    task_ref: str | None = None  # the fixed task-set id this run actually executed
    status: str
    success: bool
    latency_ms: int
    prompt_name: str
    adapter: str
    model: str
    test_result: TestResult | None = None
    evaluation: Evaluation | None = None
    usage: Usage | None = None
    files_changed: list[str] = Field(default_factory=list)
    termination: dict[str, Any] | None = None
    trace: str | None = None  # persisted trace path, for replay


class Health(BaseModel):
    status: str
