"""Harness CLI smoke tests."""

from __future__ import annotations

from pathlib import Path

from agent_replay.harness.cli import main


def test_list_command_lists_fixed_tasks(capsys):
    code = main(["list", "--backend", "scripted"])
    output = capsys.readouterr().out
    assert code == 0
    assert "task_001_add_bug" in output
    assert "task_010_word_count" in output


def test_run_command_scripted_end_to_end(tmp_path, capsys):
    code = main(
        [
            "run",
            "task_001_add_bug",
            "--backend",
            "scripted",
            "--runs-dir",
            str(tmp_path / "runs"),
            "--work-dir",
            str(tmp_path / "work"),
            "--cleanup",
        ]
    )
    output = capsys.readouterr().out
    assert code == 0
    assert "PASS" in output
    assert "steps:" in output
    assert "tokens: unavailable" in output
    assert "artifacts:" in output
    run_dirs = list((tmp_path / "runs").iterdir())
    assert len(run_dirs) == 1
    assert (run_dirs[0] / "trace.json").is_file()
    assert not (tmp_path / "work" / run_dirs[0].name).exists()


def test_validate_tasks_single(capsys):
    code = main(["validate-tasks", "--tasks", "task_004_parser_empty", "--backend", "scripted"])
    output = capsys.readouterr().out
    assert code == 0
    assert "valid" in output
    assert "baseline=fail" in output
    assert "reference=pass" in output
