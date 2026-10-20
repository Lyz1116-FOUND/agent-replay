# Changelog

## 0.3.0 — 2026-10-20

First beta. The focus of this release is not more adapters — it is making a
recorded trace trustworthy enough to argue about.

### Added

- **Termination taxonomy.** `trace.termination = { kind, message?, code? }`
  separates *did the task fail* from *did the run get a fair attempt*:
  `completed`, `task_failure`, `provider_unavailable`, `rate_limited`,
  `permission_denied`, `timeout`, `agent_error`, `recorder_error`.
  `status` keeps its original `pass | fail | partial` meaning.
- **Environment fingerprint.** `trace.environment` records `isolation`,
  `provider`, `harnessVersion`, `platform`, `nodeVersion`, so "the same model
  worked yesterday" can be answered from the trace alone. Set with
  `--isolation`, `--provider`, `--harness-version`.
- **Capture integrity.** `capture.integrity` reports `nativeEdits`,
  `workspaceEdits`, `matchedEdits`, `confirmedEdits`, `supersededEdits`,
  `unverifiedEdits`, `outsideWorkspaceEdits`, `nativeTestRuns`,
  `parsedTestRuns`, `capturedTests`. The replay UI shows edit and test recall
  next to the fidelity badge.
- **Validation matrix.** `scripts/validation-matrix.py` runs tasks x agents x
  runs with a fresh repo per run and a ledger that separates task outcome from
  availability outcome. Tasks live in `examples/tasks/`.
- **ZCode CLI adapter** (`zcode`). `zcode --json` prints one summary object, so
  the adapter buffers stdout, takes the session id, and replays the parts ZCode
  persisted. Requires Node >= 22.5 (`node:sqlite`).
- **Unavailable runs are labelled.** A provider 403 shows as `UNAVAILABLE`
  instead of a plain failure.
- **Codex live validation.** `codex exec --json` recorded end to end
  (`examples/real-codex.trace.json`): 1 verified edit, 2 parsed test runs,
  recovery detected, test recall 2/2.
- `LICENSE` (MIT), `CONTRIBUTING.md`, `CHANGELOG.md`, GitHub Actions CI
  (Ubuntu + macOS, Node 22 + 24).

### Fixed

- **`/tmp` vs `/private/tmp`.** The session directory is now resolved with
  `realpath`, so native agent paths and git paths agree on macOS. Before this,
  every edit in a `/tmp` worktree was reported as unverified.
- **`PWD` was not updated when spawning the agent.** OpenCode resolves its
  workspace from `$PWD`, not the real cwd, so it executed tools in the parent
  directory and reported `repo-name/file.ts` paths. The recorder now sets
  `PWD` alongside `cwd`. The same model dropped from 31.9s to 8.7s on the
  reference task purely because it stopped searching the filesystem.
- **Parent-directory path prefixes** are normalized before matching, and still
  only count as verified when a workspace diff corroborates them.
- **Error fidelity.** OpenCode's error events kept only a generic message. The
  adapter now reads `error.message` and `error.status`, so traces contain
  `This model is not available in your country (HTTP 403)`.
- **A solved task stays solved.** `status` was downgraded to `fail` whenever the
  agent emitted a trailing error, even if the last test run passed 4/4. Status is
  now decided by the last test result; a post-test transport error is reported as
  `termination.kind: agent_error` instead.
- **Repeated edits to one file are no longer miscounted as unverified.** A file
  edited four times between two watcher polls produces fewer diffs than calls;
  the extra calls are now `supersededEdits` (file confirmed, diff already
  claimed) rather than `unverifiedEdits`.
- **Shell-wrapped test commands were not recognised.** Agents run
  `sh -lc 'node --test test.mjs'`, and the test-command matcher rejected the
  leading quote, so a passing run was recorded as `partial`. Quotes, parentheses
  and commas are now valid boundaries.

### Fixed (review blockers)

- **Task outcome is judged by the worktree.** The harness now runs the task's own
  command in the final tree and reads the result from that output; an agent's
  claim that it passed can no longer decide the verdict.
- **End reasons are separate.** `exitCode`, `signal` and `timedOut` are recorded
  independently. A green tree that the harness had to kill is `pass` + `timeout`,
  and it never enters `completedAgentLatency`.
- **Codex errors are classified.** 403 becomes `provider_unavailable`, 429 becomes
  `rate_limited`, instead of a generic stream error.
- **Edit recall can no longer exceed 100%.** `matchedEdits` counts native calls,
  not workspace facts, so two diffs landing on one call cannot inflate recall.
- **Retries append.** A retry is stored as a new `attempt`; the summary uses the
  latest attempt per task/agent/run, and the failed attempt stays visible.
- **A run with no available agent keeps the previous summary** and only refreshes
  the availability map, instead of overwriting results with zeros.
- **CRLF is normalized** in diff and patch artifacts, so stored diffs do not carry
  stray carriage returns.
- **XDG isolation dirs are removed** after each run.
- **Home-directory paths are sanitized** to `~/...` before a trace is written.

### Changed

- The free-model matrix is documented as **OpenCode Free-Model Capture
  Validation Matrix**, and its time column as **end-to-end wall-clock latency**.
  It validates the capture pipeline across models; it is not a model ranking.

### Known limitations

- Cursor's adapter is implemented and fixture-tested but has no live run: the
  CLI installs, but `cursor-agent` needs an interactive browser login.
- ZCode events are read from the session store after the process exits, not
  streamed live.
- The repository URL is not set in `package.json` yet.
