"""Shared helpers for harness tests."""

from __future__ import annotations

from pathlib import Path

from agent_replay.harness.config import HarnessConfig
from agent_replay.harness.loop import AgentHarness
from agent_replay.harness.model_client import ScriptedModel
from agent_replay.harness.types import TaskSpec
from agent_replay.tools.test_parsing import run_test_command

PYTEST_INI = "[pytest]\ntestpaths = tests\npythonpath = src\n"
GITIGNORE = "__pycache__/\n*.pyc\n.pytest_cache/\n"
TEST_COMMAND = "{python} -m pytest -q -c pytest.ini"


def make_calc_task(
    tmp_path: Path,
    *,
    buggy: str = "def add(a, b):\n    return a - b\n",
    fixed: str = "def add(a, b):\n    return a + b\n",
    tests: str = "from calc import add\n\ndef test_add():\n    assert add(2, 3) == 5\n",
    task_id: str = "toy_calc",
) -> TaskSpec:
    root = tmp_path / f"repo-{task_id}"
    (root / "src").mkdir(parents=True)
    (root / "tests").mkdir()
    (root / "src" / "calc.py").write_text(buggy, encoding="utf-8")
    (root / "tests" / "test_calc.py").write_text(tests, encoding="utf-8")
    (root / "reference" / "src").mkdir(parents=True)
    (root / "reference" / "src" / "calc.py").write_text(fixed, encoding="utf-8")
    (root / "pytest.ini").write_text(PYTEST_INI, encoding="utf-8")
    (root / ".gitignore").write_text(GITIGNORE, encoding="utf-8")
    return TaskSpec(
        task_id=task_id,
        repo_path=str(root),
        instruction="Fix the failing test in src/calc.py. Do not modify tests.",
        test_command=TEST_COMMAND,
        timeout_seconds=60,
        protected_paths=("tests/", "pytest.ini"),
        expected_paths=("src/calc.py",),
        metadata={"title": "Toy calc", "kind": "bug", "tags": ["python", "pytest", "test"]},
    )


def run_scripted(
    task: TaskSpec,
    config: HarnessConfig,
    actions: list[dict],
    **kwargs,
):
    return AgentHarness(
        task,
        config,
        model=ScriptedModel(actions),
        **kwargs,
    ).run()


def oracle_actions(fixed: str = "def add(a, b):\n    return a + b\n") -> list[dict]:
    return [
        {"tool": "read_file", "arguments": {"path": "src/calc.py"}},
        {
            "tool": "write_file",
            "arguments": {"path": "src/calc.py", "content": fixed},
        },
        {"tool": "run_tests", "arguments": {}},
        {"text": "Done."},
    ]


def failing_actions() -> list[dict]:
    return [{"text": "I believe it is fixed."}]


def test_report(task: TaskSpec, workspace_root: Path) -> dict:
    return run_test_command(
        task.test_command or "",
        str(workspace_root),
        timeout_seconds=30,
    ).to_dict()
