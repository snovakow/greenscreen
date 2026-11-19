// npm run test:examples: the package as npm packs it, installed into each example and used the way it would be: from
// a page with no build step (as modules, as one file and from a script tag), from TypeScript under bundler and Node
// resolution, and from a React app built with Vite. Each page is opened in headless Chrome and its keyed picture read
// back. Then each of the package's three files for the browser is loaded on a page of its own, where a keyer made as
// warmUp() resolves must draw from its first render. Exits 1 if anything fails
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
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
// And beside the tarball, for the first-render pages
const unpacked = join(folder, 'package')
await mkdir(unpacked)
const beside = run('tar', ['-xzf', tarball, '-C', unpacked, '--strip-components=1'])
expect('unpacked for the first-render pages', beside.ok, beside.output)

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

// The package's file to load, as the query says, on a page of its own, so warmUp() is the first to ask for the backend
// there. The keyer made in the task warmUp() resolves in must have its backend at once, and draw from its first render
const FIRST_RENDER = `<!doctype html>
<meta charset="utf-8">
<script type="module">
  const query = new URLSearchParams(location.search)
  const backend = query.get('backend')
  async function load(file) {
    if (file === 'modules') return import('./package/dist/index.js')
    if (file === 'min') return import('./package/dist/greenscreen.min.js')
    const script = document.createElement('script')
    script.src = './package/dist/greenscreen.global.js'
    await new Promise((resolve, reject) => {
      script.onload = resolve
      script.onerror = () => reject(new Error('greenscreen.global.js did not load'))
      document.head.append(script)
    })
    return { Greenscreen: window.Greenscreen, warmUp: window.Greenscreen.warmUp }
  }
  window.firstRender = (async () => {
    const { Greenscreen, warmUp } = await load(query.get('file'))
    const picture = document.createElement('canvas')
    picture.width = 4
    picture.height = 4
    picture.getContext('2d').fillRect(0, 0, 4, 4)
    let chosen
    try {
      chosen = await warmUp(backend)
    } catch (error) {
      return { unavailable: error.message }
    }
    const keyer = new Greenscreen(picture, { backend })
    const found = { chosen, backend: keyer.backend, drew: keyer.render() }
    keyer.dispose()
    return found
  })()
</script>
`
const FILES = [
  ['modules', 'ES modules'],
  ['min', 'the single-file ES module'],
  ['global', 'the script tag'],
]
await writeFile(join(folder, 'first-render.html'), FIRST_RENDER)

const server = await serve(examples)
const site = await serve(folder)
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

  console.log('\n# first render after warmUp()')
  for (const [file, name] of FILES) {
    for (const backend of ['auto', 'webgpu']) {
      const label = `${name}, '${backend}': a keyer made as warmUp() resolves draws from its first render`
      let found
      try {
        const page = await browser.newPage(`${site.url}/first-render.html?file=${file}&backend=${backend}`)
        found = await page.evaluate('window.firstRender')
      } catch (error) {
        found = { error: error instanceof Error ? error.message : String(error) }
      }
      if (found.unavailable) {
        console.log(`  – ${label}  (${found.unavailable})`)
        continue
      }
      const drew = !found.error && found.backend === found.chosen && found.drew
      const detail = found.error ?? `${found.chosen}: ${found.backend ?? 'no backend'} at once, and the first render ${found.drew ? 'drew' : 'drew nothing'}`
      expect(label, drew, detail)
    }
  }
} finally {
  await browser.close()
  await site.close()
  await server.close()
  await rm(folder, { recursive: true, force: true })
}

console.log(failed ? `\n${failed} failed` : '\nAll passed')
process.exitCode = failed ? 1 : 0
