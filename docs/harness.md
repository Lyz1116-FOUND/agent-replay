# Minimal coding-agent harness (M6)

`agent_replay/harness` is a native Python coding harness built on the same
repository as the recorder and viewer:

```
Task → Context → Model → Tool → Observation → Loop → Verification → Grader → Retry/Finish
```

It is deliberately separate from the Node recorder. The recorder observes
agents that already exist; the harness runs a model itself and records every
step in the same replay-friendly shape.

## Evidence levels

| Level | What it proves | How it is labelled |
|---|---|---|
| Unit/integration tests | Contracts, tools, graders, retries, artifacts, trace validity | `pytest` |
| Scripted benchmark | The harness loop and experiment plumbing work | `evidence_level=mechanics` |
| Live model benchmark | Model behavior under a harness configuration | `evidence_level=live` |

The mechanics benchmark recorded in this document uses a deterministic policy
that reads the task's `reference/` files. **It is an oracle fixture, not an LLM.**
It must not be cited as model capability.

Live results below use `spark-x2.6` through an OpenAI-compatible endpoint on
2026-10-23. They are single runs, not a ranking. The API key is supplied only
through the environment and is not stored in the repository or artifacts.

## Module map

```
agent_replay/harness/
  types.py          TaskSpec, RunState, ModelTurn, ToolResult, GradeResult
  config.py         budgets, model/backend config, paths
  events.py         ordered events.jsonl + live listener
  context.py        re-export of the context boundary
  registry.py       schemas in, uniform ToolResult out
  grader.py         Test / Constraint / Composite / Claim / LLM graders
  model_client.py   OpenAI-compatible + scripted fixture clients
  loop.py           ReAct loop, retries, timeouts, abort, artifacts
  memory.py         small JSON key/value memory with keyword search
  workspace.py      repo copy, containment, protected snapshots, patch
  artifacts.py      runs/<run_id>/ writer
  tasks.py          load and validate fixed tasks
  scripted.py       oracle/no-op action plans (mechanics only)
  cli.py            run / list / validate-tasks / benchmark

agent_replay/tools/       read_file, grep, write_file, shell, run_tests, git_diff
agent_replay/context/     full, truncated, compressed; summarizer; retriever
agent_replay/skills/      loader + builtin/python_test_debug
agent_replay/mcp/         stdio client + Tool adapter
agent_replay/agents/      coder, reviewer, supervisor, A2A messages
agent_replay/evaluation/  metrics, failure taxonomy, benchmark, report
agent_replay/replay/      harness run → agent-replay/v1 trace
```

## M0 contracts

The five objects in `harness/types.py` are the boundary:

| Object | Owns |
|---|---|
| `TaskSpec` | task id, fixture repo, instruction, test command, timeout, protected/expected paths |
| `RunState` | messages, tool calls, observations, files read/changed, attempt history, usage |
| `ModelTurn` | text, tool calls, token usage, finish reason; no provider fields |
| `ToolResult` | success, output, error, metadata, duration; every tool returns this |
| `GradeResult` | passed, score, feedback, evidence, authority |

`success` in `ToolResult` means the tool executed. A failing test suite is a
successful test-tool execution with `metadata.status = "fail"`; this keeps the
tool-error metric meaningful. Token usage carries `reported`; an unreported
backend is `unavailable`, never zero.

## The loop and success authority

1. Prepare a fresh copy of the fixture repo and commit a git baseline.
2. Build context under the configured strategy.
3. Call the model with the registry's tool schemas.
4. Execute every tool call through the registry; append observations.
5. Stop on a completion claim (no tool calls), step/time/token budget,
   repeated-call detection, timeout, caller abort, or provider failure.
6. **The harness grades the workspace.** The model's "done" is only a claim.
7. If verification fails, feedback is written into the context and another
   attempt starts in the same workspace. `max_retries` (single-agent) or
   `max_rounds` (reviewer) caps this.
8. Artifacts and a native trace are written for every run.

Graders are authoritative; the reviewer is advisory. A reviewer rejection can
trigger another round, but it cannot turn a passing grade into a failure or a
failing grade into a pass. Callers can pass `abort_check`; the loop stops
between calls, grades the current workspace, and records `run_aborted`.
Tool calls inherit the run deadline, and bounded output keeps both the head and
the tail so a test summary at the end is not lost to truncation.

## Tools

