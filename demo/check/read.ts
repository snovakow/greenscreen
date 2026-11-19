// Reading back what a keyer drew, and comparing it with what it should be

// Reads a premultiplied picture the way a page would use it: drawn with drawImage, once over black and once over
// white. Over black each pixel is its premultiplied colour, and what white adds back is 1 − alpha. Returns
// premultiplied r, g, b and alpha, 0 to 255
export function readKeyed(source: CanvasImageSource, width: number, height: number): Float32Array {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('No 2D context')
  const over = (background: string) => {
    context.globalCompositeOperation = 'source-over'
    context.fillStyle = background
    context.fillRect(0, 0, width, height)
    context.drawImage(source, 0, 0)
    return context.getImageData(0, 0, width, height).data
  }
  const black = over('#000')
  const white = over('#fff')
  const out = new Float32Array(width * height * 4)
  for (let i = 0; i < out.length; i += 4) {
    const added = (white[i] - black[i] + white[i + 1] - black[i + 1] + white[i + 2] - black[i + 2]) / 3
    out[i] = black[i]
    out[i + 1] = black[i + 1]
    out[i + 2] = black[i + 2]
    out[i + 3] = 255 - added
  }
  return out
}

export interface Difference {
  // The largest difference in any channel, 0 to 255
  worst: number
  // How many pixels differ by more than the tolerance in some channel
  over: number
  // Where the worst one is, and what it was against what it should be
  detail: string
}

// actual is premultiplied 0 to 255, expected premultiplied 0 to 1
export function compare(
  actual: Float32Array,
  expected: Float64Array,
  width: number,
  tolerance: number,
  only?: (x: number, y: number) => boolean,
): Difference {
  let worst = 0
  let over = 0
  let at = -1
  for (let p = 0; p < actual.length / 4; p++) {
    const x = p % width
    const y = Math.floor(p / width)
    if (only && !only(x, y)) continue
    let most = 0
    for (let c = 0; c < 4; c++) most = Math.max(most, Math.abs(actual[p * 4 + c] - expected[p * 4 + c] * 255))
    if (most > tolerance) over += 1
    if (most > worst) {
      worst = most
      at = p
    }
  }
  if (at < 0) return { worst, over, detail: 'identical' }
  const show = (values: ArrayLike<number>, scale: number) =>
    Array.from({ length: 4 }, (_, c) => Math.round(values[at * 4 + c] * scale)).join(',')
  const detail = `worst ${worst.toFixed(1)} at (${at % width}, ${Math.floor(at / width)}): ${show(actual, 1)} against ${show(expected, 255)}`
  return { worst, over, detail }
}

// The pixel at x, y of a premultiplied read, as r, g, b, alpha, 0 to 255
export function pixel(read: Float32Array, width: number, x: number, y: number): number[] {
  const i = (y * width + x) * 4
  return Array.from(read.subarray(i, i + 4), Math.round)
}

// Two reads of the same picture, pixel by pixel
export function same(a: Float32Array, b: Float32Array, tolerance: number): number {
  let worst = 0
  for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs(a[i] - b[i]))
  return worst <= tolerance ? -1 : worst
}

export function frames(count: number): Promise<void> {
  return new Promise((resolve) => {
    const step = () => (count-- <= 0 ? resolve() : requestAnimationFrame(step))
    step()
  })
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
