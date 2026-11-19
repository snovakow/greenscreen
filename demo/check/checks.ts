import { DEFAULT_SETTINGS, Greenscreen, KEY_COLORS, warmUp } from '@snovakow/greenscreen'
import type { BackendName, Point, Settings } from '@snovakow/greenscreen'
import { assert, check, random, Skip } from './harness.ts'
import type { Report, Subject } from './harness.ts'
import {
  blockCentre,
  COLOURS,
  otherPicture,
  picture,
  recordedVideo,
  rgbaOf,
  testPicture,
  toCanvas,
  toImage,
  toVideo,
  widePicture,
} from './pictures.ts'
import { compare, delay, frames, pixel, readKeyed, same } from './read.ts'
import { reference } from './reference.ts'

// How far a channel may be from the reference, out of 255: the shader's single precision, rounding to 8 bits, and the
// readback's own rounding
const TOLERANCE = 2
const SWEEP = 24

// Colours far enough from green that the default key must leave them as they are
const KEPT = ['red', 'skin', 'white', 'black', 'grey', 'screen blue', 'purple', 'orange', 'pink', 'magenta']

function full(settings: Partial<Settings>): Settings {
  return { ...DEFAULT_SETTINGS, ...settings }
}

// A convex cut with a corner in each corner of the picture
function randomQuad(next: () => number): Point[] {
  const r = () => next() * 0.3
  return [
    { x: r(), y: r() },
    { x: 1 - r(), y: r() },
    { x: 1 - r(), y: 1 - r() },
    { x: r(), y: 1 - r() },
  ]
}

function randomColour(next: () => number) {
  return (Math.floor(next() * 256) << 16) | (Math.floor(next() * 256) << 8) | Math.floor(next() * 256)
}

export function randomSettings(next: () => number): Partial<Settings> {
  const keys = [KEY_COLORS.green, 0x28be3c, KEY_COLORS.blue, 0x1e46d2, KEY_COLORS.magenta, randomColour(next)]
  return {
    key: next() < 0.85,
    keyColor: keys[Math.floor(next() * keys.length)],
    similarity: 0.15 + next() * 0.6,
    smoothness: 0.02 + next() * 0.3,
    spill: next() * 0.5,
    flip: next() < 0.5,
    crop: next() < 0.5,
    corners: randomQuad(next),
    opacity: 0.3 + next() * 0.7,
    tint: next() < 0.5 ? 0xffffff : randomColour(next) | 0x808080,
    saturation: next() * 2,
    brightness: (next() - 0.5) * 0.6,
    contrast: (next() - 0.5) * 1.2,
    gamma: (next() - 0.5) * 1.6,
  }
}

// Resolves once test passes, or after timeout ms, whichever is first
async function until(test: () => boolean, timeout: number) {
  const started = performance.now()
  while (!test() && performance.now() - started < timeout) await delay(20)
}

// The widest picture the backend should take here: the largest texture the WebGPU adapter offers, or WebGL2's largest
// texture and viewport, from a context of its own that's let go of at once
async function textureLimit(backend: BackendName): Promise<number> {
  if (backend === 'webgpu') {
    const adapter = navigator.gpu ? await navigator.gpu.requestAdapter() : null
    if (!adapter) throw new Skip('there is no WebGPU adapter here')
    return adapter.limits.maxTextureDimension2D
  }
  const gl = document.createElement('canvas').getContext('webgl2')
  if (!gl) throw new Skip('there is no WebGL2 here')
  try {
    const viewport: unknown = gl.getParameter(gl.MAX_VIEWPORT_DIMS)
    if (!(viewport instanceof Int32Array)) throw new Error('WebGL2 gave no viewport size')
    return Math.min(Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)), viewport[0], viewport[1])
  } finally {
    gl.getExtension('WEBGL_lose_context')?.loseContext()
  }
}

