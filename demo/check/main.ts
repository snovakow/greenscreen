import { apiChecks, coreChecks, coreSubject, keyingChecks } from './checks.ts'
import type { Outcome } from './harness.ts'
import { extraSubjects } from './subjects.ts'

// The page of checks: every way of keying against the reference, on this browser's WebGL2 and WebGPU. It runs as it
// opens, and shows what passed. npm test reads the same results from window.greenscreenChecks

interface Results {
  environment: Record<string, string>
  outcomes: Outcome[]
}

declare global {
  interface Window {
    greenscreenChecks?: Promise<Results>
  }
}

const table = document.querySelector<HTMLTableSectionElement>('#results tbody')
const summary = document.querySelector<HTMLElement>('#summary')
const about = document.querySelector<HTMLElement>('#environment')
const copy = document.querySelector<HTMLButtonElement>('#copy')

const outcomes: Outcome[] = []
const MARKS = { pass: '✓', fail: '✗', skip: '–' }

function report(outcome: Outcome) {
  outcomes.push(outcome)
  if (!table) return
  const row = table.insertRow()
  row.className = outcome.status
  row.insertCell().textContent = MARKS[outcome.status]
  row.insertCell().textContent = outcome.group
  row.insertCell().textContent = outcome.name
  row.insertCell().textContent = outcome.detail
}

async function environment(): Promise<Record<string, string>> {
  const found: Record<string, string> = { browser: navigator.userAgent }
  const gl = document.createElement('canvas').getContext('webgl2')
  if (gl) {
    const info = gl.getExtension('WEBGL_debug_renderer_info')
    found.webgl2 = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER))
    gl.getExtension('WEBGL_lose_context')?.loseContext()
  } else {
    found.webgl2 = 'not available'
  }
  if (!navigator.gpu) {
    found.webgpu = 'not available'
  } else {
    const adapter = await navigator.gpu.requestAdapter()
    if (!adapter) found.webgpu = 'no adapter'
    else {
      const info = adapter.info
      found.webgpu = [info.vendor, info.architecture, info.description, info.isFallbackAdapter ? 'fallback' : '']
        .filter(Boolean)
        .join(' ')
    }
  }
  return found
}

function text(results: Results) {
  const lines = Object.entries(results.environment).map(([name, value]) => `${name}: ${value}`)
  for (const outcome of results.outcomes) {
    lines.push(`${MARKS[outcome.status]} ${outcome.group} | ${outcome.name}${outcome.detail ? ` | ${outcome.detail}` : ''}`)
  }
  return lines.join('\n')
}

async function run(): Promise<Results> {
  const found = await environment()
  if (about) about.textContent = Object.entries(found).map(([name, value]) => `${name}: ${value}`).join('\n')

  await apiChecks(report)
  for (const backend of ['webgl', 'webgpu'] as const) {
    await keyingChecks(report, coreSubject(backend))
    await coreChecks(report, backend)
  }
  for (const subject of await extraSubjects()) await keyingChecks(report, subject)

  const failed = outcomes.filter((outcome) => outcome.status === 'fail').length
  const passed = outcomes.filter((outcome) => outcome.status === 'pass').length
  const skipped = outcomes.filter((outcome) => outcome.status === 'skip').length
  if (summary) {
    summary.textContent = failed
      ? `${failed} of ${passed + failed} checks failed${skipped ? `, ${skipped} skipped` : ''}`
      : `All ${passed} checks passed${skipped ? `, ${skipped} skipped` : ''}`
    summary.className = failed ? 'fail' : 'pass'
  }
  const results = { environment: found, outcomes }
  if (copy) {
    copy.hidden = false
    copy.onclick = () => {
      void navigator.clipboard.writeText(text(results)).then(() => (copy.textContent = 'Copied'))
    }
  }
  return results
}

window.greenscreenChecks = run().catch((error: unknown) => {
  report({ group: 'Checks', name: 'Ran to the end', status: 'fail', detail: String(error) })
  return { environment: {}, outcomes }
})
