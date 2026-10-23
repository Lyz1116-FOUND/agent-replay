"""Workspace containment and the six built-in tools."""

from __future__ import annotations

import os
from pathlib import Path

import pytest

from agent_replay.harness.errors import WorkspaceError
from agent_replay.harness.registry import ToolRegistry
from agent_replay.harness.types import ToolCall, ToolResult
from agent_replay.harness.workspace import TaskWorkspace
from agent_replay.tools.base import Tool
from agent_replay.tools.builtin import build_default_registry
from tests.harness_helpers import make_calc_task


@pytest.fixture
def workspace(tmp_path):
    task = make_calc_task(tmp_path)
    return TaskWorkspace.prepare(Path(task.repo_path), tmp_path / "work")


def test_prepare_excludes_task_metadata_and_reference(tmp_path, workspace):
    assert (workspace.root / "src" / "calc.py").is_file()
    assert (workspace.root / ".git").is_dir()
    assert not (workspace.root / "reference").exists()
    assert not (workspace.root / "task.json").exists()
    assert workspace.changed_files() == []


def test_path_containment(workspace, tmp_path):
    for path in ("../escape", "/etc/passwd", ".git/config"):
        with pytest.raises(WorkspaceError):
            workspace.resolve(path)
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "secret.txt").write_text("secret", encoding="utf-8")
    (workspace.root / "link").symlink_to(outside)
    with pytest.raises(WorkspaceError):
        workspace.resolve("link/secret.txt")
    with pytest.raises(WorkspaceError):
        workspace.resolve("missing.py", must_exist=True)


def test_read_file_range_and_metadata(workspace):
    tool = build_default_registry(workspace, test_command="true")
    read = tool.get("read_file")
    result = read.execute(path="src/calc.py", start_line=1, end_line=1)
    assert result.success
    assert "def add" in result.output
    assert result.metadata["start_line"] == 1
    assert result.metadata["total_lines"] >= 2

    failure = read.execute(path="../secret")
    assert not failure.success
    assert "parent traversal" in (failure.error or "")


def test_grep_literal_regex_and_limits(workspace, tmp_path):
    tool = build_default_registry(workspace, test_command="true").get("grep")
    outside = tmp_path / "outside-grep"
    outside.mkdir()
    (outside / "secret.py").write_text("SECRET_OUTSIDE = 1\n", encoding="utf-8")
    (workspace.root / "outside-link").symlink_to(outside)
    escaped = tool.execute(query="SECRET_OUTSIDE", path=".")
    assert escaped.success
    assert escaped.metadata["count"] == 0

    result = tool.execute(query="return", path="src", max_results=5)
    assert result.success
    assert result.metadata["count"] == 1
    assert "src/calc.py:2" in result.output

    regex = tool.execute(query=r"def\s+add", path=".", regex=True)
    assert regex.success
    assert regex.metadata["count"] == 1

    bad = tool.execute(query="[", regex=True)
    assert not bad.success


def test_write_file_and_git_diff(workspace):
    registry = build_default_registry(workspace, test_command="true")
    write = registry.get("write_file")
    result = write.execute(path="src/new.py", content="VALUE = 1\n")
    assert result.success
    assert result.metadata["created"] is True
    assert "src/new.py" in workspace.changed_files()

    write.execute(path="src/new.py", content="VALUE = 2\n")
    assert "VALUE = 2" in (workspace.root / "src" / "new.py").read_text(encoding="utf-8")
    diff = registry.get("git_diff").execute()
    assert diff.success
    assert "src/new.py" in diff.output
    assert "VALUE = 2" in diff.output


def test_shell_bounds_and_denylist(workspace):
    shell = build_default_registry(workspace, test_command="true").get("shell")
    ok = shell.execute(command="pwd")
    assert ok.success
    assert str(workspace.root) in ok.output
    assert ok.metadata["exit_code"] == 0

    escape = shell.execute(command="pwd", cwd="..")
    assert not escape.success

    denied = shell.execute(command="sudo pwd")
    assert not denied.success
    assert "sudo" in (denied.error or "")

    timed = shell.execute(
        command="{python} -c 'import time; time.sleep(2)'",
        timeout_seconds=1,
    )
    assert not timed.success
    assert timed.metadata.get("timed_out") is True, timed


def test_shell_strips_credentials(workspace, monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "should-not-leak")
    shell = build_default_registry(workspace, test_command="true").get("shell")
    result = shell.execute(
        command="{python} -c \"import os; print(os.environ.get('OPENAI_API_KEY', 'missing'))\""
    )
    assert result.success
    assert result.output.strip() == "missing"


def test_run_tests_structured_result(workspace):
    registry = build_default_registry(
        workspace,
        test_command="{python} -m pytest -q -c pytest.ini",
    )
    failed = registry.get("run_tests").execute()
    assert failed.success  # execution succeeded; tests failed
    assert failed.metadata["status"] == "fail"
    assert failed.metadata["failed"] == 1
    assert failed.metadata["failed_tests"]

    registry.get("write_file").execute(
        path="src/calc.py", content="def add(a, b):\n    return a + b\n"
    )
    passed = registry.get("run_tests").execute()
    assert passed.metadata["status"] == "pass"
    assert passed.metadata["passed"] == 1


def test_registry_unknown_invalid_and_truncation(workspace):
    class Exploder(Tool):
        name = "explode"
        description = "raises"
        parameters = {"type": "object", "properties": {}}

        def execute(self, **kwargs):
            raise RuntimeError("boom")

    registry = build_default_registry(workspace, test_command="true")
    registry.max_output_chars = 40
    registry.register(Exploder())

    unknown = registry.execute(ToolCall("c1", "nope", {}))
    assert not unknown.success
    assert unknown.metadata["invalid_kind"] == "unknown_tool"

    invalid = registry.execute(ToolCall("c2", "read_file", {}))
    assert not invalid.success
    assert invalid.metadata["invalid_kind"] == "invalid_arguments"

    exploded = registry.execute(ToolCall("c3", "explode", {}))
    assert not exploded.success
    assert "boom" in (exploded.error or "")

    long = registry.execute(ToolCall("c4", "read_file", {"path": "src/calc.py"}))
    assert long.success
    assert long.metadata.get("output_truncated") is True
    assert len(long.output) < 200


def test_protected_snapshot_detects_changes(workspace):
    before = workspace.snapshot(("tests/", "pytest.ini"))
    (workspace.root / "tests" / "test_calc.py").write_text(
        "def test_anything():\n    assert True\n", encoding="utf-8"
    )
    modified = workspace.modified_since(before)
    assert "tests/test_calc.py" in modified

    before_clean = workspace.snapshot(("tests/", "pytest.ini"))
    (workspace.root / "tests" / "new_test.py").write_text("", encoding="utf-8")
    assert "tests/new_test.py" in workspace.modified_since(before_clean)


def test_shell_denylist_does_not_block_benign_git(workspace):
    shell = build_default_registry(workspace, test_command="true").get("shell")
    result = shell.execute(command="git status --short")
    assert result.success
    assert result.metadata["exit_code"] == 0
