import { pack, PACKED_LENGTH } from './pack.ts'
import type { Renderer, RendererEvents } from './renderer.ts'
import { DEFAULT_SETTINGS, mergeSettings } from './settings.ts'
import type { Settings } from './settings.ts'
import { Feed, warnUnkeyable } from './source.ts'
import type { BackendName, Canvas, Source } from './types.ts'
import { WebGLRenderer } from './webgl.ts'
import {
  currentDevice,
  knownPreference,
  pipelineFor,
  preferredFormat,
  prefersWebGPU,
  requestDevice,
  WebGPURenderer,
} from './webgpu.ts'

// The backend to draw with: 'auto' lets the keyer choose
export type BackendChoice = 'auto' | BackendName

export interface GreenscreenOptions<C extends Canvas = HTMLCanvasElement> {
  // The canvas to draw in. It must be one no context has been taken from. Without one, the keyer makes its own: a
  // canvas element, or an OffscreenCanvas in a worker
  canvas?: C
  // 'auto' by default: WebGPU where the browser has it on the GPU, and WebGL2 elsewhere
  backend?: BackendChoice
  // The settings to start with, over the defaults
  settings?: Readonly<Partial<Settings>>
  // The graphics context or device has been lost, and the canvas no longer has a picture
  onLost?: () => void
  // It's back. The next render draws again
  onRestored?: () => void
  // The source's picture can't be keyed: it's larger than the GPU's textures, or from another site without CORS. Called
  // once for each picture that fails, with what was thrown, and the canvas is left see-through until a picture can be
  // keyed. Without it, the keyer warns in the console
  onError?: (error: unknown) => void
}

// The time between a keyer's own frames, where there are no animation frames to draw on
const FALLBACK_INTERVAL = 1000 / 60

// A chroma keyer: it takes the picture from its source and draws it, keyed, into its canvas, at the picture's own size.
// The canvas is see-through where the key and the cut take the picture out, with its colour premultiplied by its
// alpha, and it keeps its picture between renders, so it can be drawn from with drawImage, or put on the page, at any
// time. Call render() on every frame, or start() for the keyer to call it itself: it draws only when there's something
// new to draw
export class Greenscreen<C extends Canvas = HTMLCanvasElement> {
  readonly canvas: C
  // Which backend it draws with, once it has one. It rejects where the backend can't be had
  readonly initialized: Promise<BackendName>
  #renderer: Renderer | null = null
  #settings: Readonly<Settings> = DEFAULT_SETTINGS
  #packed = new Float32Array(PACKED_LENGTH)
  #scratch = new Float32Array(PACKED_LENGTH)
  #dirty = true
  #feed: Feed | null = null
  // Whether the renderer has a picture of the current source to draw
  #uploaded = false
  #ready = false
  #frame = 0
  #loop: { cancel: () => void } | null = null
  #disposed = false
  readonly #onLost?: () => void
  readonly #onRestored?: () => void
  readonly #onError: (error: unknown) => void

  constructor(source: Source | null = null, options: GreenscreenOptions<C> = {}) {
    // A canvas it makes is the default type's, or an OffscreenCanvas in a worker, which a worker's code types as C
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    this.canvas = options.canvas ?? (createCanvas() as C)
    this.#onLost = options.onLost
    this.#onRestored = options.onRestored
    this.#onError = options.onError ?? warnUnkeyable
    this.set(options.settings ?? {})
    this.source = source
    this.initialized = this.#initialize(options.backend ?? 'auto')
    // Handled here, so a keyer whose backend can't be had doesn't report it to a page that never asked
    this.initialized.catch(() => {})
  }

  // A WebGL2 keyer has its backend at once. A WebGPU one has it once the device is ready, and an 'auto' one once it's
  // known which to take, both of which warmUp() can see to before the keyer is made. The canvas isn't touched until the
  // backend is known, as a canvas can only ever have one kind of context
  #initialize(choice: BackendChoice): Promise<BackendName> {
    if (choice === 'webgl') return this.#useWebGL()
    if (choice === 'webgpu') return this.#useWebGPU()
    if (choice === 'auto') {
      const known = knownPreference()
      if (known !== null) return known ? this.#useWebGPU() : this.#useWebGL()
      return prefersWebGPU().then((webgpu) => (webgpu ? this.#useWebGPU() : this.#useWebGL()))
    }
    // Only from JavaScript, which the types don't stop
    const name: string = choice
    return Promise.reject(new TypeError(`Greenscreen: no backend called ${name}`))
  }

  #useWebGL(): Promise<BackendName> {
    if (this.#disposed) return Promise.reject(new Error('Greenscreen: disposed before its backend was ready'))
    try {
      this.#renderer = new WebGLRenderer(this.canvas, this.#events)
      return Promise.resolve('webgl')
    } catch (error) {
      return Promise.reject(error)
    }
  }

  #useWebGPU(): Promise<BackendName> {
    const start = (device: GPUDevice): BackendName => {
      if (this.#disposed) throw new Error('Greenscreen: disposed before WebGPU was ready')
      this.#renderer = new WebGPURenderer(this.canvas, device, this.#events)
      return 'webgpu'
    }
    // With the device there already, as it is once warmUp() has resolved, the keyer starts at once, and its first
    // render draws, even in the task that made it
    const device = currentDevice()
    if (!device) return requestDevice().then(start)
    try {
      return Promise.resolve(start(device))
    } catch (error) {
      return Promise.reject(error)
    }
  }

  #events: RendererEvents = {
    lost: () => {
      this.#ready = false
      this.#uploaded = false
      this.#onLost?.()
    },
    restored: () => {
      this.#feed?.invalidate()
      this.#dirty = true
      this.#onRestored?.()
    },
  }

