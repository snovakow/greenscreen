import { PACKED_LENGTH } from './pack.ts'
import { contextOf } from './renderer.ts'
import type { Context2D, Renderer, RendererEvents } from './renderer.ts'
import { SHADER } from './shader.wgsl.ts'
import type { Canvas, Source } from './types.ts'

// The WebGPU usage flags, as the spec numbers them, rather than the browser's globals, which TypeScript doesn't declare
const TEXTURE_COPY_DST = 0x02
const TEXTURE_BINDING = 0x04
const TEXTURE_RENDER_ATTACHMENT = 0x10
const BUFFER_COPY_DST = 0x08
const BUFFER_UNIFORM = 0x40

// One device for every keyer on the page, as a page can have many, and WebGPU, unlike WebGL, doesn't need a context of
// its own for each. It's asked for once, and asked for again only after it's lost
let shared: Promise<GPUDevice> | null = null

// Whether 'auto' takes WebGPU, found once, and again after the device is lost. known is what it came to, for a keyer to
// choose by at once, and null until then
let preferred: Promise<boolean> | null = null
let known: boolean | null = null

// The page's device, from the adapter given or the browser's own
export function requestDevice(given?: GPUAdapter): Promise<GPUDevice> {
  if (shared) return shared
  const attempt = (async () => {
    const adapter = given ?? (await requestAdapter())
    const device = await adapter.requestDevice()
    void device.lost.then(() => {
      if (shared !== attempt) return
      shared = null
      preferred = null
      known = null
    })
    return device
  })()
  shared = attempt
  return attempt
}

async function requestAdapter(): Promise<GPUAdapter> {
  const gpu = typeof navigator === 'undefined' ? undefined : navigator.gpu
  if (!gpu) throw new Error('Greenscreen: WebGPU is not available here')
  const adapter = await gpu.requestAdapter()
  if (!adapter) throw new Error('Greenscreen: WebGPU has no adapter here')
  return adapter
}

// Whether 'auto' takes WebGPU: where the browser has an adapter for it on the GPU, and a device from that adapter. A
// fallback adapter, which runs WebGPU on the CPU, doesn't count, as WebGL2 is then likely on the GPU, and faster
export function prefersWebGPU(): Promise<boolean> {
  if (preferred) return preferred
  const attempt = (async () => {
    try {
      const adapter = await requestAdapter()
      if (adapter.info.isFallbackAdapter) return false
      await requestDevice(adapter)
      return true
    } catch {
      return false
    }
  })()
  preferred = attempt
  void attempt.then((webgpu) => {
    if (preferred === attempt) known = webgpu
  })
  return attempt
}

// What prefersWebGPU() comes to, where that's known already: once it has resolved, or at once where there's no WebGPU
export function knownPreference(): boolean | null {
  if (typeof navigator === 'undefined' || !navigator.gpu) return false
  return known
}

interface Pipeline {
  pipeline: GPURenderPipeline
  sampler: GPUSampler
}

const pipelines = new WeakMap<GPUDevice, Map<GPUTextureFormat, Pipeline>>()

// The keying pipeline for the device and canvas format, made once
export function pipelineFor(device: GPUDevice, format: GPUTextureFormat): Pipeline {
  let byFormat = pipelines.get(device)
  if (!byFormat) {
    byFormat = new Map()
    pipelines.set(device, byFormat)
  }
  let made = byFormat.get(format)
  if (!made) {
    const module = device.createShaderModule({ label: 'Greenscreen', code: SHADER })
    const pipeline = device.createRenderPipeline({
      label: 'Greenscreen',
      layout: 'auto',
      vertex: { module, entryPoint: 'vertexMain' },
      fragment: { module, entryPoint: 'fragmentMain', targets: [{ format }] },
      primitive: { topology: 'triangle-list' },
    })
    const sampler = device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    })
    made = { pipeline, sampler }
    byFormat.set(format, made)
  }
  return made
}

export function preferredFormat(): GPUTextureFormat {
  return navigator.gpu.getPreferredCanvasFormat()
}

// WebGPU keys into a canvas of its own, off the page, and each picture is copied from there into the keyer's canvas,
// which shows it through a 2D context. A WebGPU canvas on the page gives drawImage nothing once the browser has drawn
// the page, where a 2D canvas keeps its picture until it's drawn again, on the page or off it
export class WebGPURenderer implements Renderer {
  readonly backend = 'webgpu'
  readonly #canvas: Canvas
  readonly #output: Context2D
  readonly #surface: OffscreenCanvas
  readonly #context: GPUCanvasContext
  readonly #events: RendererEvents
  #device!: GPUDevice
  #pipeline!: Pipeline
  #uniforms!: GPUBuffer
  #texture: GPUTexture | null = null
  #bindGroup: GPUBindGroup | null = null
  #videos: Context2D | null = null
  #lost = false
  #disposed = false

  constructor(canvas: Canvas, device: GPUDevice, events: RendererEvents) {
    // WebGPU first, so a canvas WebGPU can't draw for is left as it was
    const surface = new OffscreenCanvas(1, 1)
    const context = contextOf(surface, 'webgpu')
    if (!context) throw new Error('Greenscreen: WebGPU is not available on this canvas')
    const output = contextOf(canvas, '2d')
    if (!output) throw new Error('Greenscreen: this canvas has a context of another kind already')
    this.#canvas = canvas
    this.#output = output
    this.#surface = surface
    this.#context = context
    this.#events = events
    this.#build(device)
  }