| Tool | Contract |
|---|---|
| `read_file` | path, optional 1-based start/end line; line-numbered output |
| `grep` | literal or regex, path, max results; skips caches and binaries |
| `write_file` | path + content; creates parents; records before/after preview |
| `shell` | command, cwd, timeout, output cap; records exit code; denylist |
| `run_tests` | the task's command or a test target; structured counts, failed IDs, duration |
| `git_diff` | tracked + untracked changes; stat-only option |

All paths are resolved under the workspace; `..`, absolute paths, `.git`, and
symlinks that escape are rejected. The shell is **not a security sandbox**:
it strips common credential variables, blocks a limited denylist, caps time/output,
and runs with the workspace as cwd. The denylist is not comprehensive. Native
commands retain bounded head/tail output and terminate ordinary POSIX process
groups on timeout or exit; processes that deliberately detach need an OS sandbox. Use
an OS-level sandbox for untrusted models. Tool calls inherit the harness run
deadline, so a long shell/test call cannot silently outlive the run budget.

## Context strategies

The strategy is an experiment variable, not hidden magic:

- **full** — all messages, with a hard safety budget.
- **truncated** — all messages, each tool observation clamped.
- **compressed** — extractive summary of older turns plus a recent window.

Compression is deterministic and extractive; it adds no model call. If the
system prompt alone exceeds the token budget, context construction raises a
clear error instead of looping or silently dropping the rules. The summarizer
records files read/changed, tool counts, recent test results, and relevant
older observations. Every build also carries a small structured
state (`goal`, `hypotheses`, `files_read`, `files_changed`, `tests_failed`,
`remaining_work`) in the event stream. `hypotheses` is currently reserved and
empty: the harness does not parse model reasoning into hypotheses. Budget
enforcement drops whole turns so a tool call is never separated from its tool
results.

## Memory

`harness/memory.py` is a JSON key/value store with keyword search, not a vector
database. It is opt-in (`--memory path` or `AGENT_REPLAY_HARNESS_MEMORY`).
After a run the harness records the task, status, failure reason, changed
files, and feedback; before the next run of the same task it recalls up to
three prior outcomes into the system prompt and emits `memory_recalled` /
`memory_written`. Context is what one model call sees; memory is what survives
between runs. Memory is never treated as a verifier or as instructions.

```bash
python -m agent_replay.harness run task_004_parser_empty --backend scripted \
  --memory results/harness/memory.json
```

## Graders

- `TestGrader` runs the task's command in the final workspace and parses
  pass/fail/failed-test IDs.
- `ConstraintGrader` compares protected-file hashes and patch size.
- `CompositeGrader` runs constraints first; if tests or `pytest.ini` were
  modified, it refuses to execute them. It rechecks protected paths after the
  tests because test code itself can mutate the workspace. It checks constraints again after tests
  to reject mutations caused by imported task code during verification.
- `AgentClaimGrader` is the explicit no-verification baseline for the
  verification experiment. Its authority is `agent`.
- `LLMGrader` is optional and advisory; it is not the default.

## Replay artifacts

Every normally finalized run writes:

```
results/harness/runs/<run_id>/
  task.json
  config.json
  events.jsonl
  messages.jsonl
  patch.diff
  test_results.json
  grade.json
  metrics.json
  result.json
  trace.json          # import into the Agent Replay viewer
```

Multi-agent runs also write `multi_agent.json`; benchmark runs add
`posthoc.json` next to each run. Benchmark `result.json` is replaced with the
post-hoc record so false completion is persisted with the run.

`events.jsonl` includes `run_started`, `context_built`, `model_called`,
`tool_called`, `tool_returned`, `file_changed`, `test_started`,
`test_finished`, `grader_started`, `grader_finished`, `retry`,
`agent_message`, and `run_finished`. `trace.json` conforms to the native
`agent-replay/v1` shape (spans with types read/edit/test/tool/generation,
artifacts, result tests, workspace verification). A run accepted only by the
caller-claim grader is marked `partial` and `workspaceVerification:
unavailable`, never `pass`.

## Fixed task set

Ten self-contained Python tasks under `examples/harness_tasks/`. Each has a
`pytest.ini`, source, tests, a `CONTEXT.md` distractor, and a `reference/` fix
that is excluded from the agent workspace. The test command is
`{python} -m pytest -q -c pytest.ini`; `{python}` is replaced by the running
interpreter.

