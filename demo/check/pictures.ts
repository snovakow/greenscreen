// The picture every check keys: blocks of flat colour, each BLOCK pixels square, from the key itself through screen
// colours as a camera sees them to colours that must be kept, and a few see-through ones
export const BLOCK = 16

export const COLOURS: { name: string; rgba: [number, number, number, number] }[] = [
  { name: 'key green', rgba: [0, 255, 0, 255] },
  { name: 'screen green', rgba: [40, 190, 60, 255] },
  { name: 'shadow green', rgba: [20, 110, 40, 255] },
  { name: 'screen blue', rgba: [30, 70, 210, 255] },
  { name: 'pure blue', rgba: [0, 0, 255, 255] },
  { name: 'magenta', rgba: [255, 0, 255, 255] },
  { name: 'red', rgba: [220, 30, 30, 255] },
  { name: 'skin', rgba: [230, 180, 150, 255] },
  { name: 'yellow', rgba: [230, 220, 50, 255] },
  { name: 'cyan', rgba: [40, 200, 200, 255] },
  { name: 'white', rgba: [255, 255, 255, 255] },
  { name: 'black', rgba: [0, 0, 0, 255] },
  { name: 'grey', rgba: [128, 128, 128, 255] },
  { name: 'dark grey', rgba: [40, 40, 40, 255] },
  { name: 'orange', rgba: [240, 140, 20, 255] },
  { name: 'purple', rgba: [120, 50, 160, 255] },
  { name: 'teal', rgba: [20, 120, 110, 255] },
  { name: 'brown', rgba: [110, 70, 40, 255] },
  { name: 'half red', rgba: [220, 30, 30, 128] },
  { name: 'clear', rgba: [0, 0, 0, 0] },
  { name: 'most green', rgba: [40, 190, 60, 200] },
  { name: 'pale green', rgba: [150, 230, 150, 255] },
  { name: 'olive', rgba: [110, 130, 40, 255] },
  { name: 'pink', rgba: [240, 150, 200, 255] },
]

const COLUMNS = 6

// The blocks laid out COLUMNS across, as ImageData. A colour's block is at (index % COLUMNS, index / COLUMNS)
export function testPicture(): ImageData {
  const rows = Math.ceil(COLOURS.length / COLUMNS)
  const width = COLUMNS * BLOCK
  const height = rows * BLOCK
  const image = new ImageData(width, height)
  COLOURS.forEach(({ rgba }, index) => {
    const bx = (index % COLUMNS) * BLOCK
    const by = Math.floor(index / COLUMNS) * BLOCK
    for (let y = by; y < by + BLOCK; y++) {
      for (let x = bx; x < bx + BLOCK; x++) image.data.set(rgba, (y * width + x) * 4)
    }
  })
  return image
}

// The middle of a colour's block
export function blockCentre(name: string): [number, number] {
  const index = COLOURS.findIndex((colour) => colour.name === name)
  if (index < 0) throw new Error(`No colour ${name}`)
  return [(index % COLUMNS) * BLOCK + BLOCK / 2, Math.floor(index / COLUMNS) * BLOCK + BLOCK / 2]
}

// A canvas holding the picture. The canvas keeps its pixels premultiplied, so see-through ones come back a little
// rounded, and what it hands back is what's keyed: picture() reads it
export function toCanvas(image: ImageData): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = image.width
  canvas.height = image.height
  canvas.getContext('2d')?.putImageData(image, 0, 0)
  return canvas
}

// The picture as the canvas holds it, for the reference to key
export function picture(canvas: HTMLCanvasElement): ImageData {
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('No 2D context')
  return context.getImageData(0, 0, canvas.width, canvas.height)
}

// A picture of a different size and colours, for a source to change to
export function otherPicture(): ImageData {
  const width = 40
  const height = 30
  const image = new ImageData(width, height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const rgba = x < width / 2 ? [40, 190, 60, 255] : [200, 40, 120, 255]
      image.data.set(rgba, (y * width + x) * 4)
    }
  }
  return image
}

// An image element showing the canvas's picture, from a PNG of it
export async function toImage(canvas: HTMLCanvasElement): Promise<HTMLImageElement> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('No PNG')
  const image = new Image()
  image.src = URL.createObjectURL(blob)
  await image.decode()
  return image
}

// A video playing the canvas, drawn again every frame so the stream keeps sending frames
export async function toVideo(canvas: HTMLCanvasElement): Promise<{ video: HTMLVideoElement; stop: () => void }> {
  const live = document.createElement('canvas')
  live.width = canvas.width
  live.height = canvas.height
  const context = live.getContext('2d')
  if (!context) throw new Error('No 2D context')
  let frame = 0
  const draw = () => {
    context.clearRect(0, 0, live.width, live.height)
    context.drawImage(canvas, 0, 0)
    frame = requestAnimationFrame(draw)
  }
  draw()
  const stream = live.captureStream(30)
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.srcObject = stream
  await video.play()
  // A frame or two, so it has one to show
  await new Promise<void>((resolve) => {
    const started = performance.now()
    const wait = () => {
      if (video.readyState >= 2 && video.videoWidth > 0 && performance.now() - started > 300) resolve()
      else requestAnimationFrame(wait)
    }
    wait()
  })
  return {
    video,
    stop: () => {
      cancelAnimationFrame(frame)
      for (const track of stream.getTracks()) track.stop()
      video.srcObject = null
    },
  }
}

// The canvas recorded as a video file, which plays, paused on a frame. A browser codes what it records as BT.601, as
// cameras often are too, which a 2D canvas, WebGL and WebGPU's own copy don't all read the same. Null where nothing
// can be recorded
export async function recordedVideo(canvas: HTMLCanvasElement): Promise<HTMLVideoElement | null> {
  if (typeof MediaRecorder === 'undefined') return null
  const type = ['video/webm;codecs=vp8', 'video/webm', 'video/mp4'].find((kind) => MediaRecorder.isTypeSupported(kind))
  if (!type) return null
  const { video: live, stop } = await toVideo(canvas)
  const stream = live.srcObject
  if (!(stream instanceof MediaStream)) throw new Error('No stream')
  const recorder = new MediaRecorder(stream, { mimeType: type })
  const chunks: Blob[] = []
  recorder.addEventListener('dataavailable', (event) => chunks.push(event.data))
  const stopped = new Promise((resolve) => recorder.addEventListener('stop', resolve, { once: true }))
  recorder.start()
  await new Promise((resolve) => setTimeout(resolve, 600))
  recorder.stop()
  await stopped
  stop()
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.src = URL.createObjectURL(new Blob(chunks, { type }))
  await video.play()
  await new Promise((resolve) => video.requestVideoFrameCallback(resolve))
  video.pause()
  return video
}
