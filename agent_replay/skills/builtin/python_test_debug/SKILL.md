# Python Test Debugging

Use this procedure when a Python test suite fails.

1. Run the failing tests immediately with `run_tests`.
2. Identify the smallest failing test and read its assertion.
3. Locate the implementation with `grep`, then inspect it with `read_file`.
4. Never modify `tests/`, `pytest.ini`, or any other protected file.
5. Apply the smallest source change that explains the failure. Prefer fixing the cause over special-casing the test input.
6. Rerun the targeted test, then run the full suite.
7. Inspect `git_diff`, check that no unrelated behavior changed, and stop only when the full suite passes.
