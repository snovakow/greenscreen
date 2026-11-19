import { DEFAULT_SETTINGS, Greenscreen, KEY_COLORS, RANGES, warmUp } from '@snovakow/greenscreen'
import type { BackendName, Point, Settings, Source } from '@snovakow/greenscreen'

// The core from TypeScript: every part of its API, with the types it's written in. The lines marked @ts-expect-error
// must fail to compile, which shows the types are really checked

export async function keyCamera(video: HTMLVideoElement): Promise<HTMLCanvasElement> {
  // 'auto' comes to WebGPU where the browser has it on the GPU, and WebGL2 elsewhere. warmUp() finds out which, and gets
  // it ready, before any keyer needs it
  const backend: BackendName = await warmUp()
  const keyer = new Greenscreen(video, { backend, settings: { keyColor: KEY_COLORS.green, similarity: 0.45 } })
  await keyer.initialized

  const corners: Point[] = [
    { x: 0.1, y: 0 },
    { x: 0.9, y: 0 },
    { x: 0.9, y: 1 },
    { x: 0.1, y: 1 },
  ]
  keyer.set({ crop: true, corners, flip: true })
  const { min, max } = RANGES.similarity
  keyer.set({ similarity: (min + max) / 2 })
  const settings: Readonly<Settings> = keyer.settings
  console.log(settings.similarity, DEFAULT_SETTINGS.spill, keyer.backend, keyer.ready, keyer.frame)

  const tick = () => {
    if (keyer.render()) {
      // keyer.canvas has the keyed picture, premultiplied, at the video's size
    }
    requestAnimationFrame(tick)
  }
  tick()
  return keyer.canvas
}

// In a worker, with a canvas handed over from the page, and frames sent to it
export function inWorker(canvas: OffscreenCanvas, frame: VideoFrame): Greenscreen<OffscreenCanvas> {
  const source: Source = frame
  const keyer = new Greenscreen(source, { canvas, backend: 'webgl' })
  keyer.render()
  keyer.dispose()
  return keyer
}

export function mistakes(keyer: Greenscreen): void {
  // @ts-expect-error similarity is a number
  keyer.set({ similarity: 'high' })
  // @ts-expect-error there's no such backend
  void new Greenscreen(null, { backend: 'vulkan' })
  // @ts-expect-error the settings are read-only
  keyer.settings.key = false
}