  get lost() {
    return this.#lost
  }

  // The surface set up for the device, premultiplied as the shader's output is
  #build(device: GPUDevice) {
    const format = preferredFormat()
    this.#device = device
    this.#context.configure({ device, format, alphaMode: 'premultiplied', usage: TEXTURE_RENDER_ATTACHMENT })
    this.#pipeline = pipelineFor(device, format)
    this.#uniforms = device.createBuffer({
      label: 'Greenscreen settings',
      size: PACKED_LENGTH * 4,
      usage: BUFFER_UNIFORM | BUFFER_COPY_DST,
    })
    this.#texture = null
    this.#bindGroup = null
    void device.lost.then(() => this.#onLost(device))
  }

  // Lost with the device, it asks for the next one and starts again with it
  async #onLost(device: GPUDevice) {
    if (this.#disposed || device !== this.#device) return
    this.#lost = true
    this.#texture = null
    this.#bindGroup = null
    this.#events.lost()
    try {
      const next = await requestDevice()
      if (this.#disposed) return
      this.#build(next)
      this.#lost = false
      this.#events.restored()
    } catch {
      // No device to be had: it stays lost
    }
  }

  // The picture as it comes, top row first and not premultiplied, in a texture of its size. copyExternalImageToTexture
  // takes every kind of source, a video by way of a 2D canvas
  upload(source: Source, width: number, height: number) {
    if (this.#lost) return
    const device = this.#device
    let texture = this.#texture
    if (!texture || texture.width !== width || texture.height !== height) {
      texture?.destroy()
      texture = device.createTexture({
        label: 'Greenscreen picture',
        size: { width, height },
        format: 'rgba8unorm',
        usage: TEXTURE_BINDING | TEXTURE_COPY_DST | TEXTURE_RENDER_ATTACHMENT,
      })
      this.#texture = texture
      this.#bindGroup = device.createBindGroup({
        layout: this.#pipeline.pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: this.#pipeline.sampler },
          { binding: 1, resource: texture.createView() },
          { binding: 2, resource: { buffer: this.#uniforms } },
        ],
      })
    }
    device.queue.copyExternalImageToTexture(
      { source: this.#asDrawn(source, width, height), flipY: false },
      { texture, colorSpace: 'srgb', premultipliedAlpha: false },
      { width, height },
    )
  }

  // A video comes in through a 2D canvas. WebGPU's own copy converts a video's colours from the video's colour space
  // to sRGB, which moves those of a BT.601 video, as cameras' and recordings often are, by as much as 20 levels in 255:
  // the keyer would key colours a little apart from those WebGL keys, and from those a 2D canvas reads, as an
  // eyedropper does. A 2D canvas reads a video as WebGL does. It also reads a camera's first frame, which WebGPU's copy
  // can't. A VideoFrame of RGB pixels, as one made from a canvas is, has nothing to convert, and comes as it is
  #asDrawn(source: Source, width: number, height: number): Source {
    const video = 'videoWidth' in source || ('displayWidth' in source && !/^(RGB|BGR)/.test(source.format ?? ''))
    if (!video) return source
    let context = this.#videos
    if (!context) {
      context = contextOf(stagingCanvas(), '2d')
      if (!context) return source
      this.#videos = context
    }
    const canvas = context.canvas
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width
      canvas.height = height
    }
    context.globalCompositeOperation = 'copy'
    context.drawImage(source, 0, 0, width, height)
    return canvas
  }

  // The surface's texture is taken just before it's drawn over whole, and the picture is copied across, alpha and all,
  // into the keyer's canvas
  draw(settings: Float32Array<ArrayBuffer>) {
    const texture = this.#texture
    const bindGroup = this.#bindGroup
    if (this.#lost || !texture || !bindGroup) return
    const { width, height } = texture
    for (const canvas of [this.#surface, this.#canvas]) {
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width
        canvas.height = height
      }
    }
    const device = this.#device
    device.queue.writeBuffer(this.#uniforms, 0, settings, 0, settings.length)
    const encoder = device.createCommandEncoder()
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.#context.getCurrentTexture().createView(),
          loadOp: 'clear',
          clearValue: [0, 0, 0, 0],
          storeOp: 'store',
        },
      ],
    })
    pass.setPipeline(this.#pipeline.pipeline)
    pass.setBindGroup(0, bindGroup)
    pass.draw(3)
    pass.end()
    device.queue.submit([encoder.finish()])
    const output = this.#output
    output.globalCompositeOperation = 'copy'
    output.drawImage(this.#surface, 0, 0)
  }

  dispose() {
    this.#disposed = true
    this.#lost = true
    this.#texture?.destroy()
    this.#uniforms.destroy()
    this.#texture = null
    this.#bindGroup = null
    this.#videos = null
    this.#context.unconfigure()
  }
}

// The canvas a video is drawn into on its way in: an element, off the page, where there's a document. WebGPU's copy
// from a 2D OffscreenCanvas comes out empty on SwiftShader, Chrome's software renderer, where one from an element
// doesn't. A worker has only OffscreenCanvas
function stagingCanvas(): Canvas {
  if (typeof document !== 'undefined') return document.createElement('canvas')
  return new OffscreenCanvas(1, 1)
}
