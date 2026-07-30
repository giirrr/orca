import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'

describe('packaged hang watchdog worker contract', () => {
  it('boots the worker from app.asar in PR checks', () => {
    const workflow = parse(readFileSync('.github/workflows/pr.yml', 'utf8'))
    const smokeSource = readFileSync(
      'config/scripts/smoke-packaged-hang-watchdog-worker.mjs',
      'utf8'
    )
    const smokeStep = workflow.jobs.package.steps.find(
      (step) => step.name === 'Smoke packaged hang watchdog worker'
    )

    expect(smokeStep.run).toBe(
      'xvfb-run --auto-servernum node config/scripts/smoke-packaged-hang-watchdog-worker.mjs --app-dir=dist/linux-unpacked'
    )
    expect(smokeSource).toContain(
      "process.platform === 'linux' ? ['--no-sandbox', launcherDir] : [launcherDir]"
    )
  })
})