// What every way of keying must do: key the key out and keep the rest, and match the reference over the defaults and
// a sweep of settings, flipped and cut among them
export async function keyingChecks(report: Report, subject: Subject): Promise<void> {
  const group = subject.group
  const reason = await subject.unavailable()
  if (reason) {
    report({ group, name: 'Runs here', status: 'skip', detail: reason })
    return
  }
  const source = toCanvas(testPicture())
  const input = picture(source)
  const { width } = input
  const tolerance = subject.tolerance ?? TOLERANCE

  const run = async (settings: Partial<Settings>) => {
    const keyed = await subject.key(source, settings)
    assert(keyed.width === input.width && keyed.height === input.height, `drew ${keyed.width}×${keyed.height}`)
    return readKeyed(keyed.canvas, keyed.width, keyed.height)
  }

  try {
    await check(report, group, 'Keys out green and keeps other colours', async () => {
      const read = await run({})
      // The key, and a screen as a camera sees it, down to the dim, cool-lit edge the default similarity is set for
      for (const name of ['key green', 'screen green', 'shadow green', 'dim screen green']) {
        const [x, y] = blockCentre(name)
        const alpha = pixel(read, width, x, y)[3]
        assert(alpha <= 1, `${name} kept, alpha ${alpha}`)
      }
      for (const name of KEPT) {
        const [x, y] = blockCentre(name)
        const got = pixel(read, width, x, y)
        const want = COLOURS.find((colour) => colour.name === name)?.rgba ?? []
        const off = Math.max(...got.map((value, c) => Math.abs(value - want[c])))
        assert(off <= tolerance, `${name} came out ${got.join(',')}, not ${want.join(',')}`)
      }
    })

    await check(report, group, 'Matches the reference, default settings', async () => {
      const result = compare(await run({}), reference(input, full({}), subject.filter), width, tolerance)
      assert(result.over === 0, `${result.over} pixels off: ${result.detail}`)
      return `worst ${result.worst.toFixed(1)}`
    })

    await check(report, group, 'Mirrors with flip, and cuts with crop', async () => {
      const settings = { flip: true, crop: true, corners: [
        { x: 0.1, y: 0.05 },
        { x: 0.8, y: 0.2 },
        { x: 0.9, y: 0.9 },
        { x: 0.2, y: 0.7 },
      ] }
      const read = await run(settings)
      const result = compare(read, reference(input, full(settings), subject.filter), width, tolerance)
      assert(result.over === 0, `${result.over} pixels off: ${result.detail}`)
      assert(pixel(read, width, 0, 0)[3] === 0, 'the corner outside the cut was kept')
      // Yellow is inside the cut, and flipped it's as far from the right as it was from the left
      const [yx, yy] = blockCentre('yellow')
      const got = pixel(read, width, width - 1 - yx, yy)
      assert(got[0] > 200 && got[1] > 200 && got[2] < 80 && got[3] === 255, `yellow didn't mirror: ${got.join(',')}`)
    })

    await check(report, group, `Matches the reference over ${SWEEP} random settings`, async () => {
      const next = random(2026)
      let worst = 0
      for (let i = 0; i < SWEEP; i++) {
        const settings = randomSettings(next)
        const result = compare(await run(settings), reference(input, full(settings), subject.filter), width, tolerance)
        worst = Math.max(worst, result.worst)
        assert(result.over === 0, `settings ${i}: ${result.over} pixels off: ${result.detail}\n${JSON.stringify(settings)}`)
      }
      return `worst ${worst.toFixed(1)}`
    })
  } finally {
    subject.dispose()
  }
}

export function coreSubject(backend: BackendName): Subject {
  let keyer: Greenscreen | null = null
  return {
    group: backend === 'webgl' ? 'Core on WebGL2' : 'Core on WebGPU',
    async unavailable() {
      try {
        await warmUp(backend)
        return null
      } catch (error) {
        return error instanceof Error ? error.message : String(error)
      }
    },
    async key(source, settings) {
      keyer ??= new Greenscreen(null, { backend })
      await keyer.initialized
      keyer.source = source
      keyer.set(full(settings))
      keyer.invalidate()
      assert(keyer.render(), 'render() drew nothing')
      return { canvas: keyer.canvas, width: keyer.canvas.width, height: keyer.canvas.height }
    },
    dispose() {
      keyer?.dispose()
    },
  }
}

