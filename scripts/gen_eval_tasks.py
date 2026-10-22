"""Generate the additional fixed evaluation tasks under ``examples/tasks/``.

Each task is a self-contained Node.js ``node:test`` exercise: a buggy or empty
source file, a test file that defines success, and a ``reference/`` answer that
is excluded from the agent's workspace. Running this script is idempotent and
reproducible; the generated tasks are committed to the repository.

Baseline counts are declared in ``task.json`` for documentation; the validation
harness re-runs the real baseline/reference to prove each task is solvable.
"""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "examples" / "tasks"

BUG_PROMPT = (
    "Fix the failing tests. Make the minimal edit and run `node --test` to "
    "verify. Work only inside the current working directory."
)
FEATURE_PROMPT = (
    "Implement the missing feature so the tests pass. Run `node --test` to "
    "verify. Work only inside the current working directory."
)


def test_header(fn: str, file: str) -> str:
    return (
        "import test from 'node:test'\n"
        "import assert from 'node:assert/strict'\n"
        f"import {{ {fn} }} from './{file}'\n"
    )


TASKS = [
    {
        "id": "max-of-two",
        "title": "Max of two numbers",
        "kind": "bug",
        "file": "max.mjs",
        "fn": "max",
        "src": "export function max(a, b) {\n  return a\n}\n",
        "ref": "export function max(a, b) {\n  return a > b ? a : b\n}\n",
        "tests": [
            "test('max positive', () => assert.equal(max(3, 5), 5))",
            "test('max negative', () => assert.equal(max(-5, -1), -1))",
            "test('max equal', () => assert.equal(max(7, 7), 7))",
        ],
        "baseline": {"pass": 1, "fail": 2},
    },
    {
        "id": "reverse-string",
        "title": "Reverse a string",
        "kind": "bug",
        "file": "reverse.mjs",
        "fn": "reverse",
        "src": "export function reverse(str) {\n  return str\n}\n",
        "ref": "export function reverse(str) {\n  return str.split('').reverse().join('')\n}\n",
        "tests": [
            "test('reverse abc', () => assert.equal(reverse('abc'), 'cba'))",
            "test('reverse empty', () => assert.equal(reverse(''), ''))",
            "test('reverse sentence', () => assert.equal(reverse('hello world'), 'dlrow olleh'))",
        ],
        "baseline": {"pass": 1, "fail": 2},
    },
    {
        "id": "is-palindrome",
        "title": "Palindrome detection",
        "kind": "bug",
        "file": "palindrome.mjs",
        "fn": "isPalindrome",
        "src": "export function isPalindrome(str) {\n  return true\n}\n",
        "ref": (
            "export function isPalindrome(str) {\n"
            "  return str === str.split('').reverse().join('')\n"
            "}\n"
        ),
        "tests": [
            "test('palindrome true', () => assert.equal(isPalindrome('racecar'), true))",
            "test('palindrome false', () => assert.equal(isPalindrome('hello'), false))",
            "test('single char', () => assert.equal(isPalindrome('a'), true))",
            "test('two chars', () => assert.equal(isPalindrome('ab'), false))",
        ],
        "baseline": {"pass": 2, "fail": 2},
    },
    {
        "id": "sum-array",
        "title": "Sum an array",
        "kind": "feature",
        "file": "sum.mjs",
        "fn": "sum",
        "src": "export function sum(numbers) {\n  return 0\n}\n",
        "ref": "export function sum(numbers) {\n  return numbers.reduce((a, b) => a + b, 0)\n}\n",
        "tests": [
            "test('sum positive', () => assert.equal(sum([1, 2, 3]), 6))",
            "test('sum empty', () => assert.equal(sum([]), 0))",
            "test('sum mixed', () => assert.equal(sum([-1, 1, 0]), 0))",
        ],
        "baseline": {"pass": 2, "fail": 1},
    },
    {
        "id": "capitalize",
        "title": "Capitalize a string",
        "kind": "bug",
        "file": "capitalize.mjs",
        "fn": "capitalize",
        "src": "export function capitalize(str) {\n  return str.charAt(0).toUpperCase()\n}\n",
        "ref": (
            "export function capitalize(str) {\n"
            "  return str.charAt(0).toUpperCase() + str.slice(1)\n"
            "}\n"
        ),
        "tests": [
            "test('capitalize hello', () => assert.equal(capitalize('hello'), 'Hello'))",
            "test('capitalize empty', () => assert.equal(capitalize(''), ''))",
            "test('capitalize java', () => assert.equal(capitalize('java'), 'Java'))",
        ],
        "baseline": {"pass": 1, "fail": 2},
    },
    {
        "id": "fibonacci",
        "title": "Fibonacci sequence",
        "kind": "bug",
        "file": "fib.mjs",
        "fn": "fib",
        "src": (
            "export function fib(n) {\n"
            "  if (n === 0) return 1\n"
            "  if (n === 1) return 1\n"
            "  return fib(n - 1) + fib(n - 2)\n"
            "}\n"
        ),
        "ref": (
            "export function fib(n) {\n"
            "  if (n === 0) return 0\n"
            "  if (n === 1) return 1\n"
            "  return fib(n - 1) + fib(n - 2)\n"
            "}\n"
        ),
        "tests": [
            "test('fib 0', () => assert.equal(fib(0), 0))",
            "test('fib 1', () => assert.equal(fib(1), 1))",
            "test('fib 2', () => assert.equal(fib(2), 1))",
            "test('fib 6', () => assert.equal(fib(6), 8))",
        ],
        "baseline": {"pass": 2, "fail": 2},
    },
    {
        "id": "dedupe",
        "title": "Deduplicate an array",
        "kind": "feature",
        "file": "dedupe.mjs",
        "fn": "dedupe",
        "src": "export function dedupe(items) {\n  return items\n}\n",
        "ref": "export function dedupe(items) {\n  return [...new Set(items)]\n}\n",
        "tests": [
            "test('dedupe numbers', () => assert.deepEqual(dedupe([1, 1, 2]), [1, 2]))",
            "test('dedupe empty', () => assert.deepEqual(dedupe([]), []))",
            "test('dedupe strings', () => assert.deepEqual(dedupe(['a', 'b', 'a']), ['a', 'b']))",
        ],
        "baseline": {"pass": 1, "fail": 2},
    },
]


def main() -> None:
    for task in TASKS:
        task_dir = ROOT / task["id"]
        task_dir.mkdir(parents=True, exist_ok=True)
        ref_dir = task_dir / "reference"
        ref_dir.mkdir(parents=True, exist_ok=True)

        test_src = test_header(task["fn"], task["file"]) + "\n".join(task["tests"]) + "\n"
        meta = {
            "id": task["id"],
            "title": task["title"],
            "kind": task["kind"],
            "prompt": BUG_PROMPT if task["kind"] == "bug" else FEATURE_PROMPT,
            "verify": "node --test",
            "expectedFiles": [task["file"]],
            "baseline": task["baseline"],
            "protectedFiles": ["test.mjs"],
        }

        (task_dir / "task.json").write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
        (task_dir / task["file"]).write_text(task["src"], encoding="utf-8")
        (task_dir / "test.mjs").write_text(test_src, encoding="utf-8")
        (ref_dir / task["file"]).write_text(task["ref"], encoding="utf-8")
        print(f"generated {task['id']}")


if __name__ == "__main__":
    main()
