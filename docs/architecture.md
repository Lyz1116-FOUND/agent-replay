# Architecture and design

[English README](../README.md) · [中文 README](../README.zh-CN.md)

```
cli/
├── index.ts              agent-replay start/stop/run/record/open/list
├── adapters/
│   ├── types.ts          AgentEvent + AgentStreamAdapter interface
│   ├── cursor.ts         stream-json tool_call started/completed
│   ├── codex.ts          exec --json item events
│   ├── claude.ts         assistant tool_use / user tool_result
│   ├── opencode.ts       tool_use state with real timings
│   ├── qoder.ts          Qoder CLI (Claude-compatible stream)
│   ├── zcode.ts          ZCode CLI (session-store parts)
│   └── fixtures/         event-shape fixtures
├── validation/           task verification, ledger, and measurement summaries
└── lib/
    ├── git.ts            baseline, status, diff, patch, rename
    ├── workspace.ts      polling watcher + delete/rename reconciliation
    ├── testParser.ts     pytest/jest/node/cargo fallback parsing
    ├── eventMerger.ts    native tools + workspace facts → merged spans
    ├── traceBuilder.ts   merged spans → agent-replay/v1
    ├── recorder.ts       session orchestration + native/generic capture
    ├── openServer.ts     local static server for agent-replay open
    └── traces.ts         replay discovery

src/
├── schema/trace.ts       Zod schema + inferred TypeScript types
├── adapters/
│   ├── import.ts         format detection + native validation + structured errors
│   ├── sweAgent.ts       .traj → normalized Trace
│   ├── otel.ts           OTLP JSON → one Trace per traceId
│   └── import.test.ts
├── data/                 demo repository, four traces, sample .traj
├── store/
│   ├── replay.ts         playhead, current span, hover, stage view
│   ├── runs.ts           persisted imported traces (localStorage)
│   └── hooks.ts          derived current-span selector
├── components/replay/    timeline, stage, workspace, inspector, player
├── components/ui/        design primitives
├── i18n/                 English and Chinese interface copy
├── pages/                Runs, Replay, Compare
└── lib/                  time, trace indexing, artifacts, Monaco setup
```

Key decisions:

- **Trace is flat.** `spans[]` with optional `parentId`, aligned with OpenTelemetry rather than a bespoke nested step format.
- **Rendering is data-driven.** A preferred-artifact registry selects the stage renderer; there is no `if agent === "codex"` in the UI.
- **Playback has one clock.** `playheadMs` drives the player, scrubber, flame chart, timeline progress, and workspace state. `currentSpanId` is derived at boundaries so large panels do not re-render at 60 fps.
- **Monaco is lazy.** The Runs page ships without the editor bundle; opening a replay loads it.
- **The recorder is an observer.** It does not hook agent internals. Native events come from vendor CLIs; workspace facts come from git + the filesystem.
- **Adapters never build traces.** Codex/Cursor/Claude emit `AgentEvent`; the EventMerger pairs tool calls with workspace diffs; the TraceBuilder owns the schema.
- **One schema, one UI.** CLI output, native JSON, SWE-agent imports, and demo traces all pass the same Zod schema and semantic invariants.
- **No backend.** Demo traces are bundled, imports persist locally, and recorder traces are served by a local `agent-replay open` process.

## Design references

- [Transformer Explainer](https://poloclub.github.io/transformer-explainer/) — progressive disclosure and linked views
- [SWE-agent](https://swe-agent.com/latest/usage/trajectories/) — trajectory format and inspector
- [Netron](https://github.com/lutzroeder/netron) — graph + document inspector layout
- [TensorFlow Playground](https://playground.tensorflow.org) — controls and results on one screen
- [Chrome DevTools Performance](https://developer.chrome.com/docs/devtools/performance) — time as an axis, flame charts
- [Algorithm Visualizer](https://github.com/algorithm-visualizer/algorithm-visualizer) — execution/renderer separation
- [OpenTelemetry traces](https://opentelemetry.io/docs/concepts/signals/traces/) — trace/span data model
- [GitHub Primer](https://primer.style) — neutral, dense developer-tool visual language
