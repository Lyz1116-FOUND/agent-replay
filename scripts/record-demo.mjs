import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { chromium } from 'playwright-core'

const args = process.argv.slice(2)
function arg(name, fallback) {
  const index = args.indexOf(`--${name}`)
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback
}

const url = arg('url', 'http://127.0.0.1:4173/agent-replay/#/runs/run_lru_codex_9f2a?step=s06')
const outDir = path.resolve(arg('out-dir', 'docs/demo'))
const rawDir = path.resolve(arg('raw-dir', 'demo-output'))
const viewport = { width: 1440, height: 900 }

const chromeCandidates = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean)
const executablePath = chromeCandidates.find((candidate) => fs.existsSync(candidate))
if (!executablePath) {
  throw new Error('Chrome not found. Set CHROME_PATH to a Chromium executable.')
}

fs.mkdirSync(outDir, { recursive: true })
fs.mkdirSync(rawDir, { recursive: true })

const browser = await chromium.launch({ headless: true, executablePath })
const context = await browser.newContext({
  viewport,
  locale: 'en-US',
  recordVideo: { dir: rawDir, size: viewport },
})
await context.addInitScript(() => {
  try {
    localStorage.setItem('agent-replay:locale', 'en')
  } catch {
    // Storage may be unavailable on the initial about:blank page.
  }
})
const page = await context.newPage()
const errors = []
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text())
})
page.on('pageerror', (error) => errors.push(String(error)))

await page.goto(url, { waitUntil: 'networkidle' })
await page.getByRole('heading', { name: /Fix LRU cache eviction/ }).waitFor()
const play = page.getByRole('button', { name: /Play replay/ })
await play.waitFor()
await page.waitForTimeout(900)

const shot = async (name) => {
  await page.screenshot({ path: path.join(outDir, name) })
}
const pauseIfPlaying = async () => {
  const pause = page.getByRole('button', { name: /Pause replay/ })
  if (await pause.count()) await pause.click()
}

await shot('s06-failure.png')
await play.click()
await page.waitForTimeout(2600)
await pauseIfPlaying()
await page.getByRole('button', { name: /^08 Edit lru\.py/ }).click()
await page.waitForTimeout(1600)
await shot('s08-wrong-fix.png')
await page.getByRole('button', { name: /^09 pytest -q/ }).click()
await page.waitForTimeout(1600)
await shot('s09-regression.png')
await page.getByRole('button', { name: /Play replay/ }).click()
await page.waitForTimeout(1500)
await pauseIfPlaying()
await page.getByRole('button', { name: /^13 Edit lru\.py/ }).click()
await page.waitForTimeout(1600)
await shot('s13-correct-fix.png')
await page.getByRole('button', { name: /^14 pytest -q/ }).click()
await page.waitForTimeout(1200)
await shot('s14-recovered.png')
await page.getByRole('button', { name: /Play replay/ }).click()
await page.waitForTimeout(3200)
await page.getByRole('button', { name: /^Overview$/ }).click()
await page.waitForTimeout(3600)
await shot('overview-recovered.png')

const video = page.video()
if (!video) throw new Error('Playwright did not start video recording.')
await context.close()
const videoPath = await video.path()
await browser.close()

const ffprobe = spawnSync('ffprobe', [
  '-v', 'error', '-show_entries', 'format=duration',
  '-of', 'default=nw=1:nk=1', videoPath,
], { encoding: 'utf8' })
const duration = Number(ffprobe.stdout.trim())
if (!Number.isFinite(duration) || duration <= 0) throw new Error('Could not read video duration.')
const trimStart = 0.5
const trimDuration = Math.min(23.5, Math.max(15, duration - trimStart - 0.5))

