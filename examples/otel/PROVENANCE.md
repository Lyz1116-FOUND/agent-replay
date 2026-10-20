# OTLP fixtures

| File | Source |
|---|---|
| `real-exporter-node.json` | Captured from a real exporter. `@opentelemetry/sdk-trace-node` 2.12.0 + `@opentelemetry/exporter-trace-otlp-http` 0.223.0, OTLP/HTTP JSON, 2026-10-20. The exporter POSTed three single-span requests to a local listener; the bodies are concatenated into one `resourceSpans` list, nothing else was edited. One trace, three spans (`invoke_agent` → `chat` → `execute_tool bash`), tool status `ERROR`. |
| everything else | Deterministic contract fixtures from [`scripts/otel-fixtures.mjs`](../../scripts/otel-fixtures.mjs). Regenerate with `node scripts/otel-fixtures.mjs`. |

These fixtures prove the converter's rules. They do not, on their own, prove that every framework's default tracing is compatible: only a payload that actually matches the OTLP JSON contract is importable.
