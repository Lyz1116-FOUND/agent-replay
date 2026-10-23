"""Harness error types.

Errors are split by origin so the loop can decide whether a failure is the
agent's, the provider's, or the harness's. Only the loop converts them into a
recorded failure; tools and the registry return ``ToolResult`` instead.
"""

from __future__ import annotations


class HarnessError(Exception):
    """Base class for harness-originated errors."""


class ConfigError(HarnessError):
    """Invalid or incomplete harness configuration."""


class WorkspaceError(HarnessError):
    """The task workspace could not be prepared or inspected."""


class ModelError(HarnessError):
    """A model call failed (network, HTTP, malformed response)."""


class ToolArgumentError(HarnessError):
    """Tool arguments do not match the tool's JSON schema."""


class ToolExecutionError(HarnessError):
    """A tool raised while executing."""


class GraderError(HarnessError):
    """A grader could not produce a verdict."""
