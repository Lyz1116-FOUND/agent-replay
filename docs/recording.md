# Recording guide

[English README](../README.md) · [中文 README](../README.zh-CN.md)

The recorder combines two sources: **native agent events** and **workspace facts**. It never hooks agent internals and never reads hidden chain-of-thought.

```bash
npm run build
npm link            # optional: put `agent-replay` on your PATH
agent-replay --help
# without linking:
npm run cli -- --help
```

### Native capture (recommended)

```bash
agent-replay record cursor   --name cursor-lru   -- "fix the LRU cache bug"
agent-replay record codex    --name codex-lru    -- "fix the LRU cache bug"
agent-replay record claude   --name claude-lru   -- "fix the LRU cache bug"
agent-replay record opencode --name opencode-lru -- "fix the LRU cache bug"
agent-replay record qoder    --name qoder-lru    -- "fix the LRU cache bug"
agent-replay record zcode    --name zcode-lru    -- "fix the LRU cache bug"
agent-replay open cursor-lru
```

The CLI builds the structured-event command for the selected agent:

| Agent | Command | Adapter |
|---|---|---|
| Cursor | `cursor-agent -p --output-format stream-json "<prompt>"` | `tool_call started/completed` + `call_id` |
| Codex | `codex exec --json "<prompt>"` | `item.started/item.completed` JSONL |
| Claude Code | `claude -p --output-format stream-json --verbose "<prompt>"` | `assistant` tool_use / `user` tool_result |
| OpenCode | `opencode run --format json "<prompt>"` | `tool_use` state with real `time.start/end` |
| Qoder CLI | `qodercli -p --output-format stream-json --model DeepSeek-Flash "<prompt>"` | Claude-compatible assistant/tool messages |
| ZCode CLI | `zcode --json --no-color -p "<prompt>"` | session-store parts (see note) |

Each adapter emits the same intermediate `AgentEvent` stream. Adapters do not build traces themselves; the EventMerger pairs tool start/completion events, applies workspace diffs, and hands facts to the TraceBuilder.

The convenience commands use the CLIs' minimal non-interactive flags. If your CLI requires auto-approval, use the explicit form:

```bash
agent-replay record --adapter cursor --name cursor-lru -- \
  cursor-agent -p --output-format stream-json --force "fix the LRU cache bug"

agent-replay record --adapter opencode --name opencode-lru -- \
  opencode run --format json --auto "fix the LRU cache bug"

agent-replay record --adapter qoder --name qoder-lru -- \
  qodercli -p -o stream-json -m DeepSeek-Flash --permission-mode accept_edits \
  --allowed-tools "Read,Edit,Write,Bash(node --test test.mjs)" "fix the bug"

agent-replay record --adapter claude --name claude-lru -- \
  claude -p --output-format stream-json --verbose --permission-mode acceptEdits \
  --allowedTools "Read,Edit,Write,Bash(node --test test.mjs)" "fix the bug"
```

> Qoder CLI 1.1.74 exposes `DeepSeek-V4-Pro` and `DeepSeek-Flash`. The literal `DeepSeek-V4.1` ID is not available on this account and falls back to `Auto`; `DeepSeek-Flash` is the free option (0 credits) used below. Qoder Desktop also injects `QODER_AGENT_SDK_ENTRYPOINT`; the Qoder adapter removes it from the child environment.

> ZCode CLI only prints one pretty-printed summary object, so there is no live stream to parse. The `zcode` adapter buffers stdout, takes the session id from the summary, and replays the `part` / `tool_usage` rows ZCode persisted for that session. Timestamps are ZCode's own recorded times, so they are observed execution times, but they are read after the process exits rather than streamed. Requires Node's `node:sqlite` (Node >= 22.5); without it, capture falls back to workspace-only.

### Passive recording

```bash
# Terminal 1
agent-replay start --name lru-fix --agent Codex

# Terminal 2 — use a desktop Codex / Cursor / Claude session normally
agent-replay run -- pytest -q            # optional: capture one command exactly

# Terminal 1 again
agent-replay stop
agent-replay open lru-fix
```

`start` captures a git baseline and launches a detached workspace watcher. This is **workspace-level** capture: it sees file changes and the final diff, but not the agent's internal tool calls unless you use `run` or the wrapped/native modes.

### Generic wrapper fallback

```bash
agent-replay record --name codex-lru -- codex exec --json "fix the LRU cache bug"
agent-replay record --name any-agent -- <command...>
```

The generic wrapper tees stdout/stderr and uses the test-output parser as a best-effort fallback. `--tty` preserves a TUI but disables output parsing.

### Capture fidelity

Two sources exist, and they are not interchangeable:

- **Agent event** — what the agent reported doing (its own tool stream).
- **Workspace fact** — what actually changed on disk (git status, file hashes).

| Fidelity | Meaning |
|---|---|
| `native+workspace` | Native tool events, with edit tools verified against real workspace diffs |
| `native-events` | Native tool events only; workspace changes were not observed |
| `wrapped-output` | Workspace facts + wrapped stdout; tool semantics are heuristic |
| `workspace` | Passive filesystem/git capture only; no agent tool stream |

Timing is labelled the same way: `observed` comes from the agent's own clock, `estimated` is derived, and `mixed` means both appear in one trace. The Overview shows both labels next to the agent.

The distinction matters most for edits. A trace can say *the agent claimed an edit* (`native-events`) without being able to say *the file changed* — and when it can say both, `capture.integrity` reports how many claims the workspace confirmed.

### Real timing

- Native tool spans use their actual stream start/end (arrival timestamps from the CLI's event stream).
- Overlapping spans are preserved: a long test can be running while the agent edits another file.
- Instant edits are marked `instant`; `visualDurationMs` only gives them a visible minimum width in Flame. Their timestamps are not moved.
- Baseline/checkpoint/final annotations are marked `synthetic`; tests detected from wrapped stdout are marked `estimated`.
- Delete, create, modify, and git-detected rename operations are recorded distinctly.

### What the recorder can and cannot see

| | |
|---|---|
| **Sees (native)** | tool calls, commands, terminal output, file changes, model, raw start/end timing |
| **Sees (workspace)** | edits/adds/deletes/renames, git diff/stat, final patch |
| **Does not see** | hidden chain-of-thought, model internals, token-level reasoning, costs (unless exposed) |
| **Test detection** | native terminal output is parsed for pytest, jest, node:test, cargo, mocha, phpunit; `run -- <command>` is exact |
| **Requirements** | a git worktree; a dirty worktree is supported but the final patch may include pre-existing changes |
| **Privacy** | local only; traces are written to `replays/`, no upload |
