# Validation and measurement

[English README](../README.md) · [中文 README](../README.zh-CN.md)

## Real CLI validation

Six live agent/model configurations were recorded end-to-end on the same small bug-fix task (`calc.mjs` + `node --test`), with the recorder generating every trace automatically:

| Agent | Version / model | Result | Capture |
|---|---|---|---|
| OpenCode | 2.0.32 · `opencode/glm-5.3-flash-free` | PASS · 15.3s · 1 edit · 3/3 tests | native+workspace · 1 verified · 0 unverified |
| Claude Code | 2.1.304 · `claude-haiku-5-5` | PASS · 8.5s · 1 edit · 3/3 tests | native+workspace · 1 verified · 0 unverified |
| Qoder CLI | 1.1.74 · `DeepSeek-Flash` (free) | PASS · 14.4s · 1 edit · 3/3 tests | native+workspace · 1 verified · 0 unverified |
| OpenCode + GLM | `opencode/glm-5.3-flash-free` | PASS · 12.0s · 1 edit · 3/3 tests | native+workspace · 1 verified · 0 unverified |
| ZCode CLI | 3.15.3-37 · `bigmodel-standard-api-2/GLM-5.3-Flash` | PASS · 61.9s · 1 edit · 3/3 tests | native+workspace · 1 verified · 0 unverified |
| Codex | 0.163.0 · default model | PASS · 53.5s · 1 edit · 2 test runs · recovery | native+workspace · 1 verified · 0 unverified · test recall 2/2 |

The Claude run exposed a real integration bug: Claude reports absolute file paths while the workspace watcher reports repo-relative paths. The EventMerger now normalizes native file paths before matching and trace serialization.

### OpenCode free-model capture validation matrix

Nine free OpenCode models on the same task, each in a fresh git repo, recorded by the recorder itself. This validates the capture pipeline across models — it is **not** a model ranking (traces in [`examples/matrix`](../examples/matrix), ledger in [`examples/matrix/summary.json`](../examples/matrix/summary.json)):

| Model | Status | Termination | End-to-end wall-clock latency | Capture |
|---|---|---|---|---|
| `opencode/deepseek-v4.1-flash-free` | pass | completed | 10.8s | edit recall 1/1 |
| `opencode/glm-5.3-flash-free` | pass | completed | 17.9s | edit recall 1/1 |
| `opencode/minimax-m3.1-flash-free` | pass | completed | 18.7s | edit recall 1/1 |
| `opencode/mimo-v2.6-flash-free` | pass | completed | 19.3s | edit recall 1/1 |
| `opencode/nemotron-3.5-lightning-free` | pass | completed | 21.8s | edit recall 1/1 |
| `opencode/nemotron-3-ultra-free` | pass | completed | 30.7s | edit recall 1/1 |
| `opencode/longcat-2.5-preview-free` | pass | completed | 31.3s | edit recall 1/1 |
| `opencode/nemotron-3.5-super-vl-free` | pass | completed | 34.9s | edit recall 1/1 |
| `opencode/beam-free` | fail | `provider_unavailable` (HTTP 403) | 3.3s | — |

What the matrix actually establishes: the eight successful runs completed the full agent → edit → test → trace path with `1 verified · 0 unverified · 0 outside workspace`; provider errors are preserved verbatim; the recorder does not silently degrade across models.

What it does not establish: that one model is faster than another. The latency column is end-to-end wall clock — model inference plus provider queue plus network plus agent orchestration plus tool execution — so the ranking inside it is not a model property.

`beam-free` is region-blocked by the provider. It is recorded as `status: fail` **and** `termination.kind: provider_unavailable`, and it is excluded from the capability denominator. `minimax` and `beam` were re-run with `isolation: none`, because an empty XDG config has no provider routing for them and returns `provider.no-route` instead of reaching the model.

## Task validation matrix

Three tasks x N runs per agent, each run in a fresh git repo, recorded by the recorder itself. Ledger: [`examples/validation/summary.json`](../examples/validation/summary.json).

Before anything is measured, `node dist-cli/validate.mjs --verify-tasks` proves every task is worth running: the baseline must fail and the task's own `reference/` overlay must turn the suite fully green.

When a run finishes, the harness runs the task's command itself in the final worktree and judges the task on that result. An agent saying it passed is evidence; the worktree is the verdict. Two guards keep that verdict honest: the command must have exited zero, and the task's protected test files must be byte-identical to what the agent started with — otherwise the run is `fail` with `reason: tests_modified`. The hash is checked *before* the command runs and again after, because a replaced test file can restore the original while it executes.

