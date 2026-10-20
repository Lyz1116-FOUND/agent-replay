# Changelog

## 1.0.0-beta.1 — 2026-10-21

First public beta. Capture, verification, replay, comparison, and OTLP JSON import now form the v1 core loop. This release is about shipping the existing loop, not adding another milestone.

### Added

- **Hosted demo build.** `npm run build:demo` creates a GitHub Pages build with a `/agent-replay/` base and hash routing; `/` opens the Codex LRU failure step at 4× and `/runs` keeps the list reachable. Normal builds and the CLI viewer keep BrowserRouter.
- **Presentation assets.** A 20-second replay GIF, an MP4 for the release page, six key-frame screenshots, a 1280×640 social preview, and a reproducible `scripts/record-demo.mjs`.
- **Live OpenCode capture.** A fresh free-model run (`opencode/glm-5.3-flash-free`) is included as `examples/beta-opencode.trace.json`, with command, baseline, checksum, and sanitization evidence in `docs/demo/REAL_CAPTURE.md`. It is separate from the built-in demo.
- **Feedback surfaces.** Issue templates for bugs and feature requests, Discussions enabled, and the version badge updated to `v1.0 β`.
- **Bilingual UI (English / Chinese).** Interface copy lives in a typed catalog
  (`src/i18n/messages.ts`); the locale follows the browser on first visit, the
  top-bar toggle persists in `localStorage`, and `<html lang>` follows the
  choice. Plurals use `_one` / `_other` keys, dates and numbers use the active
  locale, and recorded phase names (`Discover`, `Attempt 1`, …) get translated
  labels without changing the data. Trace content and import diagnostics are
  intentionally not translated.
- **OTLP JSON import.** An `ExportTraceServiceRequest` file can be dropped into
  *Import trace*. One file may hold several traceIds; each becomes its own run
  and the dialog lists them instead of silently keeping the first. Contract:
  [`docs/M5_OTEL_CONTRACTS.md`](docs/M5_OTEL_CONTRACTS.md).
- **Exact timestamps.** `startTimeUnixNano` / `endTimeUnixNano` are subtracted as
  BigInt before any millisecond conversion, so a 1 ns difference survives and a
  zero-duration span stays zero.
- **Hierarchy and parallelism.** `parentSpanId` becomes `parentId`; parents stay
  selectable in the timeline, overlapping same-type spans get their own flame
  rows, and a child may outlive its parent without either span being resized.
- **Honest OTel semantics.** `gen_ai.operation.name` and exact `tool.name`
  values map to span types; anything else stays `unknown` with
  `otel.typeSource: fallback`. New span types `generation` and `unknown`, new
  status `unset` (which is not success).
- **Raw preservation.** Nested `kvlistValue`, mixed arrays, `bytesValue`,
  events, links, resource/scope metadata and dropped counts stay verbatim in
  `span.raw.otlp` / `trace.metadata.otel`; flat scalars also appear in the
  inspector. int64 beyond 2^53 keeps its exact decimal string.
- **Fixtures and tests.** `examples/otel/` covers generic, nested, parallel,
  error, AI, multi-trace, nanosecond precision, async child, nested attributes,
  unset status and snake_case payloads, plus one payload captured from a real
  `@opentelemetry/sdk-trace-node` 2.12.0 / OTLP/HTTP JSON exporter. 21 tests in
  `src/adapters/otel.test.ts`, including cycle, self-parent, invalid id and
  negative-duration counterexamples.

### Fixed (review round 1)

- **Resource attribution across traces.** A trace now keeps only the resources
  it used, `span.raw.resourceIndex` points into that local array, and
  `agent.name` comes from the earliest span's resource instead of the first
  `service.name` in the file. `metadata.otel.services` lists every service the
  trace spans.
- **Hex id casing.** `traceId` / `spanId` / `parentSpanId` are lowercased before
  grouping, parent lookup, cycle checks and duplicate detection, so the same
  trace written in mixed case is one run. Raw spans keep the original casing.
- **Resource/scope context is no longer dropped.** Each record keeps the
  verbatim `resource` / `scope` objects plus `droppedAttributesCount`, scope
  `attributes` and the original file index; a serialize → re-import round trip
  preserves them.
