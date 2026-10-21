# Agent Replay — launch film

**Don’t stop at “Done.”** Replay the run. Inspect the evidence.

[Watch online](https://lyz1116-found.github.io/agent-replay/launch/) · [1080p MP4](https://github.com/Lyz1116-FOUND/agent-replay/releases/download/v1.0.0-beta.1/agent-replay-launch-1080p.mp4) · [720p MP4](https://github.com/Lyz1116-FOUND/agent-replay/releases/download/v1.0.0-beta.1/agent-replay-launch-720p.mp4) · [Editable source](https://github.com/Lyz1116-FOUND/agent-replay/releases/download/v1.0.0-beta.1/agent-replay-launch-source.zip)

## Direction

The final film builds on the approved v6 character and camera pass. A period opens into the execution, a dot follows a failing test back to a candidate edit, and two recorded sources are checked before the actual product is revealed. It is an original film, not a recording of an autonomous repair.

The last pass tightens the middle by about 0.6 seconds, preserves deliberate reading time, adds a quiet midrange bed beneath inspection, and gives the settled end card about 2.5 seconds. One character, one focal change at a time, three main changes of scale: entering the screen, entering the edit, and returning to the product.

Design research drew on the official [Linear Agent launch](https://linear.app/changelog/2026-03-24-introducing-linear-agent), [Raycast for Windows launch](https://www.raycast.com/blog/raycast-for-windows), and a public [Linear motion teardown](https://frame24.app/blog/how-linear-makes-launch-videos). The adopted principles are concise product positioning, restrained motion, legible typography, and a clear product-to-CTA handoff. These are design references, not endorsements or evidence of audience response to this film. No third-party footage, music, branding, or templates were copied.

## Timeline

| Time | Focus |
| --- | --- |
| 0–2.8s | Approach the screen, then enter the period and the same event space |
| 2.8–5.95s | Event flow slows into a failing test; other events recede |
| 5.95–6.4s | Character reaction close-up, then a look back |
| 6.4–8.8s | Follow the existing path to a visible EDIT destination |
| 8.8–14.7s | Inspect and replay the comparison change, then focus on `True → False` |
| 14.7–16.5s | Rerun tests, then show 14 passing tests |
| 16.5–21s | A separate OpenCode trace: reported edit, workspace diff, alignment, verification |
| 21–25.2s | A connecting line opens the actual product; the view pulls back |
| 25.2–30s | The dot leaves the timeline, becomes a play button, and settles with the CTA |

## Evidence and source boundaries

- **LRU:** the existing built-in Codex LRU demo, reconstructed as motion graphics. The story begins at its 8-failure regression and replays earlier edits. It is not a new live capture or validation result.
- **OpenCode:** a separate real recording, explicitly marked as another run and re-typeset from its trace. `calc.mjs` changes from `return value` to `return value + 1`. The recorder reports one workspace-verified edit and zero unverified edits. See the [capture evidence](../REAL_CAPTURE.md), [trace](../../../examples/beta-opencode.trace.json), and extracted [evidence summary](assets/real-capture-evidence.json).
- **Actual product:** the real built-in demo playback from the earlier beta media recording. It is labelled as such; this is not an OpenCode session screenshot.
- The character guides attention. Motion paths do not prove a root cause. The film does not claim automatic repair, stage token totals, or new product capabilities.

## Rebuild

From the repository root, install its JavaScript dependencies with `npm ci`. Also install FFmpeg, Python 3 + NumPy, and Google Chrome. `CHROME_PATH` can point to another Chrome installation.

```sh
python3 -m venv demo-output/launch-venv
. demo-output/launch-venv/bin/activate
python -m pip install -r docs/demo/launch/requirements.txt
bash docs/demo/launch/build.sh
```

`build.sh` renders 900 frames and writes videos, original synthesized audio/stems, a poster, a storyboard, and reports to the ignored `demo-output/agent-replay-launch-final/` directory. `LAUNCH_OUTPUT` overrides that directory. `bash docs/demo/launch/build.sh --encode-only` reuses rendered frames. Rendering uses `playwright-core` from the root package; no separate local package install is needed. `film.html` contains embedding placeholders and must be loaded through `render.mjs`.

The source archive contains this directory under `docs/demo/launch/` plus a minimal root `package.json`, so its paths and the same build command work after extraction.

The README preview is a **10-second silent excerpt**, 880×495 at 8fps. It cuts together 0–2.2s, 5.2–6.4s, 11–13.8s, 18–20.7s, and 28.8–29.9s of the final video. It is not a continuous real UI recording. The original 20-second [UI replay GIF](../replay.gif) remains available separately.

## Licensing and checks

Film graphics, character modules, and procedural music/effects are project material under the repository’s MIT license. No external music or samples are used. Bundled Inter and JetBrains Mono fonts retain their included SIL Open Font License files in `assets/`. The font binaries match the project’s installed Fontsource packages.

The shipped master is 1920×1080, 30fps, 30.000 seconds, 900 frames, H.264/yuv420p with AAC stereo at 48kHz and faststart. Its measured integrated loudness is **−17.04 LUFS**, true peak **−1.23 dBTP**, and loudness range **7.30 LU**. These are measurements of the encoded final video, not a promise that every playback device sounds the same. Full decode and frame checks passed; creative impact and subjective listening remain human judgments.

See [checksums and media metadata](verification.json). The original v6 file is preserved locally; the beta tag and earlier release assets are unchanged. This publication adds independently named media and a small static watch page.
