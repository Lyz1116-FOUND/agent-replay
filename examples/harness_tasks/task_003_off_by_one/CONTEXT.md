# Repository notes

This file is intentionally verbose. It is a distractor for context-management
experiments: it contains ordinary repository documentation, not a task hint.

## Module ownership

- `src/` contains production code. Keep public function names stable.
- `tests/` contains the acceptance suite. It is read-only for the agent.
- `pytest.ini` defines the test root and import path. Do not rewrite it.
- Pull requests should stay small and focused on one behavior.

## Local development

1. Create an isolated environment with your team's standard tooling.
2. Install the project in editable mode if your workflow requires it.
3. Run the full test suite before and after every change.
4. Prefer the smallest reproduction over a broad rewrite.
5. Never silence a test to make a suite green.

## Style

- Prefer clear names over abbreviations.
- Keep functions side-effect free unless their name says otherwise.
- Do not add dependencies for a single helper.
- Comments explain why, not what. Delete stale comments.
- Avoid catch-all exception handlers that hide programming errors.

## Review checklist

- Does the change address the failing behavior rather than the test input?
- Is there an existing helper that already solves the problem?
- Did the change accidentally alter a public contract?
- Are edge cases (empty input, whitespace, negative values) handled?
- Did the full suite remain green, including tests unrelated to the change?

## Debugging notes

- Read the first failing assertion before reading the whole traceback.
- Reproduce the failure with the narrowest test target available.
- Compare actual and expected values; do not infer the cause from the name.
- Print or inspect intermediate values rather than guessing.
- If a comment disagrees with observed behavior, trust the reproducible test.
- Re-run the failing test after a fix, then run the full suite.

## Repository conventions

- Commit messages use a short imperative subject.
- Binary files are not committed to source directories.
- Generated caches are ignored by `.gitignore`.
- Configuration belongs in `pytest.ini`, not in test modules.
- Test fixtures must not read files outside the repository.

## Troubleshooting

- If imports fail, verify the configured `pythonpath` before renaming modules.
- If a test passes alone but fails in a suite, check shared mutable state.
- If output is empty, check whether the code path returns early.
- If an edge case crashes, add a small test before changing behavior.
- If a boundary case fails, test the empty and single-element inputs.

## Frequently asked questions

**Why is the suite the authority?** A coding agent's claim is not evidence.
The harness runs the acceptance suite in the final worktree.

**Why are tests protected?** Rewriting tests can make a broken patch look
successful. Protected-path hashes catch that.

**Why keep the patch small?** A minimal diff is easier to review, less likely
to regress unrelated behavior, and cheaper to replay.

**Why record events?** Replay and evaluation need the same facts: what the
model saw, which tools ran, what changed, and why the harness passed or failed.

## More notes (kept for context length)

The following paragraphs are intentionally repetitive documentation so that
context-management strategies can be compared on a realistic long observation.

A coding session is a sequence of decisions. Each decision depends on the
current task, the files already read, the observations returned by tools, and
the verifier's feedback. Removing any of those from the model's context can
change the next decision. The harness therefore records the full history and
lets a context manager decide what to send. The manager must never invent
facts; it may truncate, summarize, or retrieve recorded observations.

The tool layer is deliberately uniform. A file read, a search, a shell call, a
test run, and a git diff all return the same result shape. The model sees a
success flag, text output, an optional error, and metadata. The loop does not
branch on tool names for execution. It only inspects structured metadata when
recording facts such as changed files or test counts.

The grader is separate from the agent. Tests and protected-path checks produce
evidence. A score is derived from that evidence. The model may suggest that it
is done, but only the grader can mark the run passed. This is the central
difference between a harness and a demo that trusts the model.

Replay is not an afterthought. Events are appended as they happen. Messages,
patches, test results, grades, and metrics are written to a run directory. A
native trace is generated for visual inspection. The same evidence supports
debugging, benchmarking, and an audit of the final verdict.

Compression is a trade-off. Keeping everything preserves detail but can
exceed a model's context window. Truncating tool output reduces length but can
remove the line that explains a failure. Summarizing older turns saves space
but may lose a detail that matters later. The right choice depends on the task
and the model, which is why context strategy is an experiment variable.

Multi-agent review is also a trade-off. A reviewer can catch a missing edge
case or an unintended regression. It also costs another model call and can
introduce noise. The supervisor caps rounds and calls, and the grader remains
the authority. A reviewer's approval is not a pass; a reviewer's rejection is
not a failure by itself.

Skills are procedures, not hidden capabilities. A skill adds instructions to
the system prompt when the task matches. It does not grant new tools or bypass
the grader. Comparing a run with and without a skill measures whether the
procedure helps the model use the same tools more effectively.

MCP tools cross a protocol boundary but not an abstraction boundary. An MCP
tool is adapted to the same `Tool` interface and returns the same `ToolResult`.
The loop, context manager, and grader do not know whether a tool is local or
remote. This keeps the harness from being rewritten every time a protocol
changes.

A2A messages in this project are internal records: sender, receiver, type,
payload. They make roles explicit and auditable without claiming that an
external agent-to-agent protocol is implemented. The supervisor uses them to
route feedback. The grader does not read them.

Metrics are only useful when their definitions are explicit. Success rate,
verified success, pass@1, retry recovery, tool error rate, regression rate,
false completion, token usage, latency, and context length answer different
questions. A harness can improve one while making another worse. Report the
definitions next to the numbers.

Evidence has levels. A unit test proves a code path. A scripted benchmark
proves the harness plumbing. A live model run measures model behavior under a
configuration. Do not present one level as another. A deterministic oracle is
not a language model, and a single run is not a ranking.

Finally, the goal is not to add the most modules. The goal is to make each
step of Task → Context → Model → Tool → Observation → Loop → Verification →
Grader → Retry/Finish observable, reproducible, and testable. If a module does
not improve one of those properties, it does not belong in the harness.