| Task | Kind | Baseline pass/fail | Reference pass/fail |
|---|---|---|---|
| task_001_add_bug | bug | 0/3 | 3/0 |
| task_002_multi_file | bug | 0/2 | 2/0 |
| task_003_off_by_one | bug | 0/3 | 3/0 |
| task_004_parser_empty | bug | 1/3 | 4/0 |
| task_005_misleading_comment | bug | 2/1 | 3/0 |
| task_006_recursion | bug | 0/3 | 3/0 |
| task_007_regression | bug | 3/2 | 5/0 |
| task_008_feature_unique | feature | 0/3 | 3/0 |
| task_009_safe_int | bug | 2/2 | 4/0 |
| task_010_word_count | bug | 1/2 | 3/0 |

```bash
python -m agent_replay.harness validate-tasks
```

Each task is proven to fail at baseline and pass with its reference fix.

## Model backends

`OpenAICompatibleModel` posts to `<base_url>/chat/completions`, parses tool
calls and usage, retries transient 408/409/429/5xx errors, and never invents
usage. Configure a live run:

```bash
export AGENT_REPLAY_MODEL_BASE_URL="https://your-endpoint/v1"
export AGENT_REPLAY_MODEL_API_KEY="..."       # or use --api-key-env
python -m agent_replay.harness run task_004_parser_empty \
  --backend openai --model your-model
```

There is no default base URL and no bundled key. If no endpoint is configured,
use `--backend scripted`, which is explicitly a mechanics fixture.

## Skills, MCP, reviewer, multi-agent

- **Skills** (`agent_replay/skills/`): `SKILL.md` + metadata; the loader
  matches triggers against task id/instruction/kind/tags. Loading adds a
  system-prompt section and emits `skill_loaded`; it grants no new tools.
- **MCP** (`agent_replay/mcp/`): a small stdio JSON-RPC client plus
  `MCPToolAdapter`, which exposes remote tools as native `Tool` objects. The
  client buffers partial lines, honors the run deadline, and caps response
  size. The registry, loop, context manager, and grader do not know a tool is
  remote.
- **Reviewer** (`agents/reviewer.py`): reads the diff and test evidence,
  returns JSON `{approved, issues, feedback}`, and never edits files.
- **Supervisor** (`agents/supervisor.py`): capped coder → grader → reviewer
  rounds. `MultiAgentState`, `AgentMessage`, and `MessageBus` make the roles
  and messages explicit. A2A here is an internal message shape, not an
  external protocol implementation.

## Experiments

```bash
# Mechanics validation (deterministic scripted policies; not model evidence)
python -m experiments.harness_eval --backend scripted --experiments all --tasks all --runs 1

# Live model
AGENT_REPLAY_MODEL_BASE_URL=... AGENT_REPLAY_MODEL_API_KEY=... \
  python -m experiments.harness_eval --backend openai --model <model> \
  --experiments 1,2,3,4 --tasks all --runs 1
```

The runner rejects a live backend without a model factory and rejects a
mismatched evidence label (`scripted` + `live` or `openai` + `mechanics`).
Post-hoc verification compares protected paths against the trusted task source
before executing tests, so an agent cannot hide test tampering by committing it.

| Group | Variants |
|---|---|
| 1 | harness vs single-shot tool turn |
| 2 | no verification vs verified (identical scripted policy) |
| 3 | full vs truncated vs compressed context |
| 4 | single agent vs coder + reviewer |
| skills | no skill vs matched skill |
| retry | no retry vs one grader-driven retry |

The Experiment 1 baseline is deliberately a **one-turn tool-calling**
baseline, not a patch-only prompt: it has the same tools but no observation
loop. That isolates the value of iterating on observations without conflating
the comparison with a diff-parsing pipeline.

Outputs: `config.json`, `raw_runs.jsonl`, `summary.json`, `summary.csv`,
`report.md`, and one artifact directory per run. Every variant is re-checked
post hoc with the task tests, even in the no-verification variant, so false
completion and regressions remain visible.

## Mechanics validation (scripted, 10 tasks, 1 run per task)

These numbers prove the pipeline, not model skill. The policy is an oracle
that writes the reference fix; it is deterministic and has no reasoning.

| Variant | Harness success | Verified success | False completion | Avg context tokens | Model calls |
|---|---|---|---|---|---|
| harness | 100% | 100% | 0/10 | 2,078 | 5.0 |
| single_shot | 100% | 100% | 0/10 | 254 | 1.0 |
| no_verification | 100% | 0% | 10/10 | 254 | 1.0 |
| verified | 0% | 0% | 0/10 | 254 | 1.0 |
| context_full | 100% | 100% | 0/10 | 12,860 | 6.0 |
| context_truncated | 100% | 100% | 0/10 | 4,362 | 6.0 |
| context_compressed | 100% | 100% | 0/10 | 2,997 | 6.0 |
| single_agent | 100% | 100% | 0/10 | 2,078 | 5.0 |
| coder_reviewer | 100% | 100% | 0/10 | 2,078 | 6.0 |
| no_skill | 100% | 100% | 0/10 | 2,078 | 5.0 |
| with_skill | 100% | 100% | 0/10 | 2,893 | 5.0 |
| no_retry | 0% | 0% | 0/10 | 254 | 1.0 |
| retry_once | 100% | 100% | 0/10 | 4,419 | 6.0 |