const gifPath = path.join(outDir, 'replay.gif')
const mp4Path = path.join(rawDir, 'replay.mp4')
const gif = spawnSync('ffmpeg', [
  '-y', '-ss', String(trimStart), '-t', String(trimDuration), '-i', videoPath,
  '-vf', 'fps=10,scale=1100:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer',
  '-loop', '0', gifPath,
], { stdio: 'inherit' })
if (gif.status !== 0) throw new Error('ffmpeg GIF conversion failed.')
const mp4 = spawnSync('ffmpeg', [
  '-y', '-ss', String(trimStart), '-t', String(trimDuration), '-i', videoPath,
  '-vf', 'scale=1440:-2', '-r', '25', '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
  '-movflags', '+faststart', '-an', mp4Path,
], { stdio: 'inherit' })
if (mp4.status !== 0) throw new Error('ffmpeg MP4 conversion failed.')

const finalShot = fs.readFileSync(path.join(outDir, 'overview-recovered.png')).toString('base64')

const socialBrowser = await chromium.launch({ headless: true, executablePath })
const social = await socialBrowser.newPage({ viewport: { width: 1280, height: 640 }, locale: 'en-US' })
await social.setContent(`<!doctype html>
<html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; }
  body { margin: 0; width: 1280px; height: 640px; overflow: hidden; color: #e9eef5;
    background:
      radial-gradient(900px 420px at 80% 10%, rgba(56,132,255,.16), transparent 60%),
      linear-gradient(rgba(255,255,255,.028) 1px, transparent 1px),
      linear-gradient(90deg, rgba(255,255,255,.028) 1px, transparent 1px),
      #0a0c0f;
    background-size: auto, 40px 40px, 40px 40px, auto;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  .wrap { display: flex; width: 100%; height: 100%; padding: 52px 56px; gap: 40px; }
  .copy { width: 520px; padding-top: 18px; }
  .eyebrow { font: 600 12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .19em; color: #7d8da3; }
  h1 { margin: 20px 0 0; font: 700 52px/.98 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: -.045em; }
  h1 span { color: #5f6d80; }
  .tag { margin: 24px 0 0; font-size: 23px; line-height: 1.32; letter-spacing: -.02em; color: #c8d2df; max-width: 470px; }
  .tag em { color: #7fb6ff; font-style: normal; }
  .chips { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 22px; }
  .chip { border: 1px solid #26303d; border-radius: 4px; padding: 6px 9px; font: 500 10.5px/1 ui-monospace, SFMono-Regular, Menlo, monospace; color: #93a1b3; }
  .foot { position: absolute; left: 56px; bottom: 42px; font: 500 11px/1 ui-monospace, SFMono-Regular, Menlo, monospace; color: #667588; }
  .shot { position: relative; flex: 1; min-width: 0; border: 1px solid #273140; border-radius: 10px; overflow: hidden; background: #0d1117; box-shadow: 0 30px 80px rgba(0,0,0,.55); }
  .shot img { width: 100%; height: 100%; object-fit: cover; object-position: top center; display: block; }
  .label { position: absolute; left: 14px; top: 12px; border: 1px solid #2a3544; border-radius: 3px; padding: 4px 7px; background: rgba(10,12,15,.78); font: 500 9px/1 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .12em; color: #93a1b3; }
</style></head><body>
  <div class="wrap">
    <div class="copy">
      <div class="eyebrow">OPEN-SOURCE CODING-AGENT DEBUGGER</div>
      <h1>AGENT<br><span>REPLAY</span></h1>
      <p class="tag">See what the agent reported doing —<br>and <em>what actually changed.</em></p>
      <div class="chips"><span class="chip">NATIVE CAPTURE</span><span class="chip">VERIFIED EDITS</span><span class="chip">OTLP JSON</span></div>
    </div>
    <div class="shot"><span class="label">BUILT-IN DEMO · 4× REPLAY</span><img src="data:image/png;base64,${finalShot}" alt=""></div>
  </div>
  <div class="foot">github.com/Lyz1116-FOUND/agent-replay</div>
</body></html>`)
await social.screenshot({ path: path.join(outDir, 'social-preview.png') })
await socialBrowser.close()

console.log(JSON.stringify({
  video: videoPath,
  duration: Number(duration.toFixed(2)),
  trimmed: Number(trimDuration.toFixed(2)),
  gif: gifPath,
  mp4: mp4Path,
  social: path.join(outDir, 'social-preview.png'),
  consoleErrors: errors,
}, null, 2))
