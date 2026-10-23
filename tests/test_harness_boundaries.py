"""Regression checks for termination, cancellation and untrusted provider data."""
from __future__ import annotations

import subprocess
import sys

import pytest

from agent_replay.agents.reviewer import _parse_review
from agent_replay.context.truncation import enforce_budget, estimate_tokens
from agent_replay.harness.loop import AgentHarness
from agent_replay.harness.model_client import ScriptedModel
from tests.harness_helpers import make_calc_task


def test_context_budget_terminates_with_large_tool_arguments():
    # Isolate the old infinite loop so a regression fails instead of hanging CI.
    code = '''
from agent_replay.context.truncation import enforce_budget, estimate_tokens
messages = [
    {"role": "system", "content": "task"},
    {"role": "assistant", "content": "analysis", "tool_calls": [
        {"id": "x", "type": "function", "function": {
            "name": "write_file", "arguments": "x" * 10000}}]},
    {"role": "tool", "tool_call_id": "x", "content": "done"},
]
result, dropped, truncated = enforce_budget(messages, 256, 4)
assert estimate_tokens(result, 4) <= 256
assert not any(m.get("role") == "tool" for m in result)
assert dropped == 2
'''
    result = subprocess.run([sys.executable, '-c', code], capture_output=True, text=True, timeout=3)
    assert result.returncode == 0, result.stderr


def test_context_rejects_system_prompt_larger_than_budget():
    with pytest.raises(ValueError, match="system prompt"):
        enforce_budget([{"role": "system", "content": "x" * 5000}], 256, 4)


@pytest.mark.parametrize("value", ['"false"', '"true"', 'null', '0', '1', '[]', '{}'])
def test_review_requires_json_boolean(value):
    assert _parse_review('{"approved":' + value + '}') is None


def test_abort_stops_after_one_verification(tmp_path, harness_config):
    task = make_calc_task(tmp_path)
    result = AgentHarness(task, harness_config, model=ScriptedModel([]), abort_check=lambda: True).run()
    assert result.failure_reason == 'aborted'
    assert len(result.attempts) == 1
    assert result.model_calls == 0


def test_patch_and_changes_include_staged_and_committed_edits(tmp_path):
    from pathlib import Path
    from agent_replay.harness.workspace import TaskWorkspace
    task = make_calc_task(tmp_path)
    workspace = TaskWorkspace.prepare(Path(task.repo_path), tmp_path / 'work')
    baseline = workspace.baseline_commit()
    (workspace.root / 'src/calc.py').write_text('def add(a, b):\n    return a + b\n')
    workspace.git('add', 'src/calc.py')
    assert 'return a + b' in workspace.patch()
    workspace.git('commit', '-qm', 'agent commit')
    assert workspace.baseline_commit() == baseline
    assert workspace.changed_files() == ['src/calc.py']
    assert 'return a + b' in workspace.patch()


def test_prepare_preserves_escape_symlink_without_copying_target(tmp_path):
    from pathlib import Path
    from agent_replay.harness.workspace import TaskWorkspace
    from agent_replay.harness.errors import WorkspaceError
    task = make_calc_task(tmp_path)
    outside = tmp_path / 'outside.txt'
    outside.write_text('outside data')
    (Path(task.repo_path) / 'external.txt').symlink_to(outside)
    workspace = TaskWorkspace.prepare(Path(task.repo_path), tmp_path / 'work')
    assert (workspace.root / 'external.txt').is_symlink()
    with pytest.raises(WorkspaceError):
        workspace.resolve('external.txt')


def test_model_retries_share_deadline(monkeypatch):
    import urllib.error
    from agent_replay.harness.model_client import OpenAICompatibleModel
    from agent_replay.harness.errors import ModelError
    elapsed = [0.0]
    calls = []
    monkeypatch.setattr('agent_replay.harness.model_client.time.monotonic', lambda: elapsed[0])
    monkeypatch.setattr('agent_replay.harness.model_client.time.sleep', lambda seconds: elapsed.__setitem__(0, elapsed[0] + seconds))
    def fail(request, *, timeout):
        calls.append(timeout)
        elapsed[0] += 0.75
        raise urllib.error.URLError('transient')
    monkeypatch.setattr('urllib.request.urlopen', fail)
    with pytest.raises(ModelError):
        OpenAICompatibleModel(model='m', base_url='http://unused', max_retries=5).complete([], [], timeout_seconds=1)
    assert len(calls) == 1
    assert elapsed[0] <= 1


