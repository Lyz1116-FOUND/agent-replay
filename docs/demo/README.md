# Demo media

These assets are generated from the **built-in Codex LRU demo**, not from the live OpenCode capture. The demo is labelled in the UI.

| File | Purpose |
|---|---|
| `replay.gif` | README hero animation, 20 s, 1100×688, 10 fps |
| `social-preview.png` | GitHub repository social preview, 1280×640 |
| `s06-failure.png` | First failing test |
| `s08-wrong-fix.png` | First edit diff |
| `s09-regression.png` | Regression after the wrong fix |
| `s13-correct-fix.png` | Corrected edit diff |
| `s14-recovered.png` | Final passing test |
| `overview-recovered.png` | Recovery overview used in the social card |

## Regenerate

```bash
npx playwright-core install ffmpeg   # Playwright's video recorder needs this binary
npm run build:demo
npm run preview:demo                 # http://127.0.0.1:4173/agent-replay/
npm run demo:record
```

`demo:record` uses `playwright-core` (a devDependency) with the locally installed Google Chrome. Set `CHROME_PATH` if Chrome is elsewhere. The raw `.webm` and the release MP4 (`demo-output/replay.mp4`, 20 s, 1440×900, H.264/yuv420p) are written to `demo-output/` and intentionally ignored by git; the MP4 is uploaded as a release asset.

The recording plays the built-in demo at 4×, pauses to open the two edits and the regression, then returns to the Overview. It is trimmed only at the start/end; the UI states are real screenshots of the running app. No static frames are used to fake playback.

The live capture evidence is separate: [`REAL_CAPTURE.md`](REAL_CAPTURE.md).
