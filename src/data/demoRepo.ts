export const REPO = 'acme/cachekit'

export const README_MD = `# cachekit

Small caching primitives used by the ingest pipeline.

## LRUCache

\`LRUCache(capacity)\` keeps at most \`capacity\` entries and evicts the
least-recently-used entry. \`get\` refreshes recency; \`put\` inserts or updates.

## Development

Run the test suite with:

    pytest -q
`

export const LRU_BUGGY = `from __future__ import annotations

from collections import OrderedDict
from typing import Generic, TypeVar

K = TypeVar("K")
V = TypeVar("V")


class LRUCache(Generic[K, V]):
    """A least-recently-used cache with a fixed capacity."""

    def __init__(self, capacity: int) -> None:
        if capacity < 1:
            raise ValueError("capacity must be >= 1")
        self.capacity = capacity
        self._data: OrderedDict[K, V] = OrderedDict()

    def get(self, key: K) -> V | None:
        if key not in self._data:
            return None
        self._data.move_to_end(key)
        return self._data[key]

    def put(self, key: K, value: V) -> None:
        if key in self._data:
            self._data.move_to_end(key)
        self._data[key] = value
        if len(self._data) > self.capacity:
            self._data.popitem(last=True)

    def __len__(self) -> int:
        return len(self._data)

    def keys(self) -> list[K]:
        return list(self._data.keys())
`

export const LRU_WRONG_FIX = LRU_BUGGY.replace(
  'if len(self._data) > self.capacity:\n            self._data.popitem(last=True)',
  'if len(self._data) >= self.capacity:\n            self._data.popitem(last=True)',
)

export const LRU_WRONG_FIX_2 = LRU_WRONG_FIX.replace('popitem(last=True)', 'popitem(last=False)')

export const LRU_FIXED = LRU_BUGGY.replace(
  'if len(self._data) > self.capacity:\n            self._data.popitem(last=True)',
  'if len(self._data) > self.capacity:\n            self._data.popitem(last=False)',
)

export const DOCS_LRU_MD = `# LRU semantics

\`LRUCache\` evicts the least-recently-used key when the number of entries
exceeds capacity. Reads refresh recency. Capacity must be at least 1.

\`OrderedDict.popitem(last=False)\` removes from the front (oldest entry).
`

export const TEST_FILE = `import pytest

from cachekit.lru import LRUCache


def test_put_and_get():
    cache = LRUCache(2)
    cache.put("a", 1)
    assert cache.get("a") == 1


def test_missing_key_returns_none():
    cache = LRUCache(2)
    assert cache.get("missing") is None


def test_capacity_one_keeps_latest():
    cache = LRUCache(1)
    cache.put("a", 1)
    cache.put("b", 2)
    assert cache.get("a") is None
    assert cache.get("b") == 2


def test_capacity_two_eviction_order():
    cache = LRUCache(2)
    cache.put("a", 1)
    cache.put("b", 2)
    cache.put("c", 3)
    assert cache.get("a") is None
    assert cache.get("b") == 2
    assert cache.get("c") == 3


def test_update_existing_key():
    cache = LRUCache(2)
    cache.put("a", 1)
    cache.put("b", 2)
    cache.put("a", 9)
    assert cache.get("b") == 2
    assert cache.get("a") == 9
    assert len(cache) == 2


def test_get_refreshes_recency():
    cache = LRUCache(3)
    cache.put("a", 1)
    cache.put("b", 2)
    cache.get("a")
    cache.put("c", 3)
    assert cache.keys() == ["b", "a", "c"]


def test_len_never_exceeds_capacity():
    cache = LRUCache(2)
    for i in range(5):
        cache.put(i, i)
    assert len(cache) <= 2


def test_invalid_capacity():
    with pytest.raises(ValueError):
        LRUCache(0)


def test_keys_ordered_by_recency():
    cache = LRUCache(2)
    cache.put("a", 1)
    cache.put("b", 2)
    cache.get("a")
    assert cache.keys() == ["b", "a"]


def test_eviction_returns_none():
    cache = LRUCache(2)
    cache.put("a", 1)
    cache.put("b", 2)
    cache.put("c", 3)
    assert cache.get("a") is None


def test_overwrite_value():
    cache = LRUCache(2)
    cache.put("a", 1)
    cache.put("a", 2)
    assert cache.get("a") == 2
    assert len(cache) == 1


def test_capacity_four():
    cache = LRUCache(4)
    cache.put("a", 1)
    cache.put("b", 2)
    cache.put("c", 3)
    cache.put("d", 4)
    assert len(cache) == 4
    assert cache.get("a") == 1


def test_put_many_keeps_size():
    cache = LRUCache(3)
    for i in range(10):
        cache.put(i, i)
    assert len(cache) == 3


def test_evicted_key_reinserted():
    cache = LRUCache(1)
    cache.put("a", 1)
    cache.put("b", 2)
    cache.put("a", 3)
    assert cache.get("b") is None
    assert cache.get("a") == 3
`

