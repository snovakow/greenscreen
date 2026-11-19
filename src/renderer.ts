import type { BackendName, Canvas, Source } from './types.ts'

// One keyer's drawing: a texture holding the source's picture, and a pass that keys it into the canvas
export interface Renderer {
  readonly backend: BackendName
  // True from the moment the graphics context or device is lost until it's been made again
  readonly lost: boolean
  // Takes the source's current picture into the texture, at its size. Throws where the picture can't be taken
  upload(source: Source, width: number, height: number): void
  // Keys the texture into the canvas, sized to the texture, with the packed settings
  draw(settings: Float32Array<ArrayBuffer>): void
  // Leaves the canvas see-through, at the size it has, for a picture that can't be keyed
  clear(): void
  dispose(): void
}

// What upload() throws for a picture larger than the backend's textures
export function tooLarge(width: number, height: number, backend: string, limit: number): RangeError {
  return new RangeError(`Greenscreen: the picture is ${width}×${height}, and ${backend} here takes up to ${limit} a side`)
}

// What a renderer tells its keyer
export interface RendererEvents {
  // The context or device is gone, and the texture with it
  lost(): void
  // It's been made again, with nothing in the texture
  restored(): void
}

// The canvas's context of that kind, whichever kind of canvas it is, or null where it can't have one: it has another
// kind already, or the browser has none of that kind
export function contextOf(canvas: Canvas, id: 'webgl2', options: WebGLContextAttributes): WebGL2RenderingContext | null
export function contextOf(canvas: Canvas, id: 'webgpu'): GPUCanvasContext | null
export function contextOf(canvas: Canvas, id: '2d'): Context2D | null
export function contextOf(canvas: Canvas, id: 'webgl2' | 'webgpu' | '2d', options?: WebGLContextAttributes) {
  let context: unknown = null
  if (typeof HTMLCanvasElement !== 'undefined' && canvas instanceof HTMLCanvasElement) {
    context = canvas.getContext(id, options)
  } else if (typeof OffscreenCanvas !== 'undefined' && canvas instanceof OffscreenCanvas) {
    context = canvas.getContext(id, options)
  }
  if (id === 'webgl2') return context instanceof WebGL2RenderingContext ? context : null
  if (id === '2d') {
    if (typeof CanvasRenderingContext2D !== 'undefined' && context instanceof CanvasRenderingContext2D) return context
    if (typeof OffscreenCanvasRenderingContext2D !== 'undefined' && context instanceof OffscreenCanvasRenderingContext2D) {
      return context
    }
    return null
  }
  return typeof GPUCanvasContext !== 'undefined' && context instanceof GPUCanvasContext ? context : null
}

export type Context2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
