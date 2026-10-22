"""Tests for the executor's repository preparation (strict git mode)."""

from __future__ import annotations

import pytest

import agent_replay.core.executor as ex


def _make_task_dir(tmp_path):
    task_dir = tmp_path / "task"
    task_dir.mkdir()
    (task_dir / "calc.mjs").write_text("export function f() { return 0 }\n", encoding="utf-8")
    (task_dir / "test.mjs").write_text("import test from 'node:test'\n", encoding="utf-8")
    (task_dir / "task.json").write_text('{"id": "t"}', encoding="utf-8")
    ref = task_dir / "reference"
    ref.mkdir()
    (ref / "calc.mjs").write_text("ref", encoding="utf-8")
    return task_dir


def test_prepare_repo_creates_git_repo(tmp_path):
    dest = tmp_path / "dest"
    ex.prepare_repo(_make_task_dir(tmp_path), dest)

    # Task files copied; task.json and reference/ excluded from the agent view.
    assert (dest / "calc.mjs").exists()
    assert (dest / "test.mjs").exists()
    assert not (dest / "task.json").exists()
    assert not (dest / "reference").exists()
    # A clean git repo is required for verified diffs.
    assert (dest / ".git").exists()


def test_prepare_repo_refuses_existing_dest(tmp_path):
    dest = tmp_path / "dest"
    dest.mkdir()
    with pytest.raises(RuntimeError):
        ex.prepare_repo(_make_task_dir(tmp_path), dest)


def test_prepare_repo_raises_on_git_failure(tmp_path, monkeypatch):
    def fake_git(cwd, *args):
        return False, "git failed"

    monkeypatch.setattr(ex, "_git", fake_git)
    with pytest.raises(RuntimeError, match="git init"):
        ex.prepare_repo(_make_task_dir(tmp_path), tmp_path / "dest")
