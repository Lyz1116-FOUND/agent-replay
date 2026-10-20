import { homedir } from 'node:os'
import path from 'node:path'
import type { Environment } from '../../src/schema/trace.ts'
import type { SessionMeta } from './types.ts'

/** Kept in sync with package.json by environment.test.ts. */
export const RECORDER_VERSION = '1.0.0-beta.1'

/** Never write a real home directory into a trace. */
export function sanitizePath(value: string | undefined): string | undefined {
  if (!value) return undefined
  const home = homedir()
  if (home && value.startsWith(home)) return `~${value.slice(home.length)}`
  return value
}

export function buildEnvironment(meta: SessionMeta): Environment {
  const shell = process.env.SHELL ? path.basename(process.env.SHELL) : undefined
  return {
    isolation: meta.isolation,
    provider: meta.provider,
    model: meta.model,
    harnessVersion: meta.harnessVersion,
    recorderVersion: RECORDER_VERSION,
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
    shell,
    cwdRealpath: sanitizePath(meta.cwd),
    agentCli: meta.agent ? { name: meta.agent, version: meta.harnessVersion } : undefined,
    network: {
      proxyConfigured: Boolean(process.env.HTTPS_PROXY ?? process.env.HTTP_PROXY),
    },
  }
}