| Agent | Runs | Task pass | Completed median | Traces | Edit recall | Test recall |
|---|---|---|---|---|---|---|
| `opencode` / glm-5.3-flash-free | 9 | 8 | 46.0s | 8/9 | 13/13 | 9/9 |
| `codex` 0.163.0 | 1 | 1 | 38.4s | 1/1 | 1/1 | 2/2 |

The `Traces` column is not decoration. One `opencode` run hit the 240s harness timeout with the tests still red; the recorder was killed before it wrote a trace, so that run is `taskResult: fail` + `termination: timeout` with `integrity: null`. Recall is computed over the eight runs that produced one — 100% recall on 8/9 coverage is a different claim from 100% on 9/9, and the ledger says which one it is.

Availability is recorded, not hidden: `cursor` reports `login_required` (it needs an interactive browser login), and `claude` is gated behind `--allow-paid` because it costs money. Neither is counted as a task failure, and neither blocks the matrix.

Timing is end-to-end wall-clock, never "model speed". The harness reports three buckets, because they answer different questions:

- `allRunsWallClock` — every run, including ones that never reached a model
- `successfulTaskLatency` — only runs that solved the task, whatever happened afterwards
- `completedAgentLatency` — solved the task and ended cleanly

One `small-feature` run in the current ledger is a real failure: it hit the 240s harness timeout with the tests still red, so it is `taskResult: fail` + `termination: timeout` and it carries no trace (the recorder was killed before writing one). An earlier batch produced 8/9 with one `agent_error` (a transport timeout at 241s) on the same three tasks. That run is not in this ledger — it was re-run — but it is the reason the buckets exist: a pass that ended in a crash should not be averaged into "how long a solved task takes" without saying so.

## Measurement integrity

A trace answers three different questions, and mixing them up is how benchmarks lie:

| Layer | Question | Field |
|---|---|---|
| Behaviour | what did the agent do? | `spans` |
| Fidelity | did the environment confirm it? | `capture.fidelity`, `capture.integrity` |
| Evaluation integrity | did the run get a fair attempt? | `termination` |

**`termination`** is separate from `status`. `status` stays `pass | fail | partial` and is decided by the last observed test result: a task whose tests passed is `pass` even if the agent's process died afterwards — that failure mode lives in `termination` instead of silently rewriting the task outcome. `termination.kind` is one of `completed`, `task_failure`, `provider_unavailable`, `rate_limited`, `permission_denied`, `timeout`, `agent_error`, `recorder_error`. When aggregating, exclude unavailable kinds from the capability denominator and report them as an availability metric — otherwise five provider 403s quietly become a 75% success rate.

**`environment`** stamps the run: `isolation`, `provider`, `harnessVersion`, `platform`, `nodeVersion`. Without it, "this model worked yesterday" is unanswerable.

**`capture.integrity`** reports what the workspace could corroborate:

```json
"integrity": {
  "nativeEdits": 1, "workspaceEdits": 1,
  "matchedEdits": 1, "confirmedEdits": 1, "supersededEdits": 0,
  "unverifiedEdits": 0, "outsideWorkspaceEdits": 0,
  "nativeTestRuns": 1, "parsedTestRuns": 1, "capturedTests": 1
}
```

`matchedEdits` is one-to-one: this exact call claimed a workspace diff. `confirmedEdits` is file-level: the file it names changed within the match window, even if a neighbouring call had already claimed that diff (`supersededEdits`). Edit recall uses `confirmedEdits`, because an agent that edits the same file four times between two watcher polls loses nothing when only three diffs exist. `unverifiedEdits` is the real gap: the agent claimed a change and no workspace diff corroborates it at all.

Test recall is `parsedTestRuns / nativeTestRuns`. Recall is absent when there was nothing to match — never 100% by default.

## Adapter status

| Adapter | Implementation | Fixture | Live |
|---|---|---|---|
| OpenCode | ✓ | ✓ | ✓ |
| Claude Code | ✓ | ✓ | ✓ |
| Qoder CLI | ✓ | ✓ | ✓ |
| ZCode CLI | ✓ | ✓ | ✓ |
| Codex | ✓ | ✓ | ✓ |
| Cursor | ✓ | ✓ | — |

Codex is now validated live. Cursor has an adapter and fixtures but still no live run: the CLI installs, but `cursor-agent` requires an interactive browser login before it will make a request. That is a gap in validation, not a missing feature, and it does not block the beta.

![Real Claude Code capture](recorded.png)
