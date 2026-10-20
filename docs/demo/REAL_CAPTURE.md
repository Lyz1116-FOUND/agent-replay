# OpenCode free-model live capture

This is a real recorder run, not a built-in demo trace.

- Recorded: 2026-10-21 02:25 Asia/Tokyo (`2026-10-20T17:25:26Z`)
- Agent CLI: OpenCode 2.0.32
- Model: `opencode/glm-5.3-flash-free` (free tier; no paid model was invoked)
- Recorder: Agent Replay 1.0.0-beta.1
- Host: macOS arm64, Node v26.0.0
- Isolation label: `host-config` (the recorder used the host OpenCode config; no global config was changed)
- Task: `examples/tasks/single-file-bug` (`calc.mjs` + `test.mjs`)
- Trace: [`examples/beta-opencode.trace.json`](../../examples/beta-opencode.trace.json)

## Command

The recorder was run from the Agent Replay checkout against a temporary git repository:

```bash
node dist-cli/agent-replay.mjs record \
  --cwd /tmp/agent-replay-beta \
  --adapter opencode \
  --name beta-opencode \
  --model opencode/glm-5.3-flash-free \
  --provider opencode \
  --harness-version 2.0.32 \
  --isolation host-config \
  -- opencode run --format json \
       --model opencode/glm-5.3-flash-free --auto \
       "Run node --test first, fix calc.mjs minimally without changing test.mjs, then run node --test again. Work only in this repository."
```

The `--model` on the recorder is metadata only. The model selection for the agent came from the explicit `opencode run --model` arguments after `--`.

## Result

| Check | Observed |
|---|---|
| Baseline tests | 0 passed, 3 failed |
| Final tests | 3 passed, 0 failed |
| Agent duration | 43.4 s |
| Native events | 12 spans |
| Edits | 1 native edit |
| Test runs | 2 native test runs, 2 parsed |
| Capture fidelity | `native+workspace` |
| Workspace verification | 1 verified, 0 unverified |
| Termination | `completed` |
| Test file | `test.mjs` SHA-256 unchanged before/after (`15550e09…a334`) |
| Changed file | `calc.mjs` (`+1 / -1`) |

The recorded diff is the minimal fix:

```diff
 export function bump(value) {
-  return value
+  return value + 1
 }
```

## Sanitization

For the public sample, absolute temporary paths were normalized from `/private/tmp/agent-replay-beta.ckiFZZ` to `/tmp/agent-replay-beta`; the task title/repo were set to readable labels, and the provider session ID was removed. No test output, timing, span, diff, or verification count was changed. The trace re-validates against `agent-replay/v1`.

The baseline `test.mjs` checksum and the unedited raw trace remain available in the local temporary directory used for this run; they are not committed.

## Reproduce

Use the same task files in a fresh temporary git repository, run the baseline, then use the command above with a currently available free OpenCode model. Do not reuse this trace as evidence for a different model or date.