export const TEST_OUTPUT_FIRST = `============================= test session starts ==============================
platform linux -- Python 3.12.4, pytest-8.2.2, pluggy-1.5.0
rootdir: /home/dev/cachekit
collected 14 items

tests/test_lru.py ..FF......F...                                        [100%]

=================================== FAILURES ===================================
_____________________ test_capacity_one_keeps_latest ______________________

    def test_capacity_one_keeps_latest():
        cache = LRUCache(1)
        cache.put("a", 1)
        cache.put("b", 2)
>       assert cache.get("a") is None
E       AssertionError: assert 1 is None

tests/test_lru.py:22: AssertionError
____________________ test_capacity_two_eviction_order _____________________

    cache.put("c", 3)
>   assert cache.get("a") is None
E   AssertionError: assert 1 is None

tests/test_lru.py:33: AssertionError
_______________________ test_eviction_returns_none ________________________

>   assert cache.get("a") is None
E   AssertionError: assert 1 is None

tests/test_lru.py:76: AssertionError
=========================== short test summary info ============================
FAILED tests/test_lru.py::test_capacity_one_keeps_latest - AssertionError: assert 1 is None
FAILED tests/test_lru.py::test_capacity_two_eviction_order - AssertionError: assert 1 is None
FAILED tests/test_lru.py::test_eviction_returns_none - AssertionError: assert 1 is None
3 failed, 11 passed in 0.42s
`

export const TEST_OUTPUT_WRONG = `============================= test session starts ==============================
platform linux -- Python 3.12.4, pytest-8.2.2, pluggy-1.5.0
rootdir: /home/dev/cachekit
collected 14 items

tests/test_lru.py ..FFFF..FF.FF.                                        [100%]

=========================== short test summary info ============================
FAILED tests/test_lru.py::test_capacity_one_keeps_latest - AssertionError: assert 2 is None
FAILED tests/test_lru.py::test_capacity_two_eviction_order - AssertionError: assert 2 is None
FAILED tests/test_lru.py::test_update_existing_key - AssertionError: assert None == 2
FAILED tests/test_lru.py::test_get_refreshes_recency - AssertionError: lists differ: ['a', 'b'] != ['b', 'a', 'c']
FAILED tests/test_lru.py::test_keys_ordered_by_recency - AssertionError: lists differ: ['a'] != ['b', 'a']
FAILED tests/test_lru.py::test_eviction_returns_none - AssertionError: assert 1 is None
FAILED tests/test_lru.py::test_capacity_four - AssertionError: assert 3 == 4
FAILED tests/test_lru.py::test_put_many_keeps_size - AssertionError: assert 2 == 3
8 failed, 6 passed in 0.51s
`

export const TEST_OUTPUT_FINAL = `============================= test session starts ==============================
platform linux -- Python 3.12.4, pytest-8.2.2, pluggy-1.5.0
rootdir: /home/dev/cachekit
collected 14 items

tests/test_lru.py ..............                                          [100%]

14 passed in 0.41s
`

export const SEARCH_RESULTS_LRU = [
  { path: 'src/cachekit/lru.py', line: 10, preview: 'class LRUCache(Generic[K, V]):' },
  { path: 'tests/test_lru.py', line: 3, preview: 'from cachekit.lru import LRUCache' },
  { path: 'tests/test_lru.py', line: 7, preview: 'cache = LRUCache(2)' },
  { path: 'tests/test_lru.py', line: 17, preview: 'cache = LRUCache(2)' },
]

export const SEARCH_RESULTS_POPITEM = [
  { path: 'src/cachekit/lru.py', line: 30, preview: 'self._data.popitem(last=True)' },
]

