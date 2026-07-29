#!/usr/bin/env node
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const DEFAULT_TRIALS = 3
const READY_TIMEOUT_MS = 5_000
const SETTLE_MS = 2_000
const EXPECTED_REAP_NOT_BEFORE_MS = 30_000
const OWNER_DEADLINE_MS = 35_000
const MIB = 1024 * 1024
const repoRoot = path.resolve(import.meta.dirname, '..', '..')
const helperPath = path.join(
  repoRoot,
  'native',
  'computer-use-macos',
  '.build',
  'release',
  'Orca Computer Use.app',
  'Contents',
  'MacOS',
  'orca-computer-use-macos'
)

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
}

function rssBytes(pid) {
  const raw = execFileSync('ps', ['-o', 'rss=', '-p', String(pid)], {
    encoding: 'utf8'
  }).trim()
  const rssKiB = Number(raw)
  if (!Number.isFinite(rssKiB) || rssKiB <= 0) {
    throw new Error(`Could not read helper RSS for PID ${pid}`)
  }
  return rssKiB * 1024
}

async function waitForSocket(socketPath, exitState) {
  const deadline = Date.now() + READY_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (existsSync(socketPath)) {
      return
    }
    if (exitState.value) {
      throw new Error(`Helper exited before binding its socket: ${JSON.stringify(exitState.value)}`)
    }
    await sleep(50)
  }
  throw new Error('Helper did not bind its socket before the readiness deadline')
}

async function stopChild(child, exitPromise) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return
  }
  child.kill('SIGTERM')
  const stopped = await Promise.race([exitPromise.then(() => true), sleep(2_000).then(() => false)])
  if (!stopped) {
    child.kill('SIGKILL')
    await exitPromise
  }
}

async function runTrial(expectation) {
  const dir = mkdtempSync(path.join(tmpdir(), 'orca-helper-owner-bench-'))
  const socketPath = path.join(dir, 'agent.sock')
  const tokenPath = path.join(dir, 'agent.token')
  writeFileSync(tokenPath, 'benchmark-token', { mode: 0o600 })
  const startedAt = performance.now()
  const child = spawn(helperPath, ['--agent', socketPath, '--token-file', tokenPath], {
    stdio: 'ignore'
  })
  const exitState = { value: null }
  const exitPromise = new Promise((resolve) => {
    child.once('exit', (code, signal) => {
      exitState.value = { code, signal, elapsedMs: performance.now() - startedAt }
      resolve(exitState.value)
    })
  })

  try {
    await waitForSocket(socketPath, exitState)
    await sleep(SETTLE_MS)
    const preDeadlineRssBytes = rssBytes(child.pid)
    const exitedBeforeDeadline = await Promise.race([
      exitPromise.then((exit) => ({ exit })),
      sleep(OWNER_DEADLINE_MS).then(() => null)
    ])
    const retainedAfterDeadline = exitedBeforeDeadline === null
    const postDeadlineRssBytes = retainedAfterDeadline ? rssBytes(child.pid) : 0
    const exit = exitedBeforeDeadline?.exit ?? null

    if (expectation === 'reaped') {
      if (
        retainedAfterDeadline ||
        exit?.code !== 0 ||
        exit.elapsedMs < EXPECTED_REAP_NOT_BEFORE_MS
      ) {
        throw new Error(`Expected a clean helper exit after owner timeout: ${JSON.stringify(exit)}`)
      }
    } else if (!retainedAfterDeadline) {
      throw new Error(`Expected the baseline helper to remain resident: ${JSON.stringify(exit)}`)
    }

    return {
      preDeadlineRssBytes,
      postDeadlineRssBytes,
      retainedAfterDeadline,
      exitMs: exit?.elapsedMs ?? null
    }
  } finally {
    await stopChild(child, exitPromise)
    rmSync(dir, { recursive: true, force: true })
  }
}

function parseArgs(argv) {
  const options = { expect: '', trials: DEFAULT_TRIALS, output: '' }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const value = argv[index + 1]
    if (arg === '--expect' || arg === '--trials' || arg === '--output') {
      if (!value) {
        throw new Error(`Missing value for ${arg}`)
      }
      options[arg.slice(2)] = arg === '--trials' ? Number(value) : value
      index += 1
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }
  if (!['retained', 'reaped'].includes(options.expect)) {
    throw new Error('--expect must be retained or reaped')
  }
  if (!Number.isInteger(options.trials) || options.trials < 1) {
    throw new Error('--trials must be a positive integer')
  }
  return options
}

async function runBenchmark() {
  if (process.platform !== 'darwin') {
    throw new Error('The computer-use helper owner benchmark is macOS-only')
  }
  if (!existsSync(helperPath)) {
    throw new Error(`Missing ${helperPath}; run pnpm build:computer-macos first`)
  }
  const options = parseArgs(process.argv.slice(2))
  const results = []
  for (let trial = 0; trial < options.trials; trial += 1) {
    results.push(await runTrial(options.expect))
  }
  const preDeadlineRssBytes = results.map((result) => result.preDeadlineRssBytes)
  const postDeadlineRssBytes = results.map((result) => result.postDeadlineRssBytes)
  const exitTimes = results.flatMap((result) => (result.exitMs === null ? [] : [result.exitMs]))
  const report = {
    benchmark: 'macos-computer-helper-owner-loss',
    revision: execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repoRoot,
      encoding: 'utf8'
    }).trim(),
    expectation: options.expect,
    trials: options.trials,
    ownerDeadlineMs: OWNER_DEADLINE_MS,
    preDeadlineRssMiB: preDeadlineRssBytes.map((value) => Number((value / MIB).toFixed(2))),
    medianPreDeadlineRssMiB: Number((median(preDeadlineRssBytes) / MIB).toFixed(2)),
    postDeadlineRssMiB: postDeadlineRssBytes.map((value) => Number((value / MIB).toFixed(2))),
    medianPostDeadlineRssMiB: Number((median(postDeadlineRssBytes) / MIB).toFixed(2)),
    retainedAfterDeadline: results.map((result) => result.retainedAfterDeadline),
    exitMs: exitTimes.map((value) => Math.round(value)),
    medianExitMs: exitTimes.length > 0 ? Math.round(median(exitTimes)) : null
  }
  const serialized = `${JSON.stringify(report, null, 2)}\n`
  process.stdout.write(serialized)
  if (options.output) {
    writeFileSync(path.resolve(options.output), serialized)
  }
}

await runBenchmark()
