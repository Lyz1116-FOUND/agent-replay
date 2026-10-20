export const sampleSweAgentTrajectory = {
  trajectory: [
    {
      thought: 'The failing test points at LRU eviction with capacity=1. I will open the implementation.',
      action: '```\nopen src/cachekit/lru.py\n```',
      observation:
        '1: from __future__ import annotations\n2: from collections import OrderedDict\n...\n29:         if len(self._data) > self.capacity:\n30:             self._data.popitem(last=True)\n',
      state: '{"open_file": "src/cachekit/lru.py", "working_dir": "/repo"}',
      response: 'I will open the implementation.',
    },
    {
      thought: 'Find every place eviction is triggered.',
      action: '```\nsearch_dir "popitem" .\n```',
      observation: 'src/cachekit/lru.py:30: self._data.popitem(last=True)',
      state: '{"open_file": "src/cachekit/lru.py", "working_dir": "/repo"}',
      response: 'Searching for popitem usages.',
    },
    {
      thought: 'The capacity check looks suspicious. Try changing the comparison.',
      action: '```\nedit 25:30 src/cachekit/lru.py\nif len(self._data) >= self.capacity:\n    self._data.popitem(last=True)\nend_of_edit\n```',
      observation: 'File updated.',
      state: '{"open_file": "src/cachekit/lru.py", "working_dir": "/repo"}',
      response: 'Applying an eviction boundary change.',
    },
    {
      thought: 'Run the test suite to verify the change.',
      action: '```\npytest -q\n```',
      observation: '1 failed, 13 passed in 0.44s',
      state: '{"open_file": "src/cachekit/lru.py", "working_dir": "/repo"}',
      response: 'Running tests.',
    },
    {
      thought: 'Still failing. The eviction direction is wrong, not the boundary.',
      action: '```\nedit 25:30 src/cachekit/lru.py\nif len(self._data) > self.capacity:\n    self._data.popitem(last=False)\nend_of_edit\n```',
      observation: 'File updated.',
      state: '{"open_file": "src/cachekit/lru.py", "working_dir": "/repo"}',
      response: 'Flipping the eviction direction.',
    },
    {
      thought: 'Run the full suite again.',
      action: '```\npytest -q\n```',
      observation: '14 passed in 0.41s',
      state: '{"open_file": "src/cachekit/lru.py", "working_dir": "/repo"}',
      response: 'Re-running tests.',
    },
    {
      thought: 'All tests pass. Submit the patch.',
      action: '```\nsubmit\n```',
      observation: 'Patch submitted.',
      state: '{}',
      response: 'Submitting the fix.',
    },
  ],
  info: {
    instance_id: 'acme__cachekit-17',
    exit_status: 'submitted',
    submission:
      'diff --git a/src/cachekit/lru.py b/src/cachekit/lru.py\n--- a/src/cachekit/lru.py\n+++ b/src/cachekit/lru.py\n@@ -26,7 +26,7 @@\n-        if len(self._data) > self.capacity:\n-            self._data.popitem(last=True)\n+        if len(self._data) > self.capacity:\n+            self._data.popitem(last=False)\n',
    model_stats: { instance_cost: 0.041, tokens_sent: 18120, tokens_received: 1204 },
  },
  environment: {
    config: { model: { model_name: 'gpt-4o-mini' } },
  },
}

export function sampleSweAgentText(): string {
  return JSON.stringify(sampleSweAgentTrajectory, null, 2)
}
