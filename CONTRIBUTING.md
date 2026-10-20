# Contributing

Agent Replay records coding-agent sessions and replays them against workspace
facts. The most valuable contribution is usually not a feature — it is evidence
that a recording is wrong.

## Prerequisites

- Node.js >= 22.12 (the test toolchain requires it)
- git (the recorder needs a worktree)

The bundled CLI itself runs on Node >= 20. The `zcode` adapter needs Node >= 22.5
for `node:sqlite`; without it, ZCode falls back to workspace-only capture.

## Setup

```bash
npm ci
npm test        # 100+ tests, no network required
npm run lint
npm run build
```

`npm run dev` starts the replay UI. `npm run build` produces `dist/` (UI) and
`dist-cli/agent-replay.mjs` (CLI).

## The rule that matters most

**Never present a fixture, a simulated stream, or an estimated duration as live
evidence.** In code, tests, issues, and pull requests, keep these three layers
separate:

| Layer | What it proves |
|---|---|
| Unit / fixture tests | the parser handles a known event shape |
| Simulated E2E | the pipeline runs end to end with a fake agent |
| Live CLI run | a real agent produced these events on this machine |

If you only have the first two, say so. A missing live run is a gap, not a
failure — a fabricated one is a defect.

## Adding an adapter

1. Implement `AgentStreamAdapter` from `cli/adapters/types.ts`:
   - `detect(command, args)` — match only the flags you actually parse
   - `buildCommand(prompt)` — the minimal non-interactive invocation
   - `parseLine(line, receivedAtMs)` — emit normalized `AgentEvent`s
   - `finalize()` — optional, for CLIs that only emit a summary at exit
2. Register it in `cli/adapters/index.ts` and add the id to `AgentId`.
3. Add a fixture under `cli/adapters/fixtures/` plus a `<name>.test.ts`.
4. Record one real session and add it to `cli/adapters/real-traces.test.ts`.
   A fixture-only adapter is not finished.

Two rules learned the hard way:

- **Timestamps are relative.** The recorder passes elapsed milliseconds, not
  epoch milliseconds. If your source stores absolute time, convert it.
- **Report the real error.** If a provider returns 403/429, classify it with
  `classifyFailure` in `cli/lib/termination.ts`. A provider outage is not a
  failed task, and it must not be counted as one.

## Recording a real trace

```bash
# fresh repo so the diff is unambiguous
mkdir /tmp/probe && cd /tmp/probe && git init && git commit --allow-empty -m init

agent-replay record opencode \
  --name my-probe \
  --isolation xdg \
  --harness-version 2.0.32 \
  -- opencode run --standalone --format json --auto --model <model> "<prompt>"
```

Then check the trace before trusting it:

- `capture.fidelity` should be `native+workspace` if you expect verification
- `capture.integrity.matchedEdits` should equal `nativeEdits`
- `termination.kind` should be `completed` or `task_failure`, not
  `provider_unavailable`

If `matchedEdits` is 0 while the agent reported edits, that is a capture bug —
open an issue with the trace, not just a screenshot.

## Repository hygiene

Do not commit `node_modules/`, `dist/`, `dist-cli/`, `replays/`, or `.agent-replay/`.
When sharing source as an archive, exclude `node_modules/` — a stale native
binding from another platform breaks `npm test` for everyone else.

## CI

Every push and pull request runs `npm ci`, `typecheck`, `test`, `lint`, and
`build` on Ubuntu and macOS with Node 22 and 24. Path-semantics bugs are common
on macOS (`/tmp` vs `/private/tmp`), so both platforms are required.