export const GIT_DIFF_STAT = ` src/cachekit/lru.py | 2 +-
 1 file changed, 1 insertion(+), 1 deletion(-)`

export const FINAL_PATCH = `diff --git a/src/cachekit/lru.py b/src/cachekit/lru.py
index 3c1f2ab..9d4e6c1 100644
--- a/src/cachekit/lru.py
+++ b/src/cachekit/lru.py
@@ -26,7 +26,7 @@ class LRUCache(Generic[K, V]):
         if key in self._data:
             self._data.move_to_end(key)
         self._data[key] = value
-        if len(self._data) > self.capacity:
-            self._data.popitem(last=True)
+        if len(self._data) > self.capacity:
+            self._data.popitem(last=False)
`

export const TEST_FILE_WITH_REGRESSION = `${TEST_FILE}

def test_capacity_one_regression():
    cache = LRUCache(1)
    cache.put("a", 1)
    cache.put("b", 2)
    cache.put("c", 3)
    assert cache.get("a") is None
    assert cache.get("b") is None
    assert cache.get("c") == 3
`

export const TEST_OUTPUT_FINAL_15 = `============================= test session starts ==============================
platform linux -- Python 3.12.4, pytest-8.2.2, pluggy-1.5.0
rootdir: /home/dev/cachekit
collected 15 items

tests/test_lru.py ...............                                         [100%]

15 passed in 0.44s
`

export const TEST_OUTPUT_WRONG_2 = `============================= test session starts ==============================
platform linux -- Python 3.12.4, pytest-8.2.2, pluggy-1.5.0
rootdir: /home/dev/cachekit
collected 14 items

tests/test_lru.py .....F..F..FF.                                         [100%]

=========================== short test summary info ============================
FAILED tests/test_lru.py::test_get_refreshes_recency - AssertionError: lists differ: ['a', 'c'] != ['b', 'a', 'c']
FAILED tests/test_lru.py::test_keys_ordered_by_recency - AssertionError: lists differ: ['b'] != ['b', 'a']
FAILED tests/test_lru.py::test_capacity_four - AssertionError: assert 3 == 4
FAILED tests/test_lru.py::test_put_many_keeps_size - AssertionError: assert 2 == 3
4 failed, 10 passed in 0.47s
`

export const FINAL_PATCH_CLAUDE = `diff --git a/src/cachekit/lru.py b/src/cachekit/lru.py
index 3c1f2ab..9d4e6c1 100644
--- a/src/cachekit/lru.py
+++ b/src/cachekit/lru.py
@@ -26,7 +26,7 @@ class LRUCache(Generic[K, V]):
         if key in self._data:
             self._data.move_to_end(key)
         self._data[key] = value
-        if len(self._data) > self.capacity:
-            self._data.popitem(last=True)
+        if len(self._data) > self.capacity:
+            self._data.popitem(last=False)
diff --git a/tests/test_lru.py b/tests/test_lru.py
index 5b8e0d2..a1c93f7 100644
--- a/tests/test_lru.py
+++ b/tests/test_lru.py
@@ -79,3 +79,13 @@ def test_evicted_key_reinserted():
     assert cache.get("b") is None
     assert cache.get("a") == 3
+
+
+def test_capacity_one_regression():
+    cache = LRUCache(1)
+    cache.put("a", 1)
+    cache.put("b", 2)
+    cache.put("c", 3)
+    assert cache.get("a") is None
+    assert cache.get("b") is None
+    assert cache.get("c") == 3
`

export const WRONG2_PATCH = `diff --git a/src/cachekit/lru.py b/src/cachekit/lru.py
index 3c1f2ab..b7d10e4 100644
--- a/src/cachekit/lru.py
+++ b/src/cachekit/lru.py
@@ -26,7 +26,7 @@ class LRUCache(Generic[K, V]):
         if key in self._data:
             self._data.move_to_end(key)
         self._data[key] = value
-        if len(self._data) > self.capacity:
-            self._data.popitem(last=True)
+        if len(self._data) >= self.capacity:
+            self._data.popitem(last=False)
`

export const REPRO_COMMAND =
  'python -c "from cachekit.lru import LRUCache; c=LRUCache(1); c.put(\'a\',1); c.put(\'b\',2); print(c.keys())"'

export const REPRO_OUTPUT = `['a']`