  get backend(): BackendName | null {
    return this.#renderer?.backend ?? null
  }

  // Whether the canvas has a picture of the current source, keyed: false until the first is drawn, while the source's
  // picture can't be keyed, while the context is lost, and after dispose()
  get ready(): boolean {
    return this.#ready
  }

  // How many pictures it has drawn, for whoever draws from the canvas to tell when there's a new one
  get frame(): number {
    return this.#frame
  }

  // The settings it keys with. Each change makes a new frozen object, so one held stays as it was
  get settings(): Readonly<Settings> {
    return this.#settings
  }

  get source(): Source | null {
    return this.#feed?.source ?? null
  }

  // A new source isn't ready until its first picture is drawn
  set source(source: Source | null) {
    if (source === this.source) return
    this.#feed?.dispose()
    this.#feed = source ? new Feed(source) : null
    this.#uploaded = false
    this.#ready = false
  }

  // Changes the settings named, leaving the rest. The values are copied, corners and all, so changing the object
  // afterwards changes nothing until it's given again
  set(patch: Readonly<Partial<Settings>>): void {
    this.#settings = mergeSettings(this.#settings, patch)
    const packed = pack(this.#settings, this.#scratch)
    if (packed.some((value, i) => value !== this.#packed[i])) {
      this.#scratch = this.#packed
      this.#packed = packed
      this.#dirty = true
    }
  }

  // Back to the defaults
  reset(): void {
    this.set(DEFAULT_SETTINGS)
  }

  // Takes the source's picture again on the next render. Needed only for a still source whose pixels change: an
  // ImageBitmap, ImageData or VideoFrame. Videos, images and canvases are watched
  invalidate(): void {
    this.#feed?.invalidate()
  }

  // Draws the source keyed, if there's something new to draw: a new picture from it, or new settings. Cheap when
  // there's nothing new. Returns whether the canvas has a picture of the source
  render(): boolean {
    const renderer = this.#renderer
    const feed = this.#feed
    if (this.#disposed || !renderer || renderer.lost || !feed) return false
    let draw = this.#dirty
    if (feed.hasPicture() && feed.changed()) {
      const [width, height] = feed.size()
      try {
        renderer.upload(feed.source, width, height)
        feed.taken()
        this.#uploaded = true
        draw = true
      } catch (error) {
        // Nothing is drawn until a picture can be taken, so the canvas doesn't show another source's picture, or an
        // older one of this source's, as if it were this one. The handler is called last, so one that disposes the
        // keyer or gives it another source finds it settled
        this.#uploaded = false
        this.#ready = false
        if (feed.failed()) {
          renderer.clear()
          this.#onError(error)
        }
        return false
      }
    }
    if (!this.#uploaded || !draw) return this.#ready
    renderer.draw(this.#packed)
    this.#dirty = false
    this.#ready = true
    this.#frame += 1
    return true
  }

  // Renders on every animation frame until stop()
  start(): void {
    if (this.#loop || this.#disposed) return
    let handle = 0
    const step = () => {
      handle = schedule(step)
      this.render()
    }
    handle = schedule(step)
    this.#loop = { cancel: () => unschedule(handle) }
  }

  stop(): void {
    this.#loop?.cancel()
    this.#loop = null
  }

  // Frees the context or device's resources at once. The keyer draws no more, and its canvas can't be used again
  dispose(): void {
    if (this.#disposed) return
    this.stop()
    this.#disposed = true
    this.#feed?.dispose()
    this.#feed = null
    this.#renderer?.dispose()
    this.#renderer = null
    this.#ready = false
  }
}

// Gets the backend ready before the first keyer needs it: for 'auto', which backend it is, and for WebGPU, the device
// and the pipeline, so a keyer made afterwards draws from its first render. Resolves with the backend that 'auto' or the
// choice comes to. 'auto' always comes to one; WebGPU asked for by name rejects where it can't be had
export async function warmUp(backend: BackendChoice = 'auto'): Promise<BackendName> {
  const choice = backend === 'auto' ? ((await prefersWebGPU()) ? 'webgpu' : 'webgl') : backend
  if (choice === 'webgpu') pipelineFor(await requestDevice(), preferredFormat())
  return choice
}

function createCanvas(): Canvas {
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas')
    canvas.width = 1
    canvas.height = 1
    return canvas
  }
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(1, 1)
  throw new Error('Greenscreen: there is no canvas to draw in here. Give it one with options.canvas')
}

function schedule(step: () => void): number {
  if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(step)
  return setTimeout(step, FALLBACK_INTERVAL)
}

function unschedule(handle: number) {
  if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(handle)
  else clearTimeout(handle)
}
