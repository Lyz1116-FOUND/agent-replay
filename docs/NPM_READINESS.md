# npm readiness — v1.0.0-beta.1

Evaluated 2026-10-21. **No `npm publish` was run.**

## Package name

`npm view agent-replay` resolves to an existing, unrelated package:

| Field | Value |
|---|---|
| Name | `agent-replay` |
| Existing version | `0.1.1` |
| Maintainer | `mattetc` |
| Repository | `github.com/mttetc/agent-replay` |

The name is therefore **not available** to this project, and the beta is source-installed (`git clone` + `npm link`). The package name was not changed to grab a registry name; this is a separate decision for a future release. `npm view` returning a package is not a claim of ownership either way.

## Packaging

The repository now has:

```json
"files": ["dist", "dist-cli", "README.md", "README.zh-CN.md", "LICENSE"],
"prepack": "npm run build"
```

`prepack` builds the viewer and CLI before packing; installers from the tarball do not need a build step.

`npm pack` output:

- `agent-replay-1.0.0-beta.1.tgz`
- 34 files
- 1.5 MB packed / ~4.9 MB unpacked
- includes `dist/` (viewer, assets, Monaco workers, fonts) and `dist-cli/agent-replay.mjs`
- excludes source, tests, examples, docs, and media

`npm pack` without `--ignore-scripts` also succeeded, confirming `prepack` runs.

## Clean install verification

A tarball was installed into a fresh temporary npm project:

```text
npm install /tmp/.../agent-replay-1.0.0-beta.1.tgz
./node_modules/.bin/agent-replay --version    -> 1.0.0-beta.1
./node_modules/.bin/agent-replay --help       -> command list rendered
```

The installed CLI served a real trace with `AGENT_REPLAY_NO_OPEN=1 agent-replay open <trace> --port <port>`:

- `GET /` → 200
- `/assets/index-*.js` and `/assets/index-*.css` → 200
- fonts → 200
- `/__agent_replay/trace.json` → 200
- browser opened `/runs/<id>?trace=...`, task title rendered, no console errors
- the edit span showed the patch artifact; the installed viewer is complete

## Verdict

- The install chain is functional after the packaging fix.
- Publishing is blocked by the taken package name, not by the tarball.
- No publish was attempted, no registry state was changed.
- Source installation remains the supported beta path.