// What the core keyer does on each backend, beyond keying: every kind of source, keeping its picture, drawing only
// when there's something new, a source changing size, a lost context and dispose
export async function coreChecks(report: Report, backend: BackendName): Promise<void> {
  const group = backend === 'webgl' ? 'Core on WebGL2' : 'Core on WebGPU'
  try {
    await warmUp(backend)
  } catch {
    return
  }
  const image = testPicture()
  const source = toCanvas(image)
  const input = picture(source)
  const { width, height } = input
  const expected = reference(input, DEFAULT_SETTINGS)

  const make = async (from: ConstructorParameters<typeof Greenscreen>[0] = null) => {
    const keyer = new Greenscreen(from, { backend })
    await keyer.initialized
    return keyer
  }

  const keyAndCompare = async (from: ConstructorParameters<typeof Greenscreen>[0], tolerance = TOLERANCE) => {
    const keyer = await make(from)
    try {
      assert(keyer.render(), 'render() drew nothing')
      const read = readKeyed(keyer.canvas, keyer.canvas.width, keyer.canvas.height)
      return compare(read, expected, width, tolerance)
    } finally {
      keyer.dispose()
    }
  }

  await check(report, group, 'Keys a canvas, ImageData, an image and ImageBitmaps', async () => {
    const found: string[] = []
    const sources: [string, Parameters<typeof keyAndCompare>[0]][] = [
      ['ImageData', input],
      ['image', await toImage(source)],
      ['ImageBitmap', await createImageBitmap(input, { premultiplyAlpha: 'none' })],
    ]
    for (const [name, from] of sources) {
      const result = await keyAndCompare(from)
      assert(result.over === 0, `${name}: ${result.over} pixels off: ${result.detail}`)
      found.push(`${name} ${result.worst.toFixed(1)}`)
    }
    return found.join(', ')
  })

  await check(report, group, 'Keys an ImageBitmap made premultiplied', async () => {
    const bitmap = await createImageBitmap(input)
    const result = await keyAndCompare(bitmap)
    assert(result.over === 0, `${result.over} pixels off: ${result.detail}`)
    return `worst ${result.worst.toFixed(1)}`
  })

  await check(report, group, 'Keys a VideoFrame', async () => {
    if (typeof VideoFrame === 'undefined') throw new Skip('VideoFrame is not available')
    const frame = new VideoFrame(source, { timestamp: 0 })
    try {
      const result = await keyAndCompare(frame)
      assert(result.over === 0, `${result.over} pixels off: ${result.detail}`)
      return `worst ${result.worst.toFixed(1)}`
    } finally {
      frame.close()
    }
  })

  await check(report, group, 'Keys a playing video', async () => {
    const { video, stop } = await toVideo(source)
    const keyer = await make(video)
    try {
      await frames(2)
      assert(keyer.render(), 'render() drew nothing')
      const read = readKeyed(keyer.canvas, keyer.canvas.width, keyer.canvas.height)
      // A video has no transparency and its colour is coded, so only its opaque blocks are looked at, more loosely
      const [kx, ky] = blockCentre('key green')
      assert(pixel(read, width, kx, ky)[3] <= 8, `green kept: ${pixel(read, width, kx, ky).join(',')}`)
      for (const name of ['red', 'white', 'screen blue', 'black']) {
        const [x, y] = blockCentre(name)
        const got = pixel(read, width, x, y)
        const want = COLOURS.find((colour) => colour.name === name)?.rgba ?? []
        const off = Math.max(...got.map((value, c) => Math.abs(value - want[c])))
        assert(off <= 16, `${name} came out ${got.join(',')}`)
      }
      // And it takes new frames as they come
      const before = keyer.frame
      await frames(10)
      keyer.render()
      await frames(10)
      keyer.render()
      assert(keyer.frame > before, 'no new frame was drawn')
    } finally {
      keyer.dispose()
      stop()
    }
  })

  await check(report, group, 'Keeps its picture after it is drawn', async () => {
    const keyer = await make(source)
    try {
      assert(keyer.render(), 'render() drew nothing')
      const now = readKeyed(keyer.canvas, width, height)
      await frames(3)
      await delay(100)
      const later = readKeyed(keyer.canvas, width, height)
      const worst = same(now, later, 0)
      assert(worst < 0, `the canvas changed by up to ${worst} once drawn`)
      const result = compare(later, expected, width, TOLERANCE)
      assert(result.over === 0, `${result.over} pixels off: ${result.detail}`)
    } finally {
      keyer.dispose()
    }
  })

  await check(report, group, 'Keeps its picture on the page', async () => {
    const keyer = await make(source)
    // In view, so the browser draws it with the page
    keyer.canvas.style.cssText = 'position: fixed; left: 0; top: 0'
    document.body.append(keyer.canvas)
    try {
      assert(keyer.render(), 'render() drew nothing')
      await frames(3)
      await delay(100)
      const result = compare(readKeyed(keyer.canvas, width, height), expected, width, TOLERANCE)
      assert(result.over === 0, `${result.over} pixels off once the page was drawn: ${result.detail}`)
    } finally {
      keyer.canvas.remove()
      keyer.dispose()
    }
  })

  await check(report, group, 'Keys a recorded video in the colours a 2D canvas reads', async () => {
    // At this similarity, each of the picture's colours is either taken out or kept whole. In the fade between them, a
    // level's difference in how the video is read moves alpha by many levels, and this check is of the colours read
    const settings = { similarity: 0.5 }
    const video = await recordedVideo(source)
    const keyer = await make(video)
    try {
      keyer.set(settings)
      await until(() => keyer.render(), 1000)
      assert(keyer.ready, 'render() drew nothing')
      // The reference keys the frame as a 2D canvas reads it, as an eyedropper would. Each block is looked at in its
      // middle, away from its edges, where video codes colour at half the size
      const frame = document.createElement('canvas')
      frame.width = width
      frame.height = height
      frame.getContext('2d')?.drawImage(video, 0, 0)
      const want = reference(picture(frame), full(settings))
      const read = readKeyed(keyer.canvas, width, height)
      let worst = 0
      let where = ''
      for (const { name } of COLOURS) {
        const [x, y] = blockCentre(name)
        const got = pixel(read, width, x, y)
        const i = (y * width + x) * 4
        const should = Array.from(want.subarray(i, i + 4), (value) => Math.round(value * 255))
        const off = Math.max(...got.map((value, c) => Math.abs(value - should[c])))
        if (off > worst) {
          worst = off
          where = `${name}: ${got.join(',')}, not ${should.join(',')}`
        }
      }
      assert(worst <= TOLERANCE, `off by ${worst} at ${where}`)
      return `worst ${worst}`
    } finally {
      keyer.dispose()
      URL.revokeObjectURL(video.src)
    }
  })

  await check(report, group, 'Draws from its first render once warmUp() has resolved', async () => {
    await warmUp(backend)
    // Rendered in the task that makes it, with no wait for its backend
    const keyer = new Greenscreen(source, { backend })
    try {
      assert(keyer.backend === backend, 'it had no backend at once')
      assert(keyer.render(), 'its first render drew nothing')
      const result = compare(readKeyed(keyer.canvas, width, height), expected, width, TOLERANCE)
      assert(result.over === 0, `${result.over} pixels off: ${result.detail}`)
    } finally {
      keyer.dispose()
    }
  })

  await check(report, group, 'Draws only when something has changed', async () => {
    const bitmap = await createImageBitmap(input, { premultiplyAlpha: 'none' })
    const keyer = await make(bitmap)
    try {
      // Read through a function, as TypeScript would otherwise take each assertion as fixing the frame for good
      const frame = () => keyer.frame
      assert(keyer.render() && frame() === 1, `first render: frame ${frame()}`)
      keyer.render()
      keyer.render()
      assert(frame() === 1, `drew again with nothing new: frame ${frame()}`)
      keyer.set({ similarity: DEFAULT_SETTINGS.similarity })
      keyer.render()
      assert(frame() === 1, `drew again for a setting that didn't change: frame ${frame()}`)
      keyer.set({ similarity: 0.3 })
      keyer.render()
      assert(frame() === 2, `didn't draw a changed setting: frame ${frame()}`)
      keyer.invalidate()
      keyer.render()
      assert(frame() === 3, `didn't draw after invalidate(): frame ${frame()}`)
    } finally {
      keyer.dispose()
    }
  })

  await check(report, group, 'Follows its source to a new picture and size', async () => {
    const keyer = await make(source)
    try {
      assert(keyer.render(), 'render() drew nothing')
      const other = toCanvas(otherPicture())
      keyer.source = other
      assert(!keyer.ready, 'still ready with a new source not yet drawn')
      assert(keyer.render(), 'render() drew nothing for the new source')
      const otherInput = picture(other)
      assert(
        keyer.canvas.width === otherInput.width && keyer.canvas.height === otherInput.height,
        `canvas is ${keyer.canvas.width}×${keyer.canvas.height}`,
      )
      const read = readKeyed(keyer.canvas, otherInput.width, otherInput.height)
      const result = compare(read, reference(otherInput, DEFAULT_SETTINGS), otherInput.width, TOLERANCE)
      assert(result.over === 0, `${result.over} pixels off: ${result.detail}`)
    } finally {
      keyer.dispose()
    }
  })

  // As wide as the GPU's textures go, which is past the 8192 pixels a WebGPU device takes unless it asks for more, on a
  // GPU that goes further. A picture wider still is refused, and the keyer isn't ready, rather than ready with nothing
  await check(report, group, 'Keys a picture as wide as its textures go, and refuses a wider one', async () => {
    const limit = await textureLimit(backend)
    const widest = await make(toCanvas(widePicture(limit)))
    try {
      assert(widest.render(), `render() drew nothing for a picture ${limit} wide`)
      const { width: drawn, height: tall } = widest.canvas
      assert(drawn === limit, `drew ${drawn}×${tall} of a picture ${limit} wide`)
      const read = readKeyed(widest.canvas, drawn, tall)
      const left = pixel(read, drawn, 2, 2)
      assert(left[3] <= 1, `green kept, alpha ${left[3]}`)
      const right = pixel(read, drawn, drawn - 3, 2)
      const red = rgbaOf('red')
      const off = Math.max(...right.map((value, c) => Math.abs(value - red[c])))
      assert(off <= TOLERANCE, `red came out ${right.join(',')}`)
    } finally {
      widest.dispose()
    }
    const wider = await make(toCanvas(widePicture(limit + 1)))
    try {
      assert(!wider.render() && !wider.ready && wider.frame === 0, `drew a picture ${limit + 1} wide`)
    } finally {
      wider.dispose()
    }
    return `${limit} wide`
  })

  await check(report, group, 'Copies its settings and checks them', async () => {
    const corners = [
      { x: 0.1, y: 0.1 },
      { x: 0.9, y: 0.1 },
      { x: 0.9, y: 0.9 },
      { x: 0.1, y: 0.9 },
    ]
    const keyer = await make(source)
    try {
      keyer.set({ corners })
      const held = keyer.settings
      corners[0].x = 0.5
      assert(keyer.settings.corners[0].x === 0.1, 'a corner changed with the array it was given')
      keyer.set({ similarity: 0.2 })
      assert(held.similarity === DEFAULT_SETTINGS.similarity, 'a settings object held changed')
      assert(Object.isFrozen(keyer.settings), 'the settings are not frozen')
      for (const bad of [{ similarity: Number.NaN }, { keyColor: -1 }, { key: 1 }, { corners: [{ x: 0, y: 0 }] }]) {
        let threw = false
        try {
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- wrong on purpose
          keyer.set(bad as unknown as Partial<Settings>)
        } catch (error) {
          threw = error instanceof TypeError
        }
        assert(threw, `${JSON.stringify(bad)} was taken`)
      }
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- an unknown name on purpose
      keyer.set({ similarity: 5, unknown: 1 } as unknown as Partial<Settings>)
      assert(keyer.settings.similarity === 1, `similarity 5 came out ${keyer.settings.similarity}`)
    } finally {
      keyer.dispose()
    }
  })

  await check(report, group, 'Comes back after its context is lost', async () => {
    if (backend !== 'webgl') throw new Skip('WebGL only')
    let lost = 0
    let restored = 0
    const keyer = new Greenscreen(source, { backend, onLost: () => (lost += 1), onRestored: () => (restored += 1) })
    try {
      assert(keyer.render(), 'render() drew nothing')
      const context = keyer.canvas.getContext('webgl2')
      const extension = context?.getExtension('WEBGL_lose_context')
      if (!extension) throw new Skip('WEBGL_lose_context is not available')
      extension.loseContext()
      await delay(50)
      assert(lost === 1 && !keyer.ready && !keyer.render(), `lost ${lost}, ready ${keyer.ready}`)
      extension.restoreContext()
      await delay(100)
      assert(restored === 1, `restored ${restored}`)
      assert(keyer.render(), 'render() drew nothing once restored')
      const result = compare(readKeyed(keyer.canvas, width, height), expected, width, TOLERANCE)
      assert(result.over === 0, `${result.over} pixels off: ${result.detail}`)
    } finally {
      keyer.dispose()
    }
  })

  await check(report, group, 'Draws nothing once disposed', async () => {
    const keyer = await make(source)
    keyer.render()
    keyer.dispose()
    assert(!keyer.ready && !keyer.render(), 'still drawing')
    keyer.dispose()
  })

  if (backend === 'webgpu') {
    await check(report, group, 'Comes back after its device is lost', async () => {
      const { requestDevice } = await import('../../src/webgpu.ts')
      let lost = 0
      let restored = 0
      const keyer = new Greenscreen(source, { backend, onLost: () => (lost += 1), onRestored: () => (restored += 1) })
      try {
        await keyer.initialized
        assert(keyer.render(), 'render() drew nothing')
        ;(await requestDevice()).destroy()
        await until(() => restored > 0, 1000)
        assert(lost === 1 && restored === 1, `lost ${lost}, restored ${restored}`)
        assert(keyer.render(), 'render() drew nothing on the new device')
        const result = compare(readKeyed(keyer.canvas, width, height), expected, width, TOLERANCE)
        assert(result.over === 0, `${result.over} pixels off: ${result.detail}`)
      } finally {
        keyer.dispose()
      }
    })

    await check(report, group, 'Keys 24 sources at once on one device', async () => {
      const keyers = await Promise.all(Array.from({ length: 24 }, () => make(source)))
      try {
        for (const keyer of keyers) assert(keyer.render(), 'render() drew nothing')
        for (const keyer of keyers) {
          const result = compare(readKeyed(keyer.canvas, width, height), expected, width, TOLERANCE)
          assert(result.over === 0, `${result.over} pixels off: ${result.detail}`)
        }
      } finally {
        for (const keyer of keyers) keyer.dispose()
      }
    })
  }
}

