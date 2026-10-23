"""Tool protocol and argument validation.

Every tool exposes an OpenAI-compatible function schema and returns
``ToolResult``. The registry is the only place the loop executes tools, so
adding MCP later means adding an adapter, not changing the loop.
"""

from __future__ import annotations

import json
import time
from abc import ABC, abstractmethod
from typing import Any

from ..harness.errors import ToolArgumentError
from ..harness.types import ToolResult


def _type_matches(value: Any, expected: str) -> bool:
    if expected == "object":
        return isinstance(value, dict)
    if expected == "array":
        return isinstance(value, list)
    if expected == "string":
        return isinstance(value, str)
    if expected == "integer":
        return isinstance(value, int) and not isinstance(value, bool)
    if expected == "number":
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    if expected == "boolean":
        return isinstance(value, bool)
    if expected == "null":
        return value is None
    return True


def validate_arguments(schema: dict[str, Any], arguments: dict[str, Any]) -> None:
    if not isinstance(arguments, dict):
        raise ToolArgumentError("arguments must be a JSON object")
    properties = schema.get("properties", {})
    required = schema.get("required", [])
    for name in required:
        if name not in arguments:
            raise ToolArgumentError(f"missing required argument: {name}")
    if schema.get("additionalProperties") is False:
        unknown = set(arguments) - set(properties)
        if unknown:
            raise ToolArgumentError(
                f"unknown argument(s): {', '.join(sorted(unknown))}"
            )
    for name, value in arguments.items():
        spec = properties.get(name)
        if spec is None:
            continue
        _validate_value(value, spec, name)


def _validate_value(value: Any, spec: dict[str, Any], path: str) -> None:
    expected = spec.get("type")
    if expected and not _type_matches(value, expected):
        raise ToolArgumentError(f"{path}: expected {expected}, got {type(value).__name__}")
    if "enum" in spec and value not in spec["enum"]:
        raise ToolArgumentError(f"{path}: expected one of {spec['enum']}")
    if isinstance(value, str):
        if "minLength" in spec and len(value) < spec["minLength"]:
            raise ToolArgumentError(f"{path}: shorter than {spec['minLength']} characters")
        if "maxLength" in spec and len(value) > spec["maxLength"]:
            raise ToolArgumentError(f"{path}: longer than {spec['maxLength']} characters")
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if "minimum" in spec and value < spec["minimum"]:
            raise ToolArgumentError(f"{path}: must be >= {spec['minimum']}")
        if "maximum" in spec and value > spec["maximum"]:
            raise ToolArgumentError(f"{path}: must be <= {spec['maximum']}")
    if isinstance(value, list):
        item_spec = spec.get("items")
        if isinstance(item_spec, dict):
            for index, item in enumerate(value):
                _validate_value(item, item_spec, f"{path}[{index}]")
        if "minItems" in spec and len(value) < spec["minItems"]:
            raise ToolArgumentError(f"{path}: needs at least {spec['minItems']} items")
        if "maxItems" in spec and len(value) > spec["maxItems"]:
            raise ToolArgumentError(f"{path}: allows at most {spec['maxItems']} items")
    if isinstance(value, dict) and isinstance(spec.get("properties"), dict):
        validate_arguments(spec, value)


class Tool(ABC):
    execution_deadline: float | None = None
    name: str
    description: str
    parameters: dict[str, Any]

    def remaining_timeout(self, requested: float) -> float:
        if self.execution_deadline is None:
            return requested
        return max(0.001, min(requested, self.execution_deadline - time.monotonic()))

    def schema(self) -> dict[str, Any]:
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": self.parameters,
            },
        }

    def validate(self, arguments: dict[str, Any]) -> None:
        validate_arguments(self.parameters, arguments)

    @abstractmethod
    def execute(self, **kwargs: Any) -> ToolResult:
        raise NotImplementedError


def compact_json(value: Any, limit: int = 400) -> str:
    text = json.dumps(value, ensure_ascii=False, default=str)
    return text if len(text) <= limit else text[: limit - 3] + "..."