- **Nested arrays no longer fail the import.** Only homogeneous primitive arrays
  reach the flat attribute channel; arrays of arrays stay raw.
- **Numeric timestamps are rejected** with an explicit message instead of
  silently rounding away nanoseconds after `JSON.parse`; unsafe numeric
  `intValue`s are kept raw and counted.
- **Tool spans stay tool spans.** `gen_ai.operation.name=execute_tool` without a
  tool name no longer falls through to `generation`, and provider/model
  attributes alone no longer imply an LLM call.
- **Single-trace imports show diagnostics.** A lone trace with warnings stays in
  the import dialog so orphan/precision notes are visible.
- **No recovery story from generic attributes.** OTel `passed` / `failed` /
  `total` attributes no longer enter the test-result channel; a span with only
  `total=7` stays "Outcome not evaluated" instead of a green "0 passed" beat.
  An explicit `test` artifact still counts.

### Changed

- `capture.fidelity` gains `otel`; `capture.workspaceVerification` is explicit
  (`verified | partial | unavailable`). OTel imports never claim workspace
  verification or a task verdict: `status` stays `partial`, `result.tests` is
  empty, `termination` is absent.
- The replay playlist now includes parent spans (`playbackSpans`); statistics
  and the outcome story still use leaves.
- `importTraceText()` is replaced by `importTraceFile()`, which returns every
  trace in the file plus diagnostics.
- Schema: dangling parents and children that outlive a parent are accepted only
  for `fidelity: otel`; native recordings keep the strict containment rule.
  Parent-chain cycles are now rejected for every trace.

### Presentation and distribution

- README and Chinese README lead with the live demo, a replay GIF, and the
  "reported vs. actual" distinction; the built-in demo is labelled in the UI.
- The npm package was evaluated but **not published**; installation remains
  source-based (`git clone` + `npm link`) for this beta.
- `package.json`, lockfile, CLI, recorder fingerprint, and top-bar badge are
  versioned as `1.0.0-beta.1`; historical 0.3.0 traces are unchanged.
- Cursor still has an adapter and fixtures but no live run; it is not presented
  as live-verified.

## 0.3.0 — 2026-10-20

First internal beta. The focus of this release is not more adapters — it is
making a recorded trace trustworthy enough to argue about.

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

### Fixed (review blockers, round 2)

- **The verdict can no longer be gamed.** A green summary from a command that
  exited non-zero is a failure, and a run that rewrote a protected test file is
  recorded as `fail` with `reason: tests_modified` instead of passing.
- **Saved traces agree with the ledger.** The harness rewrites `termination` in
  the stored trace (a killed-but-green run is `timeout`, not `completed`) and
  stamps `metadata.harness` with attempt, exit code, signal and timeout.
- **Codex `turn.failed` is classified.** It now emits a classified error event
  alongside the final event, so a 403/429 no longer lands as a task failure.
- **Test recall uses parsed/native.** An extra command-driven test run can no
  longer push `testCaptureRecall` past 100%.
- **Each attempt has its own trace file** (`task-agent-run-aN.trace.json`); a
  retry no longer overwrites the evidence it is retrying.
- **A failed edit call is not a claim.** Edit calls that errored are counted as
  `failedEdits` instead of `unverifiedEdits`, so a tool failure is not reported
  as a fidelity gap.
- **Patches apply.** `diffPatch` keeps the trailing newline that `git apply`
  requires; the regression test round-trips a real repository.
- **Historical traces are sanitized** as well, not just new ones.

### Fixed (review blockers, round 3)

- **The tamper check runs before the tests, not after.** A test file that
  restores its original while executing used to slip past a post-hoc hash; the
  hash is now taken before the command runs, and a modified tree is refused
  without executing anything.
- **Patches keep their raw bytes.** `diffPatch` no longer goes through `git()`,
  which trims trailing whitespace and silently deletes trailing blank context
  lines; a file ending in a blank line now round-trips through `git apply`.
- **Capture coverage is reported.** `captureCoverage` states how many runs
  produced a trace, so a 100% recall over 8 of 9 runs cannot be read as full
  coverage.

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
