// The demo app, driven in headless Chrome with a fake camera: the picture keyed, then Flip, Pick key, Edit crop with a
// drag of a corner, and Reset, each read back from the keyed canvas. Serves the demo's build, or with --dev its Vite
// server. Exits 1 if a step fails
//   node test/demo.mjs [--dev]
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { HEIGHT, SQUARE, WIDTH, writeCamera } from './camera.mjs'
import { launch } from './chrome.mjs'
import { serve } from './serve.mjs'

const folder = await mkdtemp(join(tmpdir(), 'greenscreen-camera-'))
const camera = join(folder, 'camera.y4m')
await writeCamera(camera)

let server
if (process.argv.includes('--dev')) {
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

const browser = await launch({
  flags: [
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    `--use-file-for-fake-video-capture=${camera}`,
    '--enable-unsafe-swiftshader',
  ],
})

// Reads pixels from the keyed canvas as r, g, b, alpha, unpremultiplied as getImageData gives them
const READ = `(points) => {
  const source = document.querySelector('.picture canvas')
  if (!source || source.width < 2) return null
  const canvas = document.createElement('canvas')
  canvas.width = source.width
  canvas.height = source.height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  context.drawImage(source, 0, 0)
  return { width: source.width, height: source.height,
    pixels: points.map(([x, y]) => Array.from(context.getImageData(x, y, 1, 1).data)) }
}`

// A point in each region: the green half, the blue half, and the red square, and a point in the blue at the top that
// the cut takes out once its top-left corner is dragged in
const POINTS = { green: [100, 240], blue: [540, 100], red: [320, 240], cutOut: [340, 20] }

let failed = 0
function expect(name, condition, detail) {
  console.log(`  ${condition ? '✓' : '✗'} ${name}${detail ? `  (${detail})` : ''}`)
  if (!condition) failed += 1
}

try {
  const page = await browser.newPage(`${server.url}/`)
  const read = async () => {
    const names = Object.keys(POINTS)
    const result = await page.evaluate(`(${READ})(${JSON.stringify(Object.values(POINTS))})`)
    if (!result) return null
    return { ...result, at: Object.fromEntries(names.map((name, i) => [name, result.pixels[i]])) }
  }
  const until = async (test, timeout = 5000) => {
    const started = Date.now()
    let last
    while (Date.now() - started < timeout) {
      last = await read()
      if (last && test(last.at)) return last
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    return last
  }
  // Clicks a lil-gui control by its name
  const control = (name) =>
    page.evaluate(`(() => {
      const controller = [...document.querySelectorAll('.lil-gui .lil-controller')]
        .find((element) => element.querySelector('.lil-name')?.textContent === ${JSON.stringify(name)})
      if (!controller) return false
      const target = controller.querySelector('input[type=checkbox], button') ?? controller
      target.click()
      return true
    })()`)
  const box = (selector) =>
    page.evaluate(`(() => {
      const rect = document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect()
      return rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null
    })()`)
  const mouse = async (type, x, y) => {
    await page.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 })
  }
  const show = (pixel) => pixel?.join(',')

  console.log('\n# demo')
  const first = await until((at) => at.green[3] === 0 && at.blue[3] === 255)
  expect('keys the camera at its own size', first?.width === WIDTH && first?.height === HEIGHT, `${first?.width}×${first?.height}`)
  // Which backend 'auto' came to, from the kind of context the keyed canvas has: WebGPU's shows its picture through a
  // 2D one. It should be WebGPU where there's a hardware adapter
  const backend = await page.evaluate(`(async () => {
    const drawn = document.querySelector('.picture canvas')?.getContext('webgl2') ? 'webgl' : 'webgpu'
    const adapter = navigator.gpu ? await navigator.gpu.requestAdapter() : null
    return { drawn, wanted: adapter && !adapter.info.isFallbackAdapter ? 'webgpu' : 'webgl' }
  })()`)
  expect(`keys it on the backend 'auto' should choose`, backend.drawn === backend.wanted, backend.drawn)
  expect('green keyed out', first?.at.green[3] === 0, show(first?.at.green))
  expect('blue kept', first?.at.blue[3] === 255 && first.at.blue[2] > 180, show(first?.at.blue))
  expect('red kept', first?.at.red[3] === 255 && first.at.red[0] > 180, show(first?.at.red))

  await control('Flip')
  const flipped = await until((at) => at.green[3] === 255)
  expect('Flip mirrors it: blue on the left', flipped?.at.green[3] === 255 && flipped.at.green[2] > 180, show(flipped?.at.green))
  await control('Flip')
  await until((at) => at.green[3] === 0)

  // Pick key, then a click on the preview's blue
  await control('Pick key')
  await new Promise((resolve) => setTimeout(resolve, 300))
  const preview = await box('.preview video')
  expect('Pick key enlarges the preview', preview && preview.width > 300, preview && `${Math.round(preview.width)} wide`)
  if (preview) {
    const x = preview.x + preview.width * 0.85
    const y = preview.y + preview.height * 0.2
    await mouse('mousePressed', x, y)
    await mouse('mouseReleased', x, y)
  }
  const picked = await until((at) => at.blue[3] === 0)
  expect('picking blue keys blue out', picked?.at.blue[3] === 0, show(picked?.at.blue))
  expect('and keeps green', picked?.at.green[3] === 255, show(picked?.at.green))
  await page.evaluate(`document.querySelector('.done')?.click()`)

  // Edit crop, and the top-left corner dragged to the middle of the picture's top-left quarter
  await control('Reset')
  await until((at) => at.green[3] === 0 && at.blue[3] === 255)
  await control('Edit crop')
  await new Promise((resolve) => setTimeout(resolve, 300))
  const overlay = await box('.overlay')
  expect('Edit crop puts the handles up', Boolean(overlay), overlay && `${Math.round(overlay.width)} wide`)
  if (overlay) {
    const from = [overlay.x + 2, overlay.y + 2]
    const to = [overlay.x + overlay.width * 0.25, overlay.y + overlay.height * 0.25]
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from[0], y: from[1] })
    await mouse('mousePressed', ...from)
    for (let step = 1; step <= 10; step++) {
      const x = from[0] + ((to[0] - from[0]) * step) / 10
      const y = from[1] + ((to[1] - from[1]) * step) / 10
      await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left', buttons: 1 })
    }
    await mouse('mouseReleased', ...to)
  }
  // The blue near the top's middle is outside the cut now; the blue further down on the right is still inside
  const cut = await until((at) => at.cutOut[3] === 0 && at.blue[3] === 255)
  expect('dragging a corner cuts the picture', cut?.at.cutOut[3] === 0, show(cut?.at.cutOut))
  expect('and keeps what is inside the cut', cut?.at.blue[3] === 255, show(cut?.at.blue))
  expect('the square is still there', cut?.at.red[3] === 255, `${show(cut?.at.red)} at ${SQUARE.left}..${SQUARE.right}`)

  // Crop turned off puts the handles down and shows the whole picture again
  await control('Crop')
  await new Promise((resolve) => setTimeout(resolve, 300))
  const uncut = await until((at) => at.cutOut[3] === 255)
  expect('Crop off shows the whole picture', uncut?.at.cutOut[3] === 255, show(uncut?.at.cutOut))
  expect('and puts the handles down', !(await box('.overlay')), '')

  // Escape puts a tool down
  await control('Pick key')
  await new Promise((resolve) => setTimeout(resolve, 200))
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await new Promise((resolve) => setTimeout(resolve, 300))
  const small = await box('.preview video')
  expect('Escape puts the eyedropper down', small && small.width <= 161, small && `${Math.round(small.width)} wide`)

  await control('Reset')
  const reset = await until((at) => at.green[3] === 0 && at.blue[3] === 255)
  expect('Reset puts it back', reset?.at.green[3] === 0 && reset?.at.blue[3] === 255, show(reset?.at.blue))

  const problems = page.messages.filter((message) => /^\[(error|exception|warning)\]/.test(message))
  expect('no errors or warnings on the page', problems.length === 0, problems.join(' | '))
} finally {
  await browser.close()
  await server.close()
  await rm(folder, { recursive: true, force: true })
}

console.log(failed ? `\n${failed} failed` : '\nAll passed')
process.exitCode = failed ? 1 : 0
