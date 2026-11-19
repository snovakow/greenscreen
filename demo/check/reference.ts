import type { Point, Settings } from '@snovakow/greenscreen'

// The keyer worked out on the CPU, in double precision, from what the settings are documented to do. Every shader is
// held to it, pixel by pixel. It shares no code with the library, so a mistake in the library's packing of the
// settings shows here as well as one in a shader

export interface Picture {
  width: number
  height: number
  // Straight, not premultiplied, as ImageData is
  data: Uint8ClampedArray
}

const LUMA = [0.2126, 0.7152, 0.0722]
const SCALE_B = 1.8556
const SCALE_R = 1.5748

const clamp = (x: number, low: number, high: number) => Math.min(Math.max(x, low), high)

function luma(r: number, g: number, b: number) {
  return LUMA[0] * r + LUMA[1] * g + LUMA[2] * b
}

function chroma(r: number, g: number, b: number): [number, number] {
  const y = luma(r, g, b)
  return [(b - y) / SCALE_B, (r - y) / SCALE_R]
}

function ramp(x: number, width: number) {
  const t = clamp(x / Math.max(width, 1e-5), 0, 1)
  return t * t * (3 - 2 * t)
}

function channels(hex: number): [number, number, number] {
  return [((hex >> 16) & 0xff) / 255, ((hex >> 8) & 0xff) / 255, (hex & 0xff) / 255]
}

function cutSide(a: Point, b: Point, px: number, py: number, width: number, height: number) {
  const sx = (b.x - a.x) * width
  const sy = (b.y - a.y) * height
  const length = Math.hypot(sx, sy)
  if (length === 0) return 1e6
  const qx = (px - a.x) * width
  const qy = (py - a.y) * height
  return (qy * sx - qx * sy) / length
}

function cutMask(corners: readonly Point[], px: number, py: number, width: number, height: number) {
  let d = Infinity
  for (let i = 0; i < 4; i++) d = Math.min(d, cutSide(corners[i], corners[(i + 1) % 4], px, py, width, height))
  return clamp(d + 0.5, 0, 1)
}

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const toEncoded = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055)

// How a sample between texels is blended: on the sRGB values, as the core's textures hold them, or in linear light,
// as the GPU blends a texture it decodes from sRGB, which three.js makes of an image texture in sRGB
export type Filter = 'encoded' | 'linear'

// The keyed picture, premultiplied, 0 to 1, at the picture's size
export function reference(picture: Picture, settings: Settings, filter: Filter = 'encoded'): Float64Array {
  const { width, height, data } = picture
  const out = new Float64Array(width * height * 4)

  const [keyPb, keyPr] = chroma(...channels(settings.keyColor))
  const inverse = 1 / Math.max(Math.hypot(keyPb, keyPr), 1e-3)
  const distance = (r: number, g: number, b: number) => {
    const [pb, pr] = chroma(r, g, b)
    return Math.hypot(pb - keyPb, pr - keyPr) * inverse
  }
  const texel = (x: number, y: number) => {
    const i = (clamp(y, 0, height - 1) * width + clamp(x, 0, width - 1)) * 4
    return [data[i] / 255, data[i + 1] / 255, data[i + 2] / 255, data[i + 3] / 255]
  }
  // The 2×2 block from x, y, averaged, as a sample between four texels is
  const block = (x: number, y: number) => {
    const sum = [0, 0, 0]
    for (const [dx, dy] of [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ]) {
      const t = texel(x + dx, y + dy).map(filter === 'linear' ? toLinear : (c: number) => c)
      sum[0] += t[0] / 4
      sum[1] += t[1] / 4
      sum[2] += t[2] / 4
    }
    if (filter === 'linear') return distance(toEncoded(sum[0]), toEncoded(sum[1]), toEncoded(sum[2]))
    return distance(sum[0], sum[1], sum[2])
  }

  const [tintR, tintG, tintB] = channels(settings.tint)
  const exponent = 2 ** -settings.gamma
  const factor = 4 ** settings.contrast

  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      const x = settings.flip ? width - 1 - i : i
      const [r0, g0, b0, a0] = texel(x, j)
      let r = r0
      let g = g0
      let b = b0
      let alpha = a0 * settings.opacity
      if (settings.crop) alpha *= cutMask(settings.corners, (x + 0.5) / width, (j + 0.5) / height, width, height)

      if (settings.key) {
        const near = block(x - 1, j - 1) + block(x, j) + block(x, j - 1) + block(x - 1, j)
        const beyond = 0.5 * distance(r, g, b) + 0.125 * near - settings.similarity
        alpha *= ramp(beyond, settings.smoothness)
        const amount = 1 - ramp(beyond, settings.spill)
        if (amount > 0) {
          const dx = keyPb * inverse
          const dy = keyPr * inverse
          let [pb, pr] = chroma(r, g, b)
          const along = Math.max(pb * dx + pr * dy, 0)
          pb -= dx * along * amount
          pr -= dy * along * amount
          const y = luma(r, g, b)
          r = y + pr * SCALE_R
          b = y + pb * SCALE_B
          g = (y - LUMA[0] * r - LUMA[2] * b) / LUMA[1]
        }
      }

      r *= tintR
      g *= tintG
      b *= tintB
      const y = luma(r, g, b)
      r = y + (r - y) * settings.saturation
      g = y + (g - y) * settings.saturation
      b = y + (b - y) * settings.saturation
      const tone = (c: number) =>
        clamp((Math.max(c, 0) ** exponent - 0.5) * factor + 0.5 + settings.brightness, 0, 1)
      const o = (j * width + i) * 4
      out[o] = tone(r) * alpha
      out[o + 1] = tone(g) * alpha
      out[o + 2] = tone(b) * alpha
      out[o + 3] = alpha
    }
  }
  return out
}