Retry recovery was 10/10 in `retry_once`; pass@1 was 0% because the first
completion claim was intentionally premature. The no-verification variant
accepted all 10 claims while post-hoc tests failed all 10 — the clearest
mechanics result in this table.

The context-token column sums the coder's context builds per run. The
reviewer's separate prompt is counted in model calls and provider usage, not in
that column.

## Live benchmark (spark-x2.6, 2026-10-23)

A full live run: **130 runs** (13 variants × 10 tasks, one run per cell),
temperature 0.0, through the OpenAI-compatible `/v2/chat/completions` endpoint.
Total measured usage was **2,423,838 tokens**. The local raw data and generated
report are under `results/live-bench/full-spark-20261023/` (gitignored); this
table is the reproducible summary.

| Variant | Harness | Verified | Pass@1 | Tokens | Avg context | Model calls | Avg latency |
|---|---:|---:|---:|---:|---:|---:|---:|
| harness | 10/10 | 10/10 | 10/10 | 190,162 | 11,972 | 6.0 | 16.2s |
| single_shot | 0/10 | 0/10 | 0/10 | 10,707 | 254 | 1.0 | 2.3s |
| no_verification | 10/10 | 10/10 | 10/10 | 230,947 | 15,094 | 6.7 | 19.4s |
| verified | 9/10 | 9/10 | 9/10 | 227,731 | 14,965 | 6.5 | 29.5s |
| context_full | 10/10 | 10/10 | 10/10 | 229,321 | 14,558 | 6.6 | 21.0s |
| context_truncated | 10/10 | 10/10 | 10/10 | 155,643 | 8,177 | 7.1 | 28.5s |
| context_compressed | 10/10 | 10/10 | 10/10 | 107,161 | 4,161 | 7.0 | 17.8s |
| single_agent | 10/10 | 10/10 | 10/10 | 189,752 | 12,048 | 6.1 | 17.4s |
| coder_reviewer | 10/10 | 10/10 | 10/10 | 220,387 | 13,138 | 7.6 | 34.1s |
| no_skill | 10/10 | 10/10 | 10/10 | 220,019 | 14,314 | 6.5 | 18.2s |
| with_skill | 10/10 | 10/10 | 10/10 | 192,007 | 11,632 | 6.7 | 17.9s |
| no_retry | 10/10 | 10/10 | 10/10 | 216,854 | 14,005 | 6.4 | 20.4s |
| retry_once | 10/10 | 10/10 | 10/10 | 233,147 | 15,001 | 7.0 | 19.8s |

What these numbers do and do not show:

- **Harness vs one-turn baseline.** The harness fixed all 10 tasks; the
  one-turn baseline fixed none because it spent its only turn inspecting and
  never edited. Its failures are classified `F10` (one-turn budget), not a
  general claim about a single-prompt patch workflow.
- **Verification.** `no_verification` also reached 10/10 and post-hoc tests
  passed 10/10; this model actually fixed the tasks without a grader, so live
  false completion was 0. The controlled false-completion evidence remains the
  scripted `no_verification` experiment (10/10 accepted claims, 10/10
  post-hoc failures). The single `verified` failure was a provider timeout
  (I1), not a test failure.
- **Context.** All three strategies stayed at 10/10. Compressed used **47% of
  full's total tokens** and **29% of full's average context tokens** (a 53% and
  71% reduction respectively). This is one run per cell, not a significance
  test.
- **Reviewer.** Both single-agent and coder+reviewer passed 10/10. The reviewer
  cost about 30.6k additional tokens and 1.5 extra model calls; this run does
  not show a success gain.
- **Skills.** Both passed 10/10; `with_skill` used fewer tokens here, but a
  single run cannot establish a skill effect.
- **Retry.** `no_retry` already passed 10/10, so no first attempt failed and
  live retry recovery was not exercised. The controlled retry evidence is the
  scripted `fail_first` experiment (10/10 recovery).