export const CLI_BEFORE = `from __future__ import annotations

import argparse
from pathlib import Path

from cachekit.lru import LRUCache


def inspect_cache(path: Path) -> None:
    cache = LRUCache(capacity=8)
    for line in path.read_text().splitlines():
        key, _, value = line.partition("=")
        cache.put(key, value)
    for key in cache.keys():
        print(f"{key}: {cache.get(key)}")


def main() -> None:
    parser = argparse.ArgumentParser(prog="cachekit")
    parser.add_argument("path", type=Path)
    args = parser.parse_args()
    inspect_cache(args.path)


if __name__ == "__main__":
    main()
`

export const CLI_AFTER = `from __future__ import annotations

import argparse
import json
from pathlib import Path

from cachekit.lru import LRUCache


def inspect_cache(path: Path) -> dict[str, str]:
    cache = LRUCache(capacity=8)
    for line in path.read_text().splitlines():
        key, _, value = line.partition("=")
        cache.put(key, value)
    return {key: cache.get(key) for key in cache.keys()}


def main() -> None:
    parser = argparse.ArgumentParser(prog="cachekit")
    parser.add_argument("path", type=Path)
    parser.add_argument("--json", action="store_true", help="emit JSON output")
    args = parser.parse_args()

    entries = inspect_cache(args.path)
    if args.json:
        print(json.dumps(entries, indent=2))
        return
    for key, value in entries.items():
        print(f"{key}: {value}")


if __name__ == "__main__":
    main()
`

export const CLI_TEST_BEFORE = `from pathlib import Path

from cachekit.cli import inspect_cache


def test_inspect_prints_entries(tmp_path: Path, capsys):
    path = tmp_path / "data.txt"
    path.write_text("a=1\\nb=2\\n")
    inspect_cache(path)
    captured = capsys.readouterr()
    assert "a: 1" in captured.out
`

export const CLI_TEST_AFTER = `import json
from pathlib import Path

from cachekit.cli import inspect_cache, main


def test_inspect_prints_entries(tmp_path: Path, capsys):
    path = tmp_path / "data.txt"
    path.write_text("a=1\\nb=2\\n")
    inspect_cache(path)
    captured = capsys.readouterr()
    assert "a: 1" in captured.out


def test_json_flag(tmp_path: Path, capsys, monkeypatch):
    path = tmp_path / "data.txt"
    path.write_text("a=1\\nb=2\\n")
    monkeypatch.setattr("sys.argv", ["cachekit", str(path), "--json"])
    main()
    captured = capsys.readouterr()
    assert json.loads(captured.out) == {"a": "1", "b": "2"}
`

export const CLI_TEST_OUTPUT = `============================= test session starts ==============================
platform linux -- Python 3.12.4, pytest-8.2.2, pluggy-1.5.0
rootdir: /home/dev/cachekit
collected 2 items

tests/test_cli.py ..                                                     [100%]

2 passed in 0.08s
`

export const CLI_PATCH = `diff --git a/src/cachekit/cli.py b/src/cachekit/cli.py
index 6f01a2c..e4b8f19 100644
--- a/src/cachekit/cli.py
+++ b/src/cachekit/cli.py
@@ -2,6 +2,7 @@ from __future__ import annotations
 
 import argparse
+import json
 from pathlib import Path

 from cachekit.lru import LRUCache
@@ -8,14 +9,20 @@ from cachekit.lru import LRUCache
-def inspect_cache(path: Path) -> None:
+def inspect_cache(path: Path) -> dict[str, str]:
     cache = LRUCache(capacity=8)
     for line in path.read_text().splitlines():
         key, _, value = line.partition("=")
         cache.put(key, value)
-    for key in cache.keys():
-        print(f"{key}: {cache.get(key)}")
+    return {key: cache.get(key) for key in cache.keys()}
@@ -23,7 +30,14 @@ def main() -> None:
     parser = argparse.ArgumentParser(prog="cachekit")
     parser.add_argument("path", type=Path)
+    parser.add_argument("--json", action="store_true", help="emit JSON output")
     args = parser.parse_args()
-    inspect_cache(args.path)
+
+    entries = inspect_cache(args.path)
+    if args.json:
+        print(json.dumps(entries, indent=2))
+        return
+    for key, value in entries.items():
+        print(f"{key}: {value}")
`
