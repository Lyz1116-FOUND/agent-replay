"""Generate the fixed Python coding-task fixtures under examples/harness_tasks.

Each task is intentionally self-contained: a pytest.ini, source files, tests,
and a reference fix that is excluded from the agent workspace. The same script
keeps the set reproducible; run it only when changing the task set.
"""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TASKS_DIR = ROOT / "examples" / "harness_tasks"

PYTEST_INI = """[pytest]
testpaths = tests
pythonpath = src
"""

GITIGNORE = """__pycache__/
*.pyc
.pytest_cache/
"""

GENERIC = (
    "The repository's test suite fails. Diagnose the cause in the source, apply "
    "the smallest correct fix, and make the full suite pass. Do not modify "
    "anything under tests/ or pytest.ini."
)

CONTEXT_NOTES = """# Repository notes

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
"""

TASKS = [
    {
        "id": "task_001_add_bug",
        "title": "Fix the addition helper",
        "kind": "bug",
        "tags": ["python", "pytest", "single_file", "arithmetic"],
        "instruction": GENERIC,
        "source": {
            "src/calc.py": '''"""Small arithmetic helpers."""


def add(a, b):
    """Return the sum of two numbers."""
    return a - b
''',
        },
        "tests": {
            "tests/test_calc.py": '''from calc import add


def test_add_positive():
    assert add(2, 3) == 5


def test_add_zero():
    assert add(0, 5) == 5


def test_add_negative():
    assert add(-2, 3) == 1
''',
        },
        "reference": {
            "src/calc.py": '''"""Small arithmetic helpers."""


def add(a, b):
    """Return the sum of two numbers."""
    return a + b
''',
        },
        "expected": ["src/calc.py"],
    },
    {
        "id": "task_002_multi_file",
        "title": "Fix pricing across two modules",
        "kind": "bug",
        "tags": ["python", "pytest", "multi_file", "pricing"],
        "instruction": (
            "Checkout totals are wrong and the cause spans more than one source "
            "file. Fix the source so the full suite passes. Do not modify tests "
            "or pytest.ini."
        ),
        "source": {
            "src/pricing/__init__.py": "",
            "src/pricing/config.py": '''"""Pricing constants."""

TAX_RATE = 0.10
''',
            "src/pricing/checkout.py": '''"""Checkout total calculation."""

from .config import TAX_RATE


def total(subtotal):
    """Return subtotal plus tax."""
    return subtotal - subtotal * TAX_RATE
''',
        },
        "tests": {
            "tests/test_checkout.py": '''from pricing.checkout import total


def test_total_100():
    assert total(100) == 120


def test_total_50():
    assert total(50) == 60
''',
        },
        "reference": {
            "src/pricing/config.py": '''"""Pricing constants."""

TAX_RATE = 0.20
''',
            "src/pricing/checkout.py": '''"""Checkout total calculation."""

from .config import TAX_RATE


def total(subtotal):
    """Return subtotal plus tax."""
    return subtotal + subtotal * TAX_RATE
''',
        },
        "expected": ["src/pricing/config.py", "src/pricing/checkout.py"],
    },
    {
        "id": "task_003_off_by_one",
        "title": "Fix an inclusive range sum",
        "kind": "bug",
        "tags": ["python", "pytest", "off_by_one"],
        "instruction": GENERIC,
        "source": {
            "src/ranges.py": '''"""Range helpers."""


def inclusive_sum(n):
    """Return 1 + 2 + ... + n."""
    return sum(range(1, n))
''',
        },
        "tests": {
            "tests/test_ranges.py": '''from ranges import inclusive_sum


def test_sum_five():
    assert inclusive_sum(5) == 15


def test_sum_one():
    assert inclusive_sum(1) == 1


def test_sum_ten():
    assert inclusive_sum(10) == 55
''',
        },
        "reference": {
            "src/ranges.py": '''"""Range helpers."""


def inclusive_sum(n):
    """Return 1 + 2 + ... + n."""
    return sum(range(1, n + 1))
''',
        },
        "expected": ["src/ranges.py"],
    },
    {
        "id": "task_004_parser_empty",
        "title": "Fix parser crash on empty input",
        "kind": "bug",
        "tags": ["python", "pytest", "parser", "edge_case"],
        "instruction": (
            "The key=value parser crashes on empty input and mishandles blank "
            "lines. Fix the parser so it returns an empty mapping for empty "
            "input, skips blank lines, and keeps '=' characters inside values. "
            "Do not modify tests or pytest.ini."
        ),
        "source": {
            "src/parser.py": '''"""Parse simple key=value text."""


def parse_pairs(text):
    result = {}
    for line in text.split("\\n"):
        key, value = line.split("=")
        result[key.strip()] = value.strip()
    return result
''',
        },
        "tests": {
            "tests/test_parser.py": '''from parser import parse_pairs


def test_empty_input():
    assert parse_pairs("") == {}


def test_single_pair():
    assert parse_pairs("a=1") == {"a": "1"}


def test_blank_lines_are_skipped():
    assert parse_pairs("a=1\\n\\nb=2") == {"a": "1", "b": "2"}


def test_equals_in_value():
    assert parse_pairs("query=a=b") == {"query": "a=b"}
''',
        },
        "reference": {
            "src/parser.py": '''"""Parse simple key=value text."""


def parse_pairs(text):
    result = {}
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        if "=" not in line:
            raise ValueError(f"invalid pair: {raw_line!r}")
        key, value = line.split("=", 1)
        result[key.strip()] = value.strip()
    return result
''',
        },
        "expected": ["src/parser.py"],
    },
    {
        "id": "task_005_misleading_comment",
        "title": "Ignore the misleading comment",
        "kind": "bug",
        "tags": ["python", "pytest", "misleading_context", "text"],
        "instruction": (
            "A test fails in the text helpers. A code comment may point at the "
            "wrong place; verify the actual behavior with the tests. Fix the "
            "source and do not modify tests or pytest.ini."
        ),
        "source": {
            "src/text.py": '''"""Text formatting helpers."""


def slugify(value):
    # NOTE: the failing behavior is in normalize_title below.
    return value.strip().lower().replace(" ", "-")


def normalize_title(value):
    return value.strip().title()
''',
        },
        "tests": {
            "tests/test_text.py": '''from text import normalize_title, slugify


def test_slugify_single_space():
    assert slugify("Hello World") == "hello-world"


def test_slugify_multiple_spaces():
    assert slugify("  A  B  ") == "a-b"


def test_normalize_title():
    assert normalize_title(" hello world ") == "Hello World"
''',
        },
        "reference": {
            "src/text.py": '''"""Text formatting helpers."""

import re


def slugify(value):
    return re.sub(r"\\s+", "-", value.strip().lower())


def normalize_title(value):
    return value.strip().title()
''',
        },
        "expected": ["src/text.py"],
    },
    {
        "id": "task_006_recursion",
        "title": "Fix the recursive base case",
        "kind": "bug",
        "tags": ["python", "pytest", "recursion"],
        "instruction": GENERIC,
        "source": {
            "src/factorial.py": '''"""Recursive helpers."""


def factorial(n):
    if n <= 1:
        return 0
    return n * factorial(n - 1)
''',
        },
        "tests": {
            "tests/test_factorial.py": '''from factorial import factorial


def test_zero():
    assert factorial(0) == 1


def test_one():
    assert factorial(1) == 1


def test_five():
    assert factorial(5) == 120
''',
        },
        "reference": {
            "src/factorial.py": '''"""Recursive helpers."""


def factorial(n):
    if n <= 1:
        return 1
    return n * factorial(n - 1)
''',
        },
        "expected": ["src/factorial.py"],
    },
    {
        "id": "task_007_regression",
        "title": "Fix median without breaking mean",
        "kind": "bug",
        "tags": ["python", "pytest", "regression", "statistics"],
        "instruction": (
            "The median tests fail. Fix the median implementation and preserve "
            "all existing behavior covered by the suite, especially the mean "
            "tests. Do not modify tests or pytest.ini."
        ),
        "source": {
            "src/stats.py": '''"""Small statistics helpers."""


def mean(values):
    return sum(values) / len(values)


def median(values):
    ordered = sorted(values)
    n = len(ordered)
    if n % 2 == 1:
        return ordered[n // 2]
    return ordered[n // 2]
''',
        },
        "tests": {
            "tests/test_stats.py": '''from stats import mean, median


def test_mean_basic():
    assert mean([1, 2, 3]) == 2


def test_mean_negative():
    assert mean([-1, 1]) == 0


def test_median_odd():
    assert median([1, 3, 2]) == 2


def test_median_even_sorted():
    assert median([1, 2, 3, 4]) == 2.5


def test_median_even_unsorted():
    assert median([4, 1, 3, 2]) == 2.5
''',
        },
        "reference": {
            "src/stats.py": '''"""Small statistics helpers."""


def mean(values):
    return sum(values) / len(values)


def median(values):
    ordered = sorted(values)
    n = len(ordered)
    if n % 2 == 1:
        return ordered[n // 2]
    return (ordered[n // 2 - 1] + ordered[n // 2]) / 2
''',
        },
        "expected": ["src/stats.py"],
    },
    {
        "id": "task_008_feature_unique",
        "title": "Implement order-preserving unique",
        "kind": "feature",
        "tags": ["python", "pytest", "feature", "lists"],
        "instruction": (
            "Implement unique_preserving_order so it returns the first "
            "occurrence of each value in input order. Empty input returns an "
            "empty list. Do not modify tests or pytest.ini."
        ),
        "source": {
            "src/lists.py": '''"""List helpers."""


def unique_preserving_order(values):
    raise NotImplementedError("implement unique_preserving_order")
''',
        },
        "tests": {
            "tests/test_lists.py": '''from lists import unique_preserving_order


def test_mixed_values():
    assert unique_preserving_order([3, 1, 3, 2, 1]) == [3, 1, 2]


def test_empty():
    assert unique_preserving_order([]) == []


def test_case_sensitive():
    assert unique_preserving_order(["a", "A", "a"]) == ["a", "A"]
''',
        },
        "reference": {
            "src/lists.py": '''"""List helpers."""


def unique_preserving_order(values):
    seen = set()
    result = []
    for value in values:
        if value in seen:
            continue
        seen.add(value)
        result.append(value)
    return result
''',
        },
        "expected": ["src/lists.py"],
    },
    {
        "id": "task_009_safe_int",
        "title": "Make integer conversion safe",
        "kind": "bug",
        "tags": ["python", "pytest", "exceptions"],
        "instruction": GENERIC,
        "source": {
            "src/convert.py": '''"""Conversion helpers."""


def safe_int(value, default=0):
    return int(value)
''',
        },
        "tests": {
            "tests/test_convert.py": '''from convert import safe_int


def test_valid_string():
    assert safe_int("42") == 42


def test_invalid_string_uses_default():
    assert safe_int("nope", -1) == -1


def test_none_uses_default():
    assert safe_int(None, 7) == 7


def test_whitespace_string():
    assert safe_int(" 3 ") == 3
''',
        },
        "reference": {
            "src/convert.py": '''"""Conversion helpers."""


def safe_int(value, default=0):
    try:
        return int(value)
    except (TypeError, ValueError):
        return default
''',
        },
        "expected": ["src/convert.py"],
    },
    {
        "id": "task_010_word_count",
        "title": "Fix the word counter",
        "kind": "bug",
        "tags": ["python", "pytest", "counting"],
        "instruction": GENERIC,
        "source": {
            "src/words.py": '''"""Word counting helpers."""


def count_words(text):
    counts = {}
    for token in text.lower().split():
        counts[token] = counts.get(token, 1) + 1
    return counts
''',
        },
        "tests": {
            "tests/test_words.py": '''from words import count_words


def test_repeated_words():
    assert count_words("a b a") == {"a": 2, "b": 1}


def test_empty_text():
    assert count_words("") == {}


def test_case_insensitive():
    assert count_words("One one TWO") == {"one": 2, "two": 1}
''',
        },
        "reference": {
            "src/words.py": '''"""Word counting helpers."""


def count_words(text):
    counts = {}
    for token in text.lower().split():
        counts[token] = counts.get(token, 0) + 1
    return counts
''',
        },
        "expected": ["src/words.py"],
    },
]


