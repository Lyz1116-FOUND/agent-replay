# Agent Replay

**Record, replay, and compare how coding agents solve a task.**

See what the agent reported doing — and what actually changed.

[![Public beta](https://img.shields.io/badge/release-v1.0.0--beta.1-blue)](https://github.com/Lyz1116-FOUND/agent-replay/releases/tag/v1.0.0-beta.1)
[![CI](https://github.com/Lyz1116-FOUND/agent-replay/actions/workflows/ci.yml/badge.svg)](https://github.com/Lyz1116-FOUND/agent-replay/actions/workflows/ci.yml)
[English](README.md) · [简体中文](README.zh-CN.md)

[**Live Demo**](https://lyz1116-found.github.io/agent-replay/) · [Quick start](#quick-start) · [Docs](#documentation)

`FAIL → EDIT → REGRESSION → EDIT → RECOVERED`

[![Watch Agent Replay: a blue character follows a failing run back to an edit; tiny details carry every transition](docs/demo/launch-preview.gif)](https://lyz1116-found.github.io/agent-replay/launch/)

**[Watch the 24-second film with sound →](https://lyz1116-found.github.io/agent-replay/launch/)** · [Download MP4](https://github.com/Lyz1116-FOUND/agent-replay/releases/download/v1.0.0-beta.1/agent-replay-pointer-final-1080p60.mp4)

The silent preview is an excerpt. The film follows a reconstructed built-in LRU demo into labelled product footage, with an expressive 3D character and continuous detail-led transitions. [Media & evidence](docs/demo/README.md).

| Native capture | Verified evidence | Trace interoperability |
|---|---|---|
| Codex · Claude Code · OpenCode · ZCode · Qoder | Git · filesystem · parsed tests | SWE-agent · offline OpenTelemetry OTLP JSON |

The live demo needs no installation, API key, or login.

## Quick start

**Source installation only for this beta.** It is not published to npm; the npm package named `agent-replay` belongs to another project. Use the commands below to install Agent Replay.

Requires **Node.js 22.12+**, npm, and Git.

```bash
git clone https://github.com/Lyz1116-FOUND/agent-replay.git
cd agent-replay
npm ci
npm run dev
```

Open the URL printed in your terminal.

Try this first:

1. Open **Fix LRU cache eviction when capacity=1** for **Codex** from the Runs list. Its overview shows an initial failure and the later recovery.
2. Enter the detailed replay. Press **Space** to play or pause, use **← / →** to step, or drag the playhead to a test or edit.
3. Select an edit to inspect its diff; select a test to read the output. Switch to **Flame** to see timing and overlapping work.
4. Open **Compare** and choose the LRU task to see the Codex, Claude Code, and Cursor demos side by side.

The interface supports English and Chinese. Use **中文 / EN** in the top bar to switch languages.

## Features

### Replay a run, step by step

Start with an outcome summary, then follow the full execution in Story or Flame view. Play at 1×, 2×, 4×, or 8×, jump between events, and see where the agent spent time or changed direction.

![Detailed replay with timeline, artifact stage, and inspector](docs/replay.png)

### Inspect the evidence behind each step

Click a step to open its code, Monaco diff, terminal output, test summary, search results, or exposed reasoning summary. The Inspector shows timing, tool attributes, raw span data, and parent/child relationships. The workspace view connects file reads and edits to the timeline.

### Find failures and compare approaches

See test failures, regressions, and recoveries in the run's story. Compare up to four runs of the same task on a shared time scale, including outcomes, test activity, and how each agent divides its work between reading, editing, and testing.

![Multiple agents solving the same task in the Compare view](docs/compare.png)

### Check agent claims against workspace changes

The recorder combines native CLI events with git and filesystem observations. An edit reported by an agent can be confirmed by a workspace diff or shown as unverified. Capture and timing labels tell you which evidence a trace contains and when durations are estimated.

### Bring your existing traces

Import native Agent Replay JSON, SWE-agent trajectories, or offline OpenTelemetry OTLP JSON. OTel imports preserve hierarchy and overlapping spans, including multiple traces in one file. Imported data stays in your browser; local recordings stay on disk.

## Real capture, not only fixtures

The beta ships with a fresh live recording from **OpenCode 2.0.32 + `opencode/glm-5.3-flash-free`**: 43.4 s, one edit, two test runs, 3/3 tests passing at the end, one edit verified against the workspace, zero unverified edits. The trace is [here](examples/beta-opencode.trace.json), and the [capture evidence](docs/demo/REAL_CAPTURE.md) records the command, baseline failure, test-file checksum, and sanitization.

The LRU story in the film is a **built-in demo** and is labelled as such. The separate OpenCode recording remains available as capture evidence; the new film does not depict that session. Import bugs and traces can be filed through [Issues](https://github.com/Lyz1116-FOUND/agent-replay/issues).

## Record a session

Build the app and link the local CLI once, from the Agent Replay checkout:

```bash
npm run build
npm link
```

Then switch to the **Git repository you want the agent to work in**. Install and authenticate the selected agent CLI beforehand; model usage follows that CLI's provider and billing configuration.

```bash
cd /path/to/your-project
agent-replay record codex --name fix-lru -- "Fix the LRU cache eviction bug and run the tests"
agent-replay open fix-lru
```

The recorder writes `replays/fix-lru.trace.json` in the target project. `open` serves the built viewer locally and opens the recording in your browser.

Choose the adapter for your CLI:

| Agent | Command prefix | Validation |
|---|---|---|
| Codex | `agent-replay record codex` | Live recording verified |
| Claude Code | `agent-replay record claude` | Live recording verified |
| OpenCode | `agent-replay record opencode` | Live recording verified |
| Qoder CLI | `agent-replay record qoder` | Live recording verified |
| ZCode CLI | `agent-replay record zcode` | Live recording verified |
| Cursor | `agent-replay record cursor` | Adapter + fixtures; live recording pending |

See [validation and measurement](docs/validation.md) for the recorded versions, tasks, results, and measurement limits, and the [capture evidence](docs/demo/REAL_CAPTURE.md) for this beta’s OpenCode sample.

Add `--name <name> -- "<prompt>"` to any prefix above. To pass extra vendor flags, wrap an explicit command instead:

```bash
agent-replay record --adapter opencode --name fix-lru -- \
  opencode run --format json --auto "Fix the LRU cache eviction bug and run the tests"
```

For a desktop agent or an interactive workflow, use passive recording:

```bash
agent-replay start --name desktop-fix --agent Codex
# Use your agent normally in this repository.
agent-replay run -- npm test   # Optional: capture a test command explicitly.
agent-replay stop
agent-replay open desktop-fix
```

Passive mode observes workspace changes; native mode also captures the agent's tool stream. See the [recording guide](docs/recording.md) for permissions, generic command wrapping, and adapter-specific details.

## Import a trace

1. Start the viewer with `npm run dev` and click **Import trace**.
2. Drop a file, choose one from disk, or paste its contents, then click **Import**.
3. If the file contains several traces or import diagnostics, review the dialog and choose a trace to open.

| Format | What to import | Try an example |
|---|---|---|
| Agent Replay | `agent-replay/v1` JSON from the recorder or another producer | [Native sample](examples/native-sample.trace.json) |
| SWE-agent | A `.traj` trajectory file | [Sample trajectory](examples/swe-agent-sample.traj) |
| OpenTelemetry | An OTLP JSON `ExportTraceServiceRequest` | [OTel fixtures and exporter sample](examples/otel/) |

The import dialog also includes a built-in SWE-agent sample. No agent execution is needed to replay imported files.

**OTel scope:** offline JSON only. Protobuf, gRPC, JSONL, and a collector endpoint are not supported. OTel spans describe exported activity; they do not establish whether a coding task passed, and imports are labelled as not workspace verified. See [trace formats](docs/trace-formats.md) for timestamp requirements and [OTel contracts](docs/M5_OTEL_CONTRACTS.md) for compatibility limits.

## Compare your own runs

**Current limitation:** the CLI has no separate task-grouping option. Recordings with different names require manually matching their trace JSON `task.id` values before Compare can group them under one task.

1. Record each attempt with a distinct name, such as `codex-fix` and `claude-fix`, so the output files do not overwrite each other.
2. Before importing, edit the trace JSON files so their `task.id` fields share a value, such as `lru-fix`. Keep each trace's top-level `id` unique. The recorder derives `task.id` from `--name`, so differently named recordings need this adjustment to be grouped together.
3. Import the files, open **Compare**, select the shared task, and choose up to four runs.

## FAQ

**Does Agent Replay run a model?**

The viewer does not call a model. `record` launches the agent CLI you select, which uses its own credentials, permissions, and billing.

**Where is my data stored?**

Imported traces persist in browser `localStorage`. Recordings are written to the target project's `replays/` directory. Agent Replay does not automatically upload them. Inspect a trace for sensitive source code, terminal output, or credentials before sharing it.

**Can I compare my own runs?**

Yes. Follow [Compare your own runs](#compare-your-own-runs) to group recordings under one task. A step URL identifies a position in a trace; recipients also need access to that trace.

**Does it capture hidden chain-of-thought?**

No. It shows observable tool activity and reasoning summaries exposed by the agent product. It does not access model internals.

## Documentation

- [Recording guide](docs/recording.md) — native capture, passive mode, CLI flags, and fidelity labels.
- [Trace formats](docs/trace-formats.md) — native schema, SWE-agent mapping, and OTLP JSON import.
- [Validation and measurement](docs/validation.md) — real recordings, task matrix, recall, coverage, and timing definitions.
- [Architecture](docs/architecture.md) — adapters, event merger, trace builder, and replay UI.
- [Demo media](docs/demo/README.md) · [live capture evidence](docs/demo/REAL_CAPTURE.md).
- [Release notes](docs/RELEASE_v1.0.0-beta.1.md) · [Changelog](CHANGELOG.md) · [Historical plan (M0–M4)](PLAN.md).

## Development

```bash
npm run dev        # Web development server
npm test           # Unit and integration tests
npm run lint       # Lint
npm run build      # Type-check, web app, recorder CLI, and validation harness
```

Bug reports and contributions are welcome through [Issues](https://github.com/Lyz1116-FOUND/agent-replay/issues), [Discussions](https://github.com/Lyz1116-FOUND/agent-replay/discussions), and pull requests. For import bugs, include the format, diagnostics, and a small sanitized trace that reproduces the issue.

## License

[MIT](LICENSE) for the application. The new launch-film pipeline uses onetake under its noncommercial license; see [media licensing](docs/demo/launch-pointer/README.md).
