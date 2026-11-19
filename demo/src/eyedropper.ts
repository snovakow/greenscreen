import { clamp } from './crop.ts'

// The patch of the frame a pick averages, in pixels each way
const PATCH = 5

let context: CanvasRenderingContext2D | null = null

// The colour the camera sees at u, v in its frame, 0 to 1 across and down it, as 0xrrggbb: the average of the 5×5
// pixels around the spot, which smooths out the camera's noise, moved in to stay inside the frame at its edges. It
// reads the frame itself, not the keyed picture, so a spot the key has already taken out can still be picked. The
// pixels are averaged in their sRGB values, from which the shader measures chroma, and linearly, so the average has the
// patch's average chroma. Null while there's no frame to read
export function sampleKey(video: HTMLVideoElement, u: number, v: number): number | null {
  const { videoWidth: width, videoHeight: height } = video
  if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !width || !height) return null

  const w = Math.min(PATCH, width)
  const h = Math.min(PATCH, height)
  const x = clamp(Math.floor(u * width) - Math.floor(w / 2), 0, width - w)
  const y = clamp(Math.floor(v * height) - Math.floor(h / 2), 0, height - h)

  if (!context) {
    const canvas = document.createElement('canvas')
    canvas.width = PATCH
    canvas.height = PATCH
    context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) return null
  }
  context.drawImage(video, x, y, w, h, 0, 0, w, h)
  const { data } = context.getImageData(0, 0, w, h)

  let r = 0
  let g = 0
  let b = 0
  for (let i = 0; i < data.length; i += 4) {
    r += data[i]
    g += data[i + 1]
    b += data[i + 2]
  }
  const n = w * h
  return (Math.round(r / n) << 16) | (Math.round(g / n) << 8) | Math.round(b / n)
}