def write_task(task: dict) -> None:
    directory = TASKS_DIR / task["id"]
    if directory.exists():
        raise SystemExit(f"task already exists: {directory}")
    (directory / "tests").mkdir(parents=True)
    (directory / "pytest.ini").write_text(PYTEST_INI, encoding="utf-8")
    (directory / ".gitignore").write_text(GITIGNORE, encoding="utf-8")
    (directory / "CONTEXT.md").write_text(CONTEXT_NOTES, encoding="utf-8")
    for path, content in task["source"].items():
        target = directory / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
    for path, content in task["tests"].items():
        target = directory / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
    for path, content in task["reference"].items():
        target = directory / "reference" / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
    metadata = {
        "id": task["id"],
        "title": task["title"],
        "kind": task["kind"],
        "instruction": task["instruction"],
        "test_command": "{python} -m pytest -q -c pytest.ini",
        "protected_paths": ["tests/", "pytest.ini"],
        "expected_paths": task["expected"],
        "timeout_seconds": 120,
        "metadata": {
            "tags": task["tags"],
            "repo": "agent-replay/harness-fixture",
        },
    }
    (directory / "task.json").write_text(
        json.dumps(metadata, indent=2) + "\n", encoding="utf-8"
    )


def main() -> int:
    TASKS_DIR.mkdir(parents=True, exist_ok=True)
    for task in TASKS:
        write_task(task)
    print(f"wrote {len(TASKS)} tasks to {TASKS_DIR}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
