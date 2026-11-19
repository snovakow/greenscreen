import type { Source } from './types.ts'

// How a keyer tells when its source has a new picture to take. A video's frames are watched for. An image is new when
// its source changes. A canvas can be drawn on at any time with nothing to say so, so it's taken every time. The rest
// never change. Each kind is told apart by what it has rather than its class, so an element from another window, as a
// pop-out's would be, is still known

// How long a video goes without a frame callback before its clock is watched instead: callbacks come only while the
// page is drawing, and some browsers have none
const STALLED = 100

// The source's own size in pixels
export function sizeOf(source: Source): [number, number] {
  if ('videoWidth' in source) return [source.videoWidth, source.videoHeight]
  if ('naturalWidth' in source) return [source.naturalWidth, source.naturalHeight]
  if ('displayWidth' in source) return [source.displayWidth, source.displayHeight]
  return [source.width, source.height]
}

// What a keyer given no onError does with a picture it can't key
export function warnUnkeyable(error: unknown): void {
  console.warn('Greenscreen: the picture could not be keyed', error)
}

// One source as a keyer follows it: whether it has a picture yet, and whether it has a new one since it was last taken
export class Feed {
  readonly source: Source
  #fresh = true
  #time = -1
  #src = ''
  #handle = 0
  #lastFrame = -Infinity
  // The picture that last failed, by its src where it has one, so each failure is reported once. Null once one is taken
  #failedOn: string | null = null
  #disposed = false

  constructor(source: Source) {
    this.source = source
    this.#watch()
  }

  #watch() {
    const video = this.source
    if (!('requestVideoFrameCallback' in video) || this.#disposed) return
    this.#handle = video.requestVideoFrameCallback(() => {
      this.#fresh = true
      this.#lastFrame = performance.now()
      this.#watch()
    })
  }

  // Whether there's a picture to take: a video with a frame, an image that has loaded, anything else with a size
  hasPicture(): boolean {
    const source = this.source
    if ('videoWidth' in source) return source.readyState >= 2 && source.videoWidth > 0 && source.videoHeight > 0
    if ('naturalWidth' in source) return source.complete && source.naturalWidth > 0
    const [width, height] = sizeOf(source)
    return width > 0 && height > 0
  }

  // Whether the picture has changed since it was last taken
  changed(): boolean {
    if (this.#fresh) return true
    const source = this.source
    if ('videoWidth' in source) return performance.now() - this.#lastFrame > STALLED && source.currentTime !== this.#time
    if ('naturalWidth' in source) return source.currentSrc !== this.#src
    return 'getContext' in source
  }

  size(): [number, number] {
    return sizeOf(this.source)
  }

  // The picture has been taken
  taken() {
    this.#fresh = false
    this.#failedOn = null
    const source = this.source
    if ('videoWidth' in source) this.#time = source.currentTime
    else if ('naturalWidth' in source) this.#src = source.currentSrc
  }

  // Taking the picture failed, as it does for one larger than the GPU's textures, or from another site without CORS.
  // It's tried again only when the picture changes. Returns whether this failure is new: the first since a picture was
  // last taken, or of an image or video since given another src, so each is reported once however often it's tried
  failed(): boolean {
    const source = this.source
    const what = 'currentSrc' in source ? source.currentSrc : ''
    const first = this.#failedOn !== what
    this.taken()
    this.#failedOn = what
    return first
  }

  // Take the picture again on the next render, as its pixels have changed
  invalidate() {
    this.#fresh = true
  }

  dispose() {
    this.#disposed = true
    const video = this.source
    if (this.#handle && 'cancelVideoFrameCallback' in video) video.cancelVideoFrameCallback(this.#handle)
  }
}
