# Agent Replay

**Replay what a coding agent did. Then run, verify, and benchmark your own harness.**

Agent Replay has two complementary surfaces:

| Surface | What it does |
|---|---|
| **Replay & evaluate existing agents** | Records Codex, Claude Code, OpenCode, Qoder, ZCode, and Cursor sessions; turns them into an interactive timeline; imports native, SWE-agent, and OTLP traces; and exposes recording/evaluation as a FastAPI service. |
| **Run a minimal coding-agent harness** | A native Python ReAct harness (M0–M11) with a Context Manager, OpenAI-compatible Model Client, six tools, Tool Registry, harness-owned Grader, grader-driven retry, replay artifacts, context compression, Skills, MCP, Reviewer, and Multi-Agent. |

[![Public beta](https://img.shields.io/badge/release-v1.0.0--beta.1-blue)](https://github.com/Lyz1116-FOUND/agent-replay/releases/tag/v1.0.0-beta.1)
[![CI](https://github.com/Lyz1116-FOUND/agent-replay/actions/workflows/ci.yml/badge.svg)](https://github.com/Lyz1116-FOUND/agent-replay/actions/workflows/ci.yml)

[English](README.md) · [简体中文](README.zh-CN.md)

[**Live demo**](https://lyz1116-found.github.io/agent-replay/) · [Harness quick start](#run-the-harness) · [Measured results](#measured-results) · [M0–M11 status](#m0m11-status) · [Documentation](#documentation)

[![Agent Replay launch film: a blue character follows a failing test back to an edit and replays the recovery](docs/demo/launch-preview.gif)](https://lyz1116-found.github.io/agent-replay/launch/)

[Watch the 24-second film with sound](https://lyz1116-found.github.io/agent-replay/launch/) · [Download MP4](https://github.com/Lyz1116-FOUND/agent-replay/releases/download/v1.0.0-beta.1/agent-replay-pointer-final-1080p60.mp4)

## Run the harness

The harness is Python 3.10+. It runs a model against a disposable git workspace and makes **the harness, not the model's "done" message**, decide success.

```bash
git clone https://github.com/Lyz1116-FOUND/agent-replay.git
cd agent-replay
python -m venv .venv && source .venv/bin/activate
pip install -e '.[dev]'

python -m agent_replay.harness list
python -m agent_replay.harness run task_004_parser_empty --backend scripted
python -m agent_replay.harness validate-tasks
```

The `scripted` backend is a deterministic oracle fixture, not an LLM. It demonstrates the loop and writes real artifacts without requiring an API key.

For a real model, use any OpenAI-compatible chat-completions endpoint:

```bash
export AGENT_REPLAY_MODEL_BASE_URL="https://your-endpoint/v1"
export AGENT_REPLAY_MODEL_API_KEY="..."
python -m agent_replay.harness run task_004_parser_empty --backend openai --model your-model
```

Each run writes:

```
results/harness/runs/<run_id>/
  task.json        config.json       events.jsonl
  messages.jsonl   patch.diff        test_results.json
  grade.json       metrics.json      result.json
  trace.json       # importable into the Agent Replay viewer
```

The console script `agent-replay-harness` exposes the same commands. `agent-replay` remains the Node recorder/viewer CLI.

The diagram is the product:

```
Task → Context → Model → Tool → Observation → Loop → Verification → Grader → Retry / Finish
```

- **Harness-owned success.** A turn without tool calls is a completion *claim*; tests and protected-path hashes decide the verdict.
- **Uniform tools.** `read_file`, `grep`, `write_file`, `shell`, `run_tests`, and `git_diff` all return one `ToolResult`.
- **Feedback retries.** Failed verification returns grader feedback to the same workspace for another attempt.
- **Replay from the same facts.** Events, messages, patches, tests, grades, and a native `trace.json` are written for every run.
- **Advisory reviewer.** Reviewer and multi-agent rounds can add feedback; they cannot override the grader.

## M0–M11 status

| Milestone | Implemented | Evidence |
|---|---|---|
| **M0 Contracts** | `TaskSpec`, `RunState`, `ModelTurn`, `ToolResult`, `GradeResult` in [`harness/types.py`](agent_replay/harness/types.py) | Contract and serialization tests |
| **M1 Single-Agent Loop** | ReAct loop, OpenAI-compatible client, step/time/token budgets, abort, stuck-loop detection | Loop and local fake-endpoint integration tests |
| **M2 Built-in Tools** | Six tools + Tool Registry + workspace containment | Tool, path, registry, and boundary tests |
| **M3 Verification + Retry** | Test / Constraint / Composite graders; protected paths; feedback retry | Grader and loop tests |
| **M4 Replay + Observability** | `events.jsonl`, messages, patch, tests, grade, metrics, result, native trace | Replay tests; trace checked against the viewer schema |
| **M5 Context Management** | full / truncated / compressed, structured state, budget termination | Context and boundary tests |
| **M6 Benchmark + Metrics** | 10 Python tasks; success, verified success, Pass@1, retry recovery, regression, false completion, tools, tokens, latency, context | Scripted and live benchmark reports |
| **M7 Skills** | Loader, task matching, built-in Python test-debugging skill | Skill tests and no-skill/skill experiment |
| **M8 MCP** | stdio JSON-RPC client + native `Tool` adapter | Adapter, partial-line, timeout, and notification tests |
| **M9 Reviewer** | Read-only model reviewer, strict JSON, advisory feedback | Reviewer and supervisor tests |
| **M10 Multi-Agent** | Capped coder → grader → reviewer rounds, `MultiAgentState` | Supervisor tests |
| **M11 A2A** | Internal `AgentMessage` / `MessageBus`; no external protocol claim | A2A and supervisor tests |
| **Optional Memory** | JSON key/value memory with same-task recall, separate from context | Memory tests |

Architecture, evidence labels, experiment variants, failure taxonomy, and audit checklist: [docs/harness.md](docs/harness.md).

## Measured results

### Live model: `spark-x2.6` (2026-10-23)

**130 runs = 13 variants × 10 tasks; one run per cell; 2,423,838 tokens.** These are live observations, not a ranking or a significance test.

| Variant | Harness | Verified | Tokens | Avg context |
|---|---:|---:|---:|---:|
| harness | 10/10 | 10/10 | 190,162 | 11,972 |
| one-turn baseline (`single_shot`) | 0/10 | 0/10 | 10,707 | 254 |
| no verification | 10/10 | 10/10 | 230,947 | 15,094 |
| verified | 9/10 | 9/10 | 227,731 | 14,965 |
| context full | 10/10 | 10/10 | 229,321 | 14,558 |
| context truncated | 10/10 | 10/10 | 155,643 | 8,177 |
| context compressed | 10/10 | 10/10 | 107,161 | 4,161 |
| single agent | 10/10 | 10/10 | 189,752 | 12,048 |
| coder + reviewer | 10/10 | 10/10 | 220,387 | 13,138 |
| no skill | 10/10 | 10/10 | 220,019 | 14,314 |
| with skill | 10/10 | 10/10 | 192,007 | 11,632 |
| no retry | 10/10 | 10/10 | 216,854 | 14,005 |
| retry once | 10/10 | 10/10 | 233,147 | 15,001 |

What is—and is not—shown here:

- **Context compression:** all three strategies stayed at 10/10; compressed used **47% of full's total tokens** and **29% of full's average context tokens**.
- **Reviewer:** coder+reviewer also passed 10/10, but used about **30.6k more tokens** and 1.5 more model calls. This run does not show a success gain.
- **Verification:** the live model actually fixed tasks with the grader disabled, so live false completion was 0. The controlled false-completion evidence is the scripted experiment below, where a no-op policy was accepted 10/10 and failed post-hoc tests 10/10.
- **One-turn baseline:** `single_shot` spent its only turn inspecting and made no edit; its 0/10 is a one-turn-budget result, not a general claim about single-prompt patch workflows.
- **Retry:** `no_retry` already passed 10/10, so live retry recovery was not exercised. The controlled evidence is the scripted forced-failure retry experiment.
- **One `verified` run** hit a provider timeout and is classified `I1` (infrastructure), not a test failure.

### Scripted mechanics (controlled, not model evidence)

The deterministic oracle deliberately exercises failure paths:

- `no_verification`: accepted **10/10** premature completion claims; post-hoc tests failed all 10.
- `verified`: **0/10** accepted; the grader caught every false claim.
- `retry_once`: Pass@1 **0%**, retry recovery **10/10**.
- Context full / truncated / compressed: **100%** success with average context **12,860 / 4,362 / 2,997** tokens.

The `scripted` backend is an oracle fixture. It proves the harness loop, graders, retry, metrics, and artifacts; it does **not** measure model capability. Full tables and limits: [docs/harness.md](docs/harness.md). Raw live artifacts are local under `results/live-bench/full-spark-20261023/`; the API key is supplied only through the environment and is not stored.

## Replay an existing session

[Open the live demo](https://lyz1116-found.github.io/agent-replay/) to explore without installing anything. No API key or login is needed. Open the **Codex LRU cache** run, select a failed test, then step through the edits that follow. Press **Space** to play or pause and **← / →** to step.

To run the viewer locally, you need **Node.js 22.12+**, npm, and Git:

```bash
git clone https://github.com/Lyz1116-FOUND/agent-replay.git
cd agent-replay
npm ci
npm run dev
```

Open the URL printed in your terminal. Switch between English and Chinese with **中文 / EN** in the top bar.

> This beta is installed from source. Do not use `npm install agent-replay`: the npm package with that name belongs to a different project.

### What you can do

- **Replay a session.** Follow reads, edits, commands, and tests on a timeline. Pause, change playback speed, or jump straight to a step.
- **Inspect a failure.** Open test output and nearby diffs to see what changed before a regression or recovery.
- **Compare approaches.** View up to four runs of the same task side by side, including outcomes, timing, and test activity.
- **Check reported edits.** See which agent-reported changes were confirmed by workspace diffs and which remain unverified.

![Replay view with a timeline, code changes, test output, and step details](docs/replay.png)

### Record a session

First, build Agent Replay and make its CLI available. Run these commands from the **Agent Replay checkout**:

```bash
npm run build
npm link
```

Then switch to the **Git repository where you want the agent to work**. The selected agent CLI must already be installed and signed in. The next command starts that agent using its own permissions, credentials, and billing settings.

```bash
cd /path/to/your-project
agent-replay record codex --name fix-lru -- "Fix the LRU cache eviction bug and run the tests"
agent-replay open fix-lru
```

The recording is saved as `replays/fix-lru.trace.json` in your project; `open` displays it in a local viewer. The viewer itself does not call a model.

| Agent | Adapter name | Recording status |
|---|---|---|
| Codex | `codex` | Live capture tested |
| Claude Code | `claude` | Live capture tested |
| OpenCode | `opencode` | Live capture tested |
| Qoder CLI | `qoder` | Live capture tested |
| ZCode CLI | `zcode` | Live capture tested |
| Cursor | `cursor` | Adapter available; live capture not yet verified |

Replace `codex` in the command with the adapter you need. For desktop agents, interactive sessions, or extra CLI flags, follow the [recording guide](docs/recording.md). Tested versions and capture limits are listed in [validation and measurement](docs/validation.md).

### Import a trace

Already have a recording? Click **Import trace** in the viewer, drop in a file or paste its contents, and open the imported run. You do not need to execute an agent to replay it.

| Format | Example |
|---|---|
| Agent Replay JSON | [Native trace](examples/native-sample.trace.json) |
| SWE-agent `.traj` | [Sample trajectory](examples/swe-agent-sample.traj) |
| OpenTelemetry OTLP JSON | [Exporter samples](examples/otel/) |

OpenTelemetry support is **offline JSON only**. It preserves exported span hierarchy and overlapping activity, but does not verify workspace changes. Protobuf, gRPC, JSONL, and collector endpoints are not supported. See [trace formats](docs/trace-formats.md) for details.

### Compare your own runs

Open **Compare** to explore the built-in LRU demos. For your own recordings, runs must share a `task.id` to appear under the same task.

<details>
<summary>Set up task grouping for your recordings</summary>

The CLI currently derives `task.id` from `--name`; it has no separate task-grouping option.

1. Record each attempt with a different name, such as `codex-fix` and `claude-fix`, to avoid overwriting files.
2. Before importing, edit their trace JSON files so `task.id` has the same value, such as `lru-fix`. Keep each trace's top-level `id` unique.
3. Import the files, open **Compare**, select the shared task, and choose up to four runs.

For example, edit these fields in the existing Codex trace, keeping its other contents:

```json
{
  "id": "codex-fix",
  "task": { "id": "lru-fix" }
}
```

Use `claude-fix` as the other trace's `id`, with the same `task.id` of `lru-fix`.

</details>

## Data and evidence

Recordings stay in your project's `replays/` directory. Imported traces are stored in browser `localStorage`. Agent Replay does not automatically upload them. Keep your original trace files: clearing the site's browser data removes imported runs. Check for sensitive code, terminal output, or credentials before sharing a file.

Capture labels distinguish agent-reported activity from workspace-verified changes. The viewer shows observable tool activity and reasoning summaries exposed by an agent product; it does not access hidden chain-of-thought or model internals.

Built-in examples are labelled **DEMO**. The launch film reconstructs one of these examples and includes labelled product footage. The repository also includes a [real OpenCode recording](examples/beta-opencode.trace.json), with its commands, test results, and verification documented in [capture evidence](docs/demo/REAL_CAPTURE.md).

Harness results are labelled **live** or **mechanics**. Token usage is reported as unavailable when the backend does not report it; it is never fabricated as zero. See [harness limits](docs/harness.md#known-limits).

## Service API & Prompt Evaluation

The recorder and prompt evaluator are also exposed as a **FastAPI service** and a **prompt-optimization experiment harness**. Both reuse the same execution and trusted-verify logic as the CLI.

```
Task → Agent → Execution → Patch → Tests → Evaluator → Replay / Report
```

### Start the API

```bash
# Local
pip install -e .                            # installs agent_replay + experiments
uvicorn agent_replay.api.main:app --reload   # http://127.0.0.1:8000/docs

# Docker
docker build -t agent-replay .
docker run -p 8000:8000 agent-replay
curl http://127.0.0.1:8000/health           # {"status":"ok"}
```

### Example API calls

```bash
curl -X POST http://127.0.0.1:8000/tasks \
  -H 'Content-Type: application/json' \
  -d '{"task": "single-file-bug", "prompt_template": "structured"}'

curl -X POST http://127.0.0.1:8000/tasks/<task_id>/run
curl http://127.0.0.1:8000/runs/<run_id>
```

### Run the prompt experiment

```bash
python -m experiments.prompt_eval \
  --prompts default,structured,verify --tasks all --runs 1
# → results/<experiment_id>/{raw_runs.jsonl, summary.json, summary.csv, report.md}
```

A 30-run experiment (3 prompts × 10 tasks) on `zhipu/glm-5.3-flash`:

| Prompt | Success Rate | Median Latency | Tokens |
|---|---|---|---|
| default | 90.0% (9/10) | 24.0s | 57,118 |
| structured | 100% (10/10) | 22.4s | 57,196 |
| verify | 100% (10/10) | 37.6s | 80,712 |

Success is the trusted verdict from running the task's own verify command in the final worktree. Results reflect one run per task, so treat them as an observation, not a ranking. See [Backend & experiments](docs/backend.md) for the API contract and prompt variants.

## Documentation

- [Harness architecture and audit](docs/harness.md) — M0–M11, tools, context, replay, experiments, limits, checklist.
- [Independent audit record](docs/harness-audit-20261023.md) — 25 boundary checks, fixes, and live validation.
- [Recording guide](docs/recording.md) — native capture, passive recording, and CLI options.
- [Trace formats](docs/trace-formats.md) — supported files, schema, and import limits.
- [Validation and measurement](docs/validation.md) — tested agents, tasks, and evidence boundaries.
- [Architecture](docs/architecture.md) · [Contributing](CONTRIBUTING.md) — for contributors.
- [Release notes](docs/RELEASE_v1.0.0-beta.1.md) · [Changelog](CHANGELOG.md) · [Demo media](docs/demo/README.md).

## Development

```bash
npm test          # Node unit and integration tests (210)
npm run lint      # Node lint
npm run build     # Web viewer + CLI bundle

pip install -e '.[dev]'
python -m pytest  # Python harness/service tests (139)
python -m agent_replay.harness validate-tasks
```

[Report a bug](https://github.com/Lyz1116-FOUND/agent-replay/issues) · [Ask a question](https://github.com/Lyz1116-FOUND/agent-replay/discussions)

## License

The application is [MIT licensed](LICENSE). The launch-film pipeline uses onetake under its noncommercial license; see [media licensing](docs/demo/launch-pointer/README.md).
