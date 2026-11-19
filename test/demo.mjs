// The demo app, driven in headless Chrome with a fake camera: the picture keyed, then Flip, Pick key, Edit crop with a
// drag of a corner, and Reset. Then a picture opened with File, one too wide to key, a video dropped on the page, the
// camera back with Camera, and a file that won't play. Each is read back from the keyed canvas. Serves the demo's
// build, or with --dev its Vite server. Exits 1 if a step fails
//   node test/demo.mjs [--dev]
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BLUE, GREEN, HEIGHT, SQUARE, WIDTH, writeCamera } from './camera.mjs'
import { launch } from './chrome.mjs'
import { PICTURE, writePicture } from './picture.mjs'
import { serve } from './serve.mjs'

const folder = await mkdtemp(join(tmpdir(), 'greenscreen-camera-'))
const camera = join(folder, 'camera.y4m')
await writeCamera(camera)
const pictureFile = join(folder, 'picture.png')
await writePicture(pictureFile)
const brokenFile = join(folder, 'broken.mp4')
await writeFile(brokenFile, 'Not a video')

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

// How long the first keyed picture may take: Vite's dev server can take seconds to serve the page, and the fake camera
// seconds more to start. Later steps wait the usual 5 s
const STARTUP = 20_000

// A point in each region: the green half, the blue half, and the red square, and a point in the blue at the top that
// the cut takes out once its top-left corner is dragged in
const POINTS = { green: [100, 240], blue: [540, 100], red: [320, 240], cutOut: [340, 20] }
// A point in each half of the picture opened as a file
const PICTURE_POINTS = { blue: [50, 200], green: [150, 200] }

// A video the page records and drops on itself as a file: its top half the camera's green, its bottom half the blue
const CLIP = { width: 320, height: 240 }
const CLIP_POINTS = { top: [160, 60], bottom: [160, 180] }
// A page's first recorder can take seconds to write anything while other Chromes start, so it waits for the first of
// the video to be written, as the page of checks does
const DROP_CLIP = `(async () => {
  const canvas = document.createElement('canvas')
  canvas.width = ${CLIP.width}
  canvas.height = ${CLIP.height}
  const context = canvas.getContext('2d')
  let frame = 0
  const draw = () => {
    context.fillStyle = 'rgb(${GREEN.join(',')})'
    context.fillRect(0, 0, ${CLIP.width}, ${CLIP.height / 2})
    context.fillStyle = 'rgb(${BLUE.join(',')})'
    context.fillRect(0, ${CLIP.height / 2}, ${CLIP.width}, ${CLIP.height / 2})
    frame = requestAnimationFrame(draw)
  }
  draw()
  const stream = canvas.captureStream(30)
  const type = ['video/webm;codecs=vp8', 'video/webm'].find((kind) => MediaRecorder.isTypeSupported(kind))
  if (!type) return { error: 'no WebM recorder here' }
  const recorder = new MediaRecorder(stream, { mimeType: type })
  const chunks = []
  const wrote = new Promise((resolve) => recorder.addEventListener('dataavailable', (event) => {
    chunks.push(event.data)
    if (event.data.size > 0) resolve(true)
  }))
  const stopped = new Promise((resolve) => recorder.addEventListener('stop', resolve, { once: true }))
  recorder.start(100)
  const written = await Promise.race([wrote, new Promise((resolve) => setTimeout(resolve, 10000, false))])
  if (written) await new Promise((resolve) => setTimeout(resolve, 600))
  recorder.stop()
  await stopped
  cancelAnimationFrame(frame)
  for (const track of stream.getTracks()) track.stop()
  if (!written) return { error: 'the recorder wrote nothing in 10 s' }
  const data = new DataTransfer()
  data.items.add(new File(chunks, 'clip.webm', { type: 'video/webm' }))
  const over = new DragEvent('dragover', { dataTransfer: data, bubbles: true, cancelable: true })
  document.body.dispatchEvent(over)
  const drop = new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true })
  document.body.dispatchEvent(drop)
  return { taken: over.defaultPrevented && drop.defaultPrevented }
})()`

let failed = 0
function expect(name, condition, detail) {
  console.log(`  ${condition ? '✓' : '✗'} ${name}${detail ? `  (${detail})` : ''}`)
  if (!condition) failed += 1
}

