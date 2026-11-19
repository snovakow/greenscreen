// npm test: the page of checks, in headless Chrome, once on this machine's GPU and once on SwiftShader, Chrome's own
// software renderer, for both WebGL2 and WebGPU. It serves the demo's build, which npm test makes first, or with --dev
// the demo's Vite server, which needs no build. Exits 1 if a check fails
//   node test/run.mjs [--dev] [--only gpu|swiftshader] [--require-webgpu]
import { fileURLToPath } from 'node:url'
import { launch } from './chrome.mjs'
import { serve } from './serve.mjs'

const args = process.argv.slice(2)
const option = (name) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}

const PASSES = [
  { name: 'gpu', flags: [] },
  { name: 'swiftshader', flags: ['--use-angle=swiftshader', '--use-webgpu-adapter=swiftshader'] },
].filter((pass) => !option('--only') || pass.name === option('--only'))

const FLAGS = ['--enable-unsafe-webgpu', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required']

// The checks run as the page opens, and window.greenscreenChecks resolves once they're done: in 30 to 45 s on a quiet
// machine, and in longer with other Chromes running, as other test runs start them. So it has longer than a command
const RUN_TIMEOUT = 180_000

let server
if (args.includes('--dev')) {
  const { createServer } = await import('vite')
  const vite = await createServer({
    configFile: fileURLToPath(new URL('../demo/vite.config.ts', import.meta.url)),
    server: { host: '127.0.0.1', port: 5199, strictPort: false },
    logLevel: 'warn',
  })
  await vite.listen()
  server = { url: vite.resolvedUrls.local[0].replace(/\/$/, ''), close: () => vite.close() }
} else {
  server = await serve(fileURLToPath(new URL('../demo/dist', import.meta.url)))
}

const MARKS = { pass: '✓', fail: '✗', skip: '–' }
let failed = 0

try {
  for (const pass of PASSES) {
    const browser = await launch({ flags: [...FLAGS, ...pass.flags] })
    try {
      const page = await browser.newPage(`${server.url}/check/`)
      const results = await page.evaluate('window.greenscreenChecks', { timeout: RUN_TIMEOUT })
      console.log(`\n# ${pass.name}`)
      for (const [name, value] of Object.entries(results.environment)) console.log(`  ${name}: ${value}`)
      for (const outcome of results.outcomes) {
        const detail = outcome.detail ? `  (${outcome.detail.replace(/\n/g, ' ')})` : ''
        console.log(`  ${MARKS[outcome.status]} ${outcome.group}: ${outcome.name}${detail}`)
      }
      const fails = results.outcomes.filter((outcome) => outcome.status === 'fail')
      const webgpuSkipped = results.outcomes.some(
        (outcome) => outcome.status === 'skip' && /WebGPU/.test(outcome.group) && outcome.name === 'Runs here',
      )
      if (webgpuSkipped && args.includes('--require-webgpu')) {
        console.log('  ✗ WebGPU was required but did not run')
        failed += 1
      }
      failed += fails.length
      const problems = page.messages.filter((message) => /^\[(error|exception)\]/.test(message))
      if (problems.length) console.log(`  page errors:\n    ${problems.join('\n    ')}`)
    } finally {
      await browser.close()
    }
  }
} finally {
  await server.close()
}

console.log(failed ? `\n${failed} failed` : '\nAll passed')
process.exitCode = failed ? 1 : 0
