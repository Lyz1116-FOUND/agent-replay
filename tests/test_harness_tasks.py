"""The fixed harness task set is valid and reproducible."""

from __future__ import annotations

from pathlib import Path

from agent_replay.harness.tasks import load_tasks, validate_task

TASKS_DIR = Path(__file__).resolve().parents[1] / "examples" / "harness_tasks"


def test_task_set_shape():
    tasks = load_tasks(TASKS_DIR)
    assert len(tasks) == 10
    assert len({task.task_id for task in tasks}) == 10
    for task in tasks:
        assert task.test_command
        assert task.protected_paths == ("tests/", "pytest.ini")
        assert task.expected_paths
        assert (Path(task.repo_path) / "CONTEXT.md").is_file()
        assert (Path(task.repo_path) / "reference").is_dir()
        assert task.metadata["kind"] in ("bug", "feature")
        assert task.tags


def test_all_tasks_fail_at_baseline_and_pass_with_reference():
    tasks = load_tasks(TASKS_DIR)
    for task in tasks:
        result = validate_task(task)
        baseline = result["baseline"]
        reference = result["reference"]
        assert baseline["status"] == "fail", task.task_id
        assert reference["status"] == "pass", task.task_id
        assert reference["failed"] == 0
        assert result["reference_files"], task.task_id
        assert result["valid"] is True


def test_load_filter_and_multi_file_expectation():
    tasks = load_tasks(TASKS_DIR, only=["task_002_multi_file"])
    assert [task.task_id for task in tasks] == ["task_002_multi_file"]
    assert len(tasks[0].expected_paths) == 2
    assert set(tasks[0].expected_paths) == {
        "src/pricing/config.py",
        "src/pricing/checkout.py",
    }
