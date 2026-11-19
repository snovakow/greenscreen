// npm run test:examples: the package as npm packs it, installed into each example and used the way it would be: from
// a page with no build step (as modules, as one file and from a script tag), from TypeScript under bundler and Node
// resolution, and from a React app built with Vite. Each page is opened in headless Chrome and its keyed picture read
// back. Exits 1 if anything fails
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { launch } from '../test/chrome.mjs'
import { serve } from '../test/serve.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const examples = join(root, 'examples')
const bin = (name) => join(root, 'node_modules', '.bin', name)

let failed = 0
function expect(name, condition, detail) {
  console.log(`  ${condition ? '✓' : '✗'} ${name}${detail ? `  (${detail})` : ''}`)
  if (!condition) failed += 1
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', shell: process.platform === 'win32', ...options })
  return { ok: result.status === 0, output: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim() }
}

console.log('\n# packing')
const folder = await mkdtemp(join(tmpdir(), 'greenscreen-pack-'))
const packed = run('npm', ['pack', '--pack-destination', folder, '--silent'])
const tarball = join(folder, packed.output.split('\n').pop() ?? '')
expect('npm pack', packed.ok, packed.ok ? tarball : packed.output)
if (!packed.ok) process.exit(1)

for (const example of ['plain', 'typescript', 'react']) {
  const target = join(examples, example, 'node_modules', '@snovakow', 'greenscreen')
  await rm(target, { recursive: true, force: true })
  await mkdir(target, { recursive: true })
  const extracted = run('tar', ['-xzf', tarball, '-C', target, '--strip-components=1'])
  expect(`installed into examples/${example}`, extracted.ok, extracted.output)
}

console.log('\n# TypeScript')
for (const config of ['typescript/tsconfig.json', 'typescript/tsconfig.node16.json', 'react/tsconfig.json']) {
  const checked = run(bin('tsc'), ['-p', join(examples, config)])
  expect(`tsc -p examples/${config}`, checked.ok, checked.output.split('\n').slice(0, 8).join(' | '))
}

console.log('\n# React app')
const built = run(bin('vite'), ['build', '--config', join(examples, 'react', 'vite.config.ts'), '--logLevel', 'warn'])
expect('vite build examples/react', built.ok, built.output.split('\n').slice(0, 8).join(' | '))

console.log('\n# pages')
const PAGES = [
  ['plain/index.html', '#keyed', 'ES modules through an import map'],
  ['plain/min.html', '#keyed', 'the single-file ES module'],
  ['plain/global.html', '#keyed', 'the script tag'],
  ['react/dist/index.html', '.keyed canvas', 'the React app'],
]
// The picture's green corner must be keyed out and its red square kept
const READ = `(selector) => {
  const keyed = document.querySelector(selector)
  if (!keyed || keyed.width !== 160) return null
  const canvas = document.createElement('canvas')
  canvas.width = keyed.width
  canvas.height = keyed.height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  context.drawImage(keyed, 0, 0)
  return { green: Array.from(context.getImageData(10, 10, 1, 1).data), red: Array.from(context.getImageData(80, 60, 1, 1).data) }
}`

const server = await serve(examples)
const browser = await launch({ flags: ['--enable-unsafe-swiftshader'] })
try {
  for (const [path, selector, name] of PAGES) {
    const page = await browser.newPage(`${server.url}/${path}`)
    let read = null
    for (let i = 0; i < 50 && !read; i++) {
      read = await page.evaluate(`(${READ})(${JSON.stringify(selector)})`)
      if (!read) await new Promise((resolve) => setTimeout(resolve, 100))
    }
    const keyed = read && read.green[3] === 0 && read.red[3] === 255 && read.red[0] > 200
    expect(`${name}: green keyed out, red kept`, keyed, read ? `green ${read.green.join(',')}, red ${read.red.join(',')}` : 'no keyed canvas')
    const problems = page.messages.filter((message) => /^\[(error|exception|warning)\]/.test(message))
    expect(`${name}: no errors or warnings`, problems.length === 0, problems.join(' | '))
  }
} finally {
  await browser.close()
  await server.close()
  await rm(folder, { recursive: true, force: true })
}

console.log(failed ? `\n${failed} failed` : '\nAll passed')
process.exitCode = failed ? 1 : 0
