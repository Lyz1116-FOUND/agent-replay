"""Core execution and evaluation, shared by the API and the experiment harness."""

from .executor import (
    Evaluation,
    RunOutcome,
    VerifyResult,
    evaluate_task,
    load_trace,
    parse_test_output,
    prepare_repo,
    run_task,
)
from .taskset import TaskSpec, load_tasks

__all__ = [
    "Evaluation",
    "RunOutcome",
    "TaskSpec",
    "VerifyResult",
    "evaluate_task",
    "load_tasks",
    "load_trace",
    "parse_test_output",
    "prepare_repo",
    "run_task",
]