def test_posthoc_rejects_committed_test_tampering(tmp_path, harness_config):
    from pathlib import Path
    from agent_replay.harness.workspace import TaskWorkspace
    from agent_replay.evaluation.benchmark import _posthoc
    task = make_calc_task(tmp_path)
    workspace = TaskWorkspace.prepare(Path(task.repo_path), tmp_path / 'work')
    (workspace.root / 'tests/test_calc.py').write_text('def test_fake():\n    assert True\n')
    workspace.git('add', '.')
    workspace.git('commit', '-qm', 'tamper')
    report = _posthoc(workspace.root, task, harness_config)
    assert report['protected_modified']
    assert not report['verified_success']
    assert report['tests'] is None


def test_mcp_partial_line_honors_timeout():
    import time
    from agent_replay.mcp.client import StdioMCPClient, MCPClientError
    server = 'import sys,time; sys.stdout.write("{"); sys.stdout.flush(); time.sleep(10)'
    started = time.monotonic()
    client = StdioMCPClient([sys.executable, '-u', '-c', server], timeout_seconds=0.1)
    try:
        with pytest.raises(MCPClientError, match='timed out'):
            client.list_tools()
    finally:
        client.close()
    assert time.monotonic() - started < 3


def test_mcp_reads_notification_and_response_in_one_write():
    from agent_replay.mcp.client import StdioMCPClient
    server = '''import sys,json
for line in sys.stdin:
    message=json.loads(line)
    if 'id' not in message: continue
    notification={'jsonrpc':'2.0','method':'notifications/message'}
    response={'jsonrpc':'2.0','id':message['id'],'result':{'tools':[]}}
    sys.stdout.write(json.dumps(notification)+'\\n'+json.dumps(response)+'\\n')
    sys.stdout.flush()
'''
    with StdioMCPClient([sys.executable, '-u', '-c', server], timeout_seconds=1) as client:
        assert client.list_tools() == []


def test_skipped_batch_calls_receive_observations(tmp_path, harness_config):
    from agent_replay.harness.model_client import ModelClient
    from agent_replay.context.truncation import split_units
    class CheckingModel(ScriptedModel):
        def complete(self, messages, tools, *, timeout_seconds=None):
            for unit in split_units(messages):
                calls = unit[0].get('tool_calls') or []
                if calls:
                    assert {c['id'] for c in calls} == {m['tool_call_id'] for m in unit[1:]}
            return super().complete(messages, tools, timeout_seconds=timeout_seconds)
    repeated = {'tool': 'read_file', 'arguments': {'path': 'src/calc.py'}}
    actions = [repeated, repeated, {'tools': [
        {'name': 'read_file', 'arguments': {'path': 'src/calc.py'}},
        {'name': 'read_file', 'arguments': {'path': 'pytest.ini'}},
    ]}, {'text': 'Done'}]
    result = AgentHarness(make_calc_task(tmp_path), harness_config, model=CheckingModel(actions)).run()
    assert len(result.attempts) == 2


def test_shell_timeout_terminates_child_process(tmp_path):
    import shlex
    import time
    from pathlib import Path
    from agent_replay.harness.workspace import TaskWorkspace
    from agent_replay.tools.shell import ShellTool
    task = make_calc_task(tmp_path)
    workspace = TaskWorkspace.prepare(Path(task.repo_path), tmp_path / 'work')
    marker = workspace.root / 'survived.txt'
    child_code = "import time; from pathlib import Path; time.sleep(1.5); Path('survived.txt').write_text('child survived')"
    result = ShellTool(workspace).execute(command='{python} -c ' + shlex.quote(child_code) + ' & wait', timeout_seconds=1)
    assert result.metadata.get('timed_out'), result
    time.sleep(0.8)
    assert not marker.exists(), 'timed-out shell left a child running'


