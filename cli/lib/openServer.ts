import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { pathExists } from './fsutil.ts'

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ico': 'image/x-icon',
}

function locateDist(): string {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const candidates = [
    process.env.AGENT_REPLAY_DIST,
    path.resolve(here, '..', 'dist'),
    path.resolve(here, '..', '..', 'dist'),
  ].filter((candidate): candidate is string => Boolean(candidate))
  for (const candidate of candidates) {
    if (pathExists(path.join(candidate, 'index.html'))) return candidate
  }
  throw new Error('Web build not found. Run `npm run build` before `agent-replay open`.')
}

function openBrowser(url: string): void {
  const platform = process.platform
  const command = platform === 'darwin' ? 'open' : platform === 'win32' ? 'cmd' : 'xdg-open'
  const args = platform === 'win32' ? ['/c', 'start', '', url] : [url]
  try {
    const child = spawn(command, args, { detached: true, stdio: 'ignore' })
    child.unref()
  } catch {
    // The URL is printed below; the user can open it manually.
  }
}

function listen(server: http.Server, port: number, attempts = 20): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException) => {
      server.off('error', onError)
      if (error.code === 'EADDRINUSE' && attempts > 0) {
        listen(server, port + 1, attempts - 1).then(resolve, reject)
      } else {
        reject(error)
      }
    }
    server.once('error', onError)
    server.listen(port, '127.0.0.1', () => {
      server.off('error', onError)
      const address = server.address()
      resolve(typeof address === 'object' && address ? address.port : port)
    })
  })
}

export async function openTrace(options: {
  tracePath: string
  port?: number
}): Promise<void> {
  const dist = locateDist()
  const traceText = fs.readFileSync(options.tracePath, 'utf8')
  let title = path.basename(options.tracePath, '.trace.json')
  try {
    const parsed = JSON.parse(traceText) as { task?: { title?: string } }
    title = parsed.task?.title ?? title
  } catch {
    throw new Error(`Could not read trace: ${options.tracePath}`)
  }

  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    if (url.pathname === '/__agent_replay/trace.json') {
      response.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      })
      response.end(traceText)
      return
    }

    let pathname: string
    try {
      pathname = decodeURIComponent(url.pathname)
    } catch {
      response.writeHead(400)
      response.end('Bad request')
      return
    }

    const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '')
    const filePath = path.resolve(dist, relative)
    if (!filePath.startsWith(`${dist}${path.sep}`) && filePath !== path.join(dist, 'index.html')) {
      response.writeHead(403)
      response.end('Forbidden')
      return
    }

    let target = filePath
    if (!pathExists(target) || fs.statSync(target).isDirectory()) {
      target = path.join(dist, 'index.html')
    }
    try {
      const content = fs.readFileSync(target)
      response.writeHead(200, {
        'content-type': MIME[path.extname(target)] ?? 'application/octet-stream',
        'cache-control': 'no-store',
      })
      response.end(content)
    } catch {
      response.writeHead(404)
      response.end('Not found')
    }
  })

  const port = await listen(server, options.port ?? 4317)
  const traceUrl = '/__agent_replay/trace.json'
  const url = `http://127.0.0.1:${port}/?trace=${encodeURIComponent(traceUrl)}`

  process.stdout.write(`\nAgent Replay is serving "${title}"\n`)
  process.stdout.write(`  ${url}\n`)
  process.stdout.write('  Press Ctrl+C to stop.\n\n')
  if (!process.env.AGENT_REPLAY_NO_OPEN) openBrowser(url)

  await new Promise<void>((resolve) => {
    const shutdown = () => {
      server.close(() => resolve())
    }
    process.once('SIGINT', shutdown)
    process.once('SIGTERM', shutdown)
  })
}
