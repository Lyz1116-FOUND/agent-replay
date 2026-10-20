# Agent Replay v1.0.0-beta.1

**Record, replay, and compare how coding agents solve a task.**

See what the agent reported doing — and what actually changed.

This is the first public beta of Agent Replay, an open-source visual debugger for coding-agent sessions. The v1 core loop is complete: native capture, workspace verification, normalized traces, replay, comparison, and trace interoperability. This release is about making that loop usable and inspectable, not adding another feature milestone.

## Try it

- **Live demo:** https://lyz1116-found.github.io/agent-replay/ — opens the Codex LRU failure and recovery; no install, API key, or login.
- **Source:** clone the repository, `npm ci`, `npm run dev`. Node.js 22.12+.
- **Record a real session:** `npm run build && npm link`, then `agent-replay record opencode --name my-run -- "your task"` in the target git repository. See the [recording guide](https://github.com/Lyz1116-FOUND/agent-replay/blob/main/docs/recording.md).

## Highlights

- **Replay with evidence.** Follow reads, edits, shell commands, and test runs; open diffs, test output, timing, and raw span data.
- **Verification, not just claims.** The recorder combines native CLI events with git/filesystem observations. Edits can be confirmed by a workspace diff or shown as unverified.
- **Compare agents.** Put up to four runs of the same task on a shared scale and compare outcomes, test activity, and pacing.
- **Import what you have.** Native Agent Replay JSON, SWE-agent `.traj`, and offline OpenTelemetry OTLP JSON. OTel imports preserve hierarchy and overlapping spans, and are explicitly not workspace-verified.
- **Bilingual UI.** English and Chinese, switchable in the top bar.
- **Live capture included.** A fresh OpenCode 2.0.32 + `opencode/glm-5.3-flash-free` run: 43.4 s, 1 edit, 2 test runs, 3/3 passing, 1 verified edit, 0 unverified. See [the capture evidence](https://github.com/Lyz1116-FOUND/agent-replay/blob/main/docs/demo/REAL_CAPTURE.md).
- **Demo media.** A 20-second replay GIF and MP4 are attached to this release and embedded in the README. The built-in demo is labelled in the UI; it is not presented as a live capture.

## Verified during beta development

- CI runs typecheck, 210 tests, lint, and the full web/CLI build on Ubuntu and macOS with Node 22 and 24.
- Live validation covers OpenCode, Claude Code, Qoder CLI, ZCode CLI, and Codex. Cursor has an adapter and fixtures but no live run yet.
- The validation matrix, recall definitions, and timing buckets are documented in [Validation and measurement](https://github.com/Lyz1116-FOUND/agent-replay/blob/main/docs/validation.md). The matrix is not a model ranking.

## Demo GIF

![Agent Replay demo](https://raw.githubusercontent.com/Lyz1116-FOUND/agent-replay/v1.0.0-beta.1/docs/demo/replay.gif)

The `replay.mp4` asset attached to this release is a 1440×900, 20-second version. The animation uses the built-in Codex LRU demo, replays at 4×, and is trimmed at the start/end; the four intermediate frames and the overview are real UI states.

## Known limits

- **Cursor:** adapter and fixtures only; live recording is pending because `cursor-agent` requires an interactive browser login.
- **OTel scope:** offline OTLP JSON only. Protobuf, gRPC, JSONL, and a collector endpoint are not supported. Imported spans do not establish that a coding task passed and are never counted as workspace-verified.
- **Storage:** imported traces live in browser `localStorage`; recorded traces live in the target project's `replays/` directory. Nothing is uploaded automatically. Inspect traces for source code, terminal output, and credentials before sharing.
- **Demo vs. real:** built-in demo runs are labelled `DEMO`; the shipped OpenCode capture is real and labelled by its recorder metadata. Do not treat the built-in demos as validation evidence.
- **Beta:** the trace schema, CLI flags, and UI may change before 1.0.0 stable. The npm package is not published in this beta; installation is from source.

## Feedback

- [Issues](https://github.com/Lyz1116-FOUND/agent-replay/issues) for bugs and reproducible import problems. Include the format, diagnostics, and a minimal sanitized trace.
- [Discussions](https://github.com/Lyz1116-FOUND/agent-replay/discussions) for usage questions and ideas.
- [Contributing](https://github.com/Lyz1116-FOUND/agent-replay/blob/main/CONTRIBUTING.md).

## License

MIT.