def test_token_totals_survive_accumulation():
    from agent_replay.harness.types import TokenUsage
    usage = TokenUsage(reported=False)
    usage.add(TokenUsage(total_tokens=500, reported=True))
    usage.add(TokenUsage(input_tokens=20, output_tokens=5, reported=True))
    assert usage.total == 525
    assert usage.to_dict()['total_tokens'] == 525


def test_grader_rechecks_constraints_after_tests(tmp_path):
    from pathlib import Path
    from agent_replay.harness.grader import build_default_grader
    from agent_replay.harness.types import RunState
    from agent_replay.harness.workspace import TaskWorkspace
    task = make_calc_task(tmp_path, buggy='def add(a, b):\n    return a + b\n')
    task_test = Path(task.repo_path) / 'tests/test_calc.py'
    task_test.write_text("from pathlib import Path\ndef test_mutation():\n    Path('tests/extra.py').write_text('# tampered')\n    assert True\n")
    workspace = TaskWorkspace.prepare(Path(task.repo_path), tmp_path / 'work')
    protected = workspace.snapshot(task.protected_paths)
    grade = build_default_grader(task).grade(workspace, task, RunState(task=task, run_id='r'), baseline_protected=protected)
    assert not grade.passed
    assert 'tests/extra.py' in grade.evidence['constraints']['modified_protected']


def test_total_only_provider_usage_enforces_run_budget(tmp_path, harness_config):
    task = make_calc_task(tmp_path)
    actions = [{'tool': 'read_file', 'arguments': {'path': 'src/calc.py'}, 'usage': {'total_tokens': 100}}] * 3
    result = AgentHarness(task, harness_config.with_overrides(max_total_tokens=5), model=ScriptedModel(actions)).run()
    assert result.failure_reason == 'max_total_tokens'
    assert result.model_calls == 1
    assert result.usage.total == 100


def test_shell_uses_remaining_run_deadline(tmp_path):
    import time
    from pathlib import Path
    from agent_replay.harness.workspace import TaskWorkspace
    from agent_replay.tools.shell import ShellTool
    workspace = TaskWorkspace.prepare(Path(make_calc_task(tmp_path).repo_path), tmp_path / 'work')
    tool = ShellTool(workspace, default_timeout_seconds=10)
    tool.execution_deadline = time.monotonic() + 0.1
    started = time.monotonic()
    result = tool.execute(command='{python} -c "import time; time.sleep(2)"')
    assert result.metadata.get('timed_out'), result
    assert time.monotonic() - started < 1


def test_bounded_output_retains_test_summary(tmp_path):
    from agent_replay.tools.process import run_bounded_command
    from agent_replay.tools.test_parsing import sanitized_env
    import shlex
    code = "print('x' * 1000000); print('7 passed in 0.1s')"
    result = run_bounded_command(shlex.quote(sys.executable) + ' -c ' + shlex.quote(code), cwd=str(tmp_path), env=sanitized_env(), timeout_seconds=5, max_output_chars=1000)
    assert result.returncode == 0
    assert result.truncated
    assert len(result.output) <= 1000
    assert '7 passed' in result.output


def test_live_benchmark_rejects_missing_model_factory(tmp_path, harness_config):
    from agent_replay.evaluation.benchmark import run_benchmark, variants_for_experiments
    with pytest.raises(ValueError, match='model_factory'):
        run_benchmark(tasks=[make_calc_task(tmp_path)], variants=variants_for_experiments(['1']), config=harness_config, output_dir=tmp_path / 'bench', backend='openai', evidence_level='live')


def test_benchmark_rejects_scripted_live_label(tmp_path, harness_config):
    from agent_replay.evaluation.benchmark import run_benchmark
    with pytest.raises(ValueError, match='evidence'):
        run_benchmark(tasks=[], variants=[], config=harness_config, output_dir=tmp_path / 'bench', backend='scripted', evidence_level='live')