try {
  const page = await browser.newPage(`${server.url}/`)
  const read = async (points = POINTS) => {
    const names = Object.keys(points)
    const result = await page.evaluate(`(${READ})(${JSON.stringify(Object.values(points))})`)
    if (!result) return null
    return { ...result, at: Object.fromEntries(names.map((name, i) => [name, result.pixels[i]])) }
  }
  // What get() gives, once test passes on it or the time is up
  const poll = async (get, test, timeout = 5000) => {
    const started = Date.now()
    let last
    while (Date.now() - started < timeout) {
      last = await get()
      if (test(last)) return last
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    return last
  }
  // The keyed canvas at the points, once test passes on their pixels, and on the whole read for its size
  const until = (test, points = POINTS, timeout = 5000) =>
    poll(() => read(points), (result) => Boolean(result && test(result.at, result)), timeout)
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
  // The number a lil-gui control shows, by its name
  const numberIn = async (name) =>
    Number(
      await page.evaluate(`(() => {
        const controller = [...document.querySelectorAll('.lil-gui .lil-controller')]
          .find((element) => element.querySelector('.lil-name')?.textContent === ${JSON.stringify(name)})
        return controller?.querySelector('input')?.value ?? null
      })()`),
    )
  // Types a value into a lil-gui control, or chooses it from its list, by the control's name
  const enter = (name, value) =>
    page.evaluate(`(() => {
      const controller = [...document.querySelectorAll('.lil-gui .lil-controller')]
        .find((element) => element.querySelector('.lil-name')?.textContent === ${JSON.stringify(name)})
      const field = controller?.querySelector('input, select')
      if (!field) return false
      field.value = ${JSON.stringify(String(value))}
      field.dispatchEvent(new Event('input', { bubbles: true }))
      field.dispatchEvent(new Event('change', { bubbles: true }))
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
  // Clicks one of the buttons over the preview by its name
  const previewButton = (name) =>
    page.evaluate(`(() => {
      const button = [...document.querySelectorAll('.buttons button')].find((element) => element.textContent === ${JSON.stringify(name)})
      button?.click()
      return Boolean(button)
    })()`)
  // Opens a file with File, as choosing it in the browser's file chooser would. False if File or the chooser isn't there
  const choose = async (path) => {
    const opened = page.next('Page.fileChooserOpened')
    if (!(await previewButton('File'))) return false
    const chooser = await Promise.race([opened, new Promise((resolve) => setTimeout(resolve, 5000, null))])
    if (!chooser) return false
    await page.send('DOM.setFileInputFiles', { files: [path], backendNodeId: chooser.backendNodeId })
    return true
  }

  console.log('\n# demo')
  const first = await until((at) => at.green[3] === 0 && at.blue[3] === 255, POINTS, STARTUP)
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
  const lowered = await numberIn('Similarity')
  expect('and lowers similarity to suit a picked key', lowered === 0.5, String(lowered))
  await page.evaluate(`document.querySelector('.done')?.click()`)
  // Back to a preset, the default similarity, which the presets are set for
  await enter('Key color type', 'Green')
  const preset = await numberIn('Similarity')
  expect('a preset chosen again puts it back', preset === 0.75, String(preset))

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

  // File opens a picture in place of the camera, which is let go of. The picture is twice as tall as it's wide, so the
  // small preview fits it in 160px of height, and the enlarged one is narrower than its buttons
  await page.send('Page.setInterceptFileChooserDialog', { enabled: true })
  await page.evaluate(`window.cameraStream = document.querySelector('.preview video')?.srcObject ?? null`)
  expect('File opens the file chooser', await choose(pictureFile), '')
  const opened = await until((at, { width }) => width === PICTURE.width && at.green[3] === 0, PICTURE_POINTS)
  expect(
    'and keys the picture chosen, at its own size',
    opened?.width === PICTURE.width && opened?.height === PICTURE.height,
    `${opened?.width}×${opened?.height}`,
  )
  expect('green keyed out of it', opened?.at.green[3] === 0, show(opened?.at.green))
  expect('blue kept', opened?.at.blue[3] === 255 && opened.at.blue[2] > 180, show(opened?.at.blue))
  const freed = await page.evaluate(`window.cameraStream?.getTracks().every((track) => track.readyState === 'ended') ?? false`)
  expect('the camera is let go of', freed === true, '')
  const fitted = await box('.preview .source')
  expect(
    'the small preview fits it in 160px of height',
    fitted && Math.round(fitted.width) === 80 && Math.round(fitted.height) === 160,
    fitted && `${Math.round(fitted.width)}×${Math.round(fitted.height)}`,
  )

  // Pick key, then a click on the picture's blue, with similarity set by hand first, which the pick leaves
  await enter('Similarity', 0.3)
  await control('Pick key')
  await new Promise((resolve) => setTimeout(resolve, 300))
  const tall = await box('.preview .source')
  if (tall) {
    const x = tall.x + tall.width * 0.25
    const y = tall.y + tall.height * 0.5
    await mouse('mousePressed', x, y)
    await mouse('mouseReleased', x, y)
  }
  // Camera, File and Done, side by side and all on the page, though the preview is narrower than they are
  const buttons = await page.evaluate(`[...document.querySelectorAll('.buttons button')].map((button) => {
    const rect = button.getBoundingClientRect()
    return { name: button.textContent, left: rect.left, right: rect.right, page: innerWidth }
  })`)
  const apart = buttons.every(
    (button, i) => button.left >= 0 && button.right <= button.page && (i === 0 || button.left >= buttons[i - 1].right),
  )
  expect(
    'its buttons are all on the page, apart',
    buttons.length === 3 && apart,
    `preview ${Math.round(tall?.width ?? 0)} wide: ` +
      buttons.map((button) => `${button.name} ${Math.round(button.left)}..${Math.round(button.right)}`).join(', '),
  )
  const pickedBlue = await until((at) => at.blue[3] === 0, PICTURE_POINTS)
  expect('picking the picture\'s blue keys it out', pickedBlue?.at.blue[3] === 0, show(pickedBlue?.at.blue))
  expect('and keeps its green', pickedBlue?.at.green[3] === 255, show(pickedBlue?.at.green))
  const byHand = await numberIn('Similarity')
  expect('and leaves a similarity set by hand', byHand === 0.3, String(byHand))
  await page.evaluate(`document.querySelector('.done')?.click()`)
  await control('Reset')
  const restored = await numberIn('Similarity')
  expect('Reset puts the default similarity back', restored === 0.75, String(restored))

  // A picture a pixel wider than the backend's textures go can't be keyed: the demo says so, and the keyed picture of
  // the last one is taken down rather than left up as if it were this one
  const limit = await page.evaluate(`(async () => {
    if (${JSON.stringify(backend.drawn)} === 'webgpu') {
      return (await navigator.gpu.requestAdapter()).limits.maxTextureDimension2D
    }
    const gl = document.createElement('canvas').getContext('webgl2')
    const viewport = gl.getParameter(gl.MAX_VIEWPORT_DIMS)
    const limit = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE), viewport[0], viewport[1])
    gl.getExtension('WEBGL_lose_context')?.loseContext()
    return limit
  })()`)
  const tooWideFile = join(folder, 'too-wide.png')
  await writePicture(tooWideFile, { width: limit + 1, height: 2 })
  expect('File opens a picture too wide to key', await choose(tooWideFile), `${limit + 1} wide`)
  const refused = await poll(
    () => page.evaluate(`document.querySelector('.message')?.textContent ?? ''`),
    (text) => text.startsWith("Can't key"),
  )
  expect(
    'it says it can\'t key it, and why',
    refused.startsWith("Can't key this") && refused.includes(String(limit)),
    refused,
  )
  const empty = await until((at) => at.blue[3] === 0 && at.green[3] === 0, PICTURE_POINTS)
  expect('and takes the last keyed picture down', empty?.at.blue[3] === 0, show(empty?.at.blue))

  // A video file dropped on the page plays in place of the picture, on a loop
  const dropped = await page.evaluate(DROP_CLIP, { timeout: 30_000 })
  expect('a video dropped on the page is taken', dropped?.taken === true, dropped?.error ?? '')
  const clip = await until(
    (at, { width }) => width === CLIP.width && at.top[3] === 0 && at.bottom[3] === 255,
    CLIP_POINTS,
    10_000,
  )
  expect('and keyed at its own size', clip?.width === CLIP.width && clip?.height === CLIP.height, `${clip?.width}×${clip?.height}`)
  expect('green keyed out of it', clip?.at.top[3] === 0, show(clip?.at.top))
  expect('blue kept', clip?.at.bottom[3] === 255 && clip.at.bottom[2] > 180, show(clip?.at.bottom))
  const looping = await page.evaluate(`(() => {
    const video = document.querySelector('.preview video')
    return Boolean(video && !video.paused && video.loop && video.src.startsWith('blob:'))
  })()`)
  expect('it plays on a loop', looping, '')

  // Camera brings the camera back, and the video is let go of
  await page.evaluate(`window.clip = document.querySelector('.preview video')`)
  expect('Camera is there to press', await previewButton('Camera'), '')
  const back = await until((at, { width }) => width === WIDTH && at.green[3] === 0 && at.blue[3] === 255)
  expect(
    'Camera brings the camera back',
    back?.width === WIDTH && back?.height === HEIGHT && back.at.red[3] === 255,
    `${back?.width}×${back?.height}`,
  )
  const unloaded = await page.evaluate(`Boolean(window.clip && !window.clip.isConnected && !window.clip.hasAttribute('src'))`)
  expect('and lets the video go', unloaded, '')

  // A file that won't play says so, and leaves the camera up
  await choose(brokenFile)
  const said = await poll(() => page.evaluate(`document.querySelector('.message')?.textContent ?? ''`), (text) => text !== '')
  expect('a file that won\'t play says so', said.includes('broken.mp4'), said)
  const kept = await read()
  expect(
    'and leaves the camera up',
    kept?.width === WIDTH && kept.at.green[3] === 0 && kept.at.blue[3] === 255,
    `${kept?.width}×${kept?.height}`,
  )

  const problems = page.messages.filter((message) => /^\[(error|exception|warning)\]/.test(message))
  expect('no errors or warnings on the page', problems.length === 0, problems.join(' | '))
} finally {
  await browser.close()
  await server.close()
  await rm(folder, { recursive: true, force: true })
}

console.log(failed ? `\n${failed} failed` : '\nAll passed')
process.exitCode = failed ? 1 : 0
