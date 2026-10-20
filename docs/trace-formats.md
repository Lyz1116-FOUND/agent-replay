# Trace formats

[English README](../README.md) · [中文 README](../README.zh-CN.md)

### Native trace

A trace is a task, an agent, a result, and a flat list of timed spans:

```json
{
  "schemaVersion": "agent-replay/v1",
  "id": "run_123",
  "task": { "id": "lru-capacity-1", "title": "Fix LRU eviction" },
  "agent": { "name": "Codex", "model": "gpt-5-codex" },
  "status": "pass",
  "startedAt": "2026-10-19T14:32:07Z",
  "endedAt": "2026-10-19T14:32:09Z",
  "durationMs": 2600,
  "result": { "summary": "Fixed eviction direction." },
  "spans": [
    {
      "id": "s01",
      "type": "read",
      "name": "src/cachekit/lru.py",
      "startMs": 0,
      "endMs": 1200,
      "status": "ok",
      "files": ["src/cachekit/lru.py"],
      "artifacts": [
        {
          "kind": "code",
          "path": "src/cachekit/lru.py",
          "language": "python",
          "content": "..."
        }
      ]
    }
  ]
}
```

Span types are a closed set: `agent`, `generation`, `reasoning`, `read`, `search`, `edit`, `shell`, `test`, `browser`, `tool`, `unknown`, `checkpoint`, `final`. Artifacts are `code`, `diff`, `terminal`, `test`, `search`, `reasoning`, `patch`, `markdown`, `browser`.

See [`examples/native-sample.trace.json`](../examples/native-sample.trace.json), the wrapped-output sample [`examples/recorded-sample.trace.json`](../examples/recorded-sample.trace.json), and real native+workspace captures [`examples/real-claude.trace.json`](../examples/real-claude.trace.json) / [`examples/real-opencode.trace.json`](../examples/real-opencode.trace.json) / [`examples/real-qoder.trace.json`](../examples/real-qoder.trace.json) / [`examples/real-glm-flash.trace.json`](../examples/real-glm-flash.trace.json).

### SWE-agent `.traj`

Use **Import trace → Use sample .traj** to try the bundled example, or drop a real `.traj` file. The adapter:

1. maps ACI commands to span types (`open` → read, `search_dir` → search, `edit` → edit, `pytest` → test, `submit` → final);
2. derives phases (Explore → Modify → Verify → Submit);
3. parses pass/fail counts from test observations;
4. synthesizes deterministic durations from action type and observation size, marked `estimatedTiming: true`;
5. marks submitted runs `partial`, because benchmark evaluation is not part of the trajectory.

See [`examples/swe-agent-sample.traj`](../examples/swe-agent-sample.traj).

### OpenTelemetry (OTLP JSON)

Drop an `ExportTraceServiceRequest` JSON file — what `OTEL_EXPORTER_OTLP_PROTOCOL=http/json` and most exporters emit — into **Import trace**. One file may contain several traceIds; each becomes its own run, and the dialog lists them so nothing is silently dropped.

- **Exact time.** `startTimeUnixNano` / `endTimeUnixNano` must be decimal strings, parsed as BigInt and only converted to display milliseconds after subtraction, so a 1 ns difference stays 1 ns. Numeric timestamps are rejected because `JSON.parse` has already rounded them. Zero-duration spans stay zero.
- **Real hierarchy.** `parentSpanId` is kept as `parentId`; parents stay selectable in the timeline. Overlapping siblings get separate rows in the flame view instead of drawing on top of each other.
- **Honest semantics.** `gen_ai.operation.name` and exact `tool.name` values map to span types (`chat` → LLM, `bash` → shell, `read_file` → read). Anything unrecognized stays `unknown` with `otel.typeSource` saying why; names are never pattern-matched, and provider/model attributes alone do not imply an LLM call.
- **No task verdict.** OTel `status.code` becomes `ok` / `error` / `unset`; `unset` is not success. `trace.status` stays `partial`, tests are left empty, and no `termination` is invented. A tool error followed by a success is not a recovered task.
- **Nothing lost.** Nested `kvlistValue`, arrays of arrays, `bytesValue`, events, links, and the verbatim `resource` / `scope` objects (including scope attributes and dropped counts) stay in `span.raw.otlp` / `trace.metadata.otel`; flat scalars are also surfaced in the inspector. Hex ids are matched case-insensitively, and each trace keeps only the resources it used.
- **Partial exports are allowed.** A child may outlive its parent, and a missing parent stays a dangling reference (reported as a diagnostic) rather than being re-parented. Cycles and invalid ids are rejected.

![OTel import](otel-import.png)

Contract details and the fixture matrix: [`docs/M5_OTEL_CONTRACTS.md`](M5_OTEL_CONTRACTS.md). Fixtures: [`examples/otel/`](../examples/otel/).