The live data were produced with a session-only API key supplied through the
environment; the key is not present in the repository, docs, or run artifacts.

## Failure taxonomy

`F1` task_understanding · `F2` wrong_file · `F3` wrong_tool ·
`F4` invalid_tool_args · `F5` context_loss · `F6` incorrect_patch ·
`F7` test_not_run · `F8` test_failure · `F9` regression ·
`F10` stuck_loop · `F11` premature_finish · `F12` timeout.
Extensions: `F13` constraint_violation, `I1` infrastructure/provider.

Classification uses recorded evidence: tool diagnostics, context builds,
test runs, post-hoc failed IDs, protected-path status, and stop reasons.

## Audit checklist

Run these from the repository root in a Python 3.10+ environment with the
backend dependencies installed (`pip install -e '.[dev]'`):

```bash
python -m pytest -q
python -m agent_replay.harness validate-tasks
python -m agent_replay.harness run task_004_parser_empty --backend scripted --cleanup
python -m experiments.harness_eval --backend scripted --experiments all \
  --tasks all --runs 1 --out-dir results/harness-audit
```

Then check:

- `run` prints `PASS`, writes a run directory, and its `trace.json` imports
  into the viewer.
- The scripted benchmark report starts with the mechanics-validation banner;
  the live report starts with the live-model banner.
- Scripted `no_verification` shows false completions and `verified` does not;
  this is the controlled grader check. Live results may differ because the
  model can actually fix tasks even without a grader.
- Context variants keep 100% success while context tokens drop.
- Scripted `retry_once` has pass@1 0% and retry recovery 100%; live retry is
  only exercised if a first attempt fails.
- Scripted `no_retry` fails the intentional first claim.
- `validate-tasks` proves every task fails at baseline and passes with its
  reference fix.
- The recorded live artifacts are under
  `results/live-bench/full-spark-20261023/` (gitignored). Run `config.json`
  stores the API-key environment variable *name*, never its value; shell
  diagnostics are credential-stripped.

## Boundary checks (independent audit)

`tests/test_harness_boundaries.py` adds 25 regression checks beyond the main
suite: context-budget termination and oversized-system-prompt failure,
non-boolean reviewer JSON, committed test tampering, MCP partial lines and
timeouts, shell child-process cleanup, token-total accumulation, post-test
constraint rechecks, total-only usage budgets, output truncation preserving
test summaries, and benchmark backend/evidence-label validation. The full
suite is 139 tests.

## Known limits

- The scripted backend cannot measure planning, tool choice, or context use by
  a real model. Live results must be labelled and are not included here.
- This is not an OS sandbox; shell use is bounded, not isolated.
- The context compressor is deterministic and extractive, not a learned
  summarizer.
- A2A is an internal message abstraction; no external A2A transport is claimed.
- Memory is a JSON key/value log, not embeddings or a database; it is opt-in and
  scoped by task id in the recall path.
- The stdio MCP client uses POSIX `select`; it was tested on macOS. A Windows
  transport would need a reader thread or a different transport.
- One run per task is an observation, not a ranking. Use multiple runs and
  report distributions before drawing conclusions.
- The existing Node recorder and FastAPI prompt-evaluation service are
  unchanged; this harness is additive.

## 2026-10-23 audit hardening

The independent review and local reproductions produced regression checks in
`tests/test_harness_boundaries.py`. Fixes cover fixed-baseline diffs after agent
staging/commits, source-hash post-hoc verification, post-test constraints,
context termination, cancellation and skipped batch results, strict reviewer
booleans, total-token accumulation, shared model-retry deadlines, native tool
deadlines, process-group cleanup and bounded output, MCP partial/batched reads,
and benchmark evidence-label validation. Scripted CLI runs are always labelled
`mechanics`; live benchmarks require an explicit model factory.

The agent execution deadline is shared by coder calls and native shell/test/MCP
operations. Final verification still runs with its own tool timeout after an
attempt stops, so wall-clock duration can exceed the agent execution budget.
Custom in-process tools must honor their `execution_deadline` cooperatively.
Setup failures can leave partial artifacts plus `harness_error`; the complete
artifact contract applies to finalized runs.

Fresh report: `results/harness-audit-20261023/report.md` (130 scripted runs).
The 10 tasks all failed at baseline and passed with their reference fixes.
Python regression and fixture validation now have a dedicated CI matrix; the
remote workflow must run after these local changes are submitted.

See [the requirement and audit record](harness-audit-20261023.md) for the
M0–M11 acceptance map, commands, and evidence boundaries.
