# Agent Replay

**Replay your coding agent’s work. Understand what changed.**

Agent Replay turns recorded coding sessions into an interactive timeline. Follow the files an agent read, inspect its edits, and see when tests failed or recovered. Compare runs to understand how different agents approached the same task.

[![Public beta](https://img.shields.io/badge/release-v1.0.0--beta.1-blue)](https://github.com/Lyz1116-FOUND/agent-replay/releases/tag/v1.0.0-beta.1)
[![CI](https://github.com/Lyz1116-FOUND/agent-replay/actions/workflows/ci.yml/badge.svg)](https://github.com/Lyz1116-FOUND/agent-replay/actions/workflows/ci.yml)

[English](README.md) · [简体中文](README.zh-CN.md)

[**Try the live demo**](https://lyz1116-found.github.io/agent-replay/) · [Install locally](#quick-start) · [Record a session](#record-a-session) · [Documentation](#documentation)

[![Agent Replay launch film: a blue character follows a failing test back to an edit and replays the recovery](docs/demo/launch-preview.gif)](https://lyz1116-found.github.io/agent-replay/launch/)

[Watch the 24-second film with sound](https://lyz1116-found.github.io/agent-replay/launch/) · [Download MP4](https://github.com/Lyz1116-FOUND/agent-replay/releases/download/v1.0.0-beta.1/agent-replay-pointer-final-1080p60.mp4)

## Quick start

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

## What you can do

- **Replay a session.** Follow reads, edits, commands, and tests on a timeline. Pause, change playback speed, or jump straight to a step.
- **Inspect a failure.** Open test output and nearby diffs to see what changed before a regression or recovery.
- **Compare approaches.** View up to four runs of the same task side by side, including outcomes, timing, and test activity.
- **Check reported edits.** See which agent-reported changes were confirmed by workspace diffs and which remain unverified.

![Replay view with a timeline, code changes, test output, and step details](docs/replay.png)

## Record a session

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

## Import a trace

Already have a recording? Click **Import trace** in the viewer, drop in a file or paste its contents, and open the imported run. You do not need to execute an agent to replay it.

| Format | Example |
|---|---|
| Agent Replay JSON | [Native trace](examples/native-sample.trace.json) |
| SWE-agent `.traj` | [Sample trajectory](examples/swe-agent-sample.traj) |
| OpenTelemetry OTLP JSON | [Exporter samples](examples/otel/) |

OpenTelemetry support is **offline JSON only**. It preserves exported span hierarchy and overlapping activity, but does not verify workspace changes. Protobuf, gRPC, JSONL, and collector endpoints are not supported. See [trace formats](docs/trace-formats.md) for details.

## Compare your own runs

Open **Compare** to explore the built-in LRU demos. For your own recordings, runs must share a `task.id` to appear under the same task.

<details>
<summary>Set up task grouping for your recordings</summary>

The CLI currently derives `task.id` from `--name`; it has no separate task-grouping option.

1. Record each attempt with a different name, such as `codex-fix` and `claude-fix`, to avoid overwriting files.
2. Before importing, edit their trace JSON files so `task.id` has the same value, such as `lru-fix`. Keep each trace’s top-level `id` unique.
3. Import the files, open **Compare**, select the shared task, and choose up to four runs.

For example, edit these fields in the existing Codex trace, keeping its other contents:

```json
{
  "id": "codex-fix",
  "task": { "id": "lru-fix" }
}
```

Use `claude-fix` as the other trace’s `id`, with the same `task.id` of `lru-fix`.

</details>

## Data and evidence

Recordings stay in your project’s `replays/` directory. Imported traces are stored in browser `localStorage`. Agent Replay does not automatically upload them. Keep your original trace files: clearing the site’s browser data removes imported runs. Check for sensitive code, terminal output, or credentials before sharing a file.

Capture labels distinguish agent-reported activity from workspace-verified changes. The viewer shows observable tool activity and reasoning summaries exposed by an agent product; it does not access hidden chain-of-thought or model internals.

Built-in examples are labelled **DEMO**. The launch film reconstructs one of these examples and includes labelled product footage. The repository also includes a [real OpenCode recording](examples/beta-opencode.trace.json), with its commands, test results, and verification documented in [capture evidence](docs/demo/REAL_CAPTURE.md).

## Documentation

- [Recording guide](docs/recording.md) — native capture, passive recording, and CLI options.
- [Trace formats](docs/trace-formats.md) — supported files, schema, and import limits.
- [Validation and measurement](docs/validation.md) — tested agents, tasks, and evidence boundaries.
- [Architecture](docs/architecture.md) · [Contributing](CONTRIBUTING.md) — for contributors.
- [Release notes](docs/RELEASE_v1.0.0-beta.1.md) · [Changelog](CHANGELOG.md) · [Demo media](docs/demo/README.md).

## Development

```bash
npm test          # Unit and integration tests
npm run lint      # Code checks
npm run build     # Build the web viewer and CLI
```

[Report a bug](https://github.com/Lyz1116-FOUND/agent-replay/issues) · [Ask a question](https://github.com/Lyz1116-FOUND/agent-replay/discussions)

## License

The application is [MIT licensed](LICENSE). The launch-film pipeline uses onetake under its noncommercial license; see [media licensing](docs/demo/launch-pointer/README.md).