// What doesn't depend on the backend
export async function apiChecks(report: Report): Promise<void> {
  const group = 'Choosing a backend'
  await check(report, group, "'auto' chooses WebGPU on the GPU, and WebGL2 otherwise", async () => {
    // What it should come to, by the adapter this page is offered. A fallback adapter runs WebGPU on the CPU
    const adapter = navigator.gpu ? await navigator.gpu.requestAdapter() : null
    const expected: BackendName = adapter && !adapter.info.isFallbackAdapter ? 'webgpu' : 'webgl'
    const first = new Greenscreen()
    try {
      const chosen = await first.initialized
      assert(chosen === expected && first.backend === expected, `chose ${chosen}, not ${expected}`)
      assert((await warmUp()) === expected, 'warmUp() came to something else')
    } finally {
      first.dispose()
    }
    // Once warmUp() has resolved, a keyer has its backend at once, and draws from its first render in the same task
    const still = document.createElement('canvas')
    still.width = 4
    still.height = 4
    still.getContext('2d')?.fillRect(0, 0, 4, 4)
    const next = new Greenscreen(still)
    try {
      assert(next.backend === expected, 'a keyer made after warmUp() had no backend at once')
      assert(next.render(), 'its first render drew nothing')
      assert((await next.initialized) === expected, 'a second keyer chose differently')
    } finally {
      next.dispose()
    }
    const info = adapter?.info
    return `${expected}, for ${info ? `${info.vendor} ${info.architecture}${info.isFallbackAdapter ? ', a fallback adapter' : ''}` : 'no WebGPU adapter'}`
  })
  await check(report, group, 'An unknown backend rejects', async () => {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- not a backend, on purpose
    const keyer = new Greenscreen(null, { backend: 'vulkan' as BackendName })
    let rejected = false
    await keyer.initialized.catch(() => (rejected = true))
    assert(rejected && keyer.backend === null && !keyer.render(), 'it was taken')
    keyer.dispose()
  })
}
