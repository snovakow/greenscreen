import type { Point, Settings } from '@snovakow/greenscreen'

// The keyer worked out on the CPU, in double precision, from what the settings are documented to do: OBS's chroma key
// filter, the second version, and the add-ons. Every shader is held to it, pixel by pixel. It shares no code with
// the library, so a mistake in the library's packing of the settings shows here as well as one in a shader

export interface Picture {
  width: number
  height: number
  // Straight, not premultiplied, as ImageData is
  data: Uint8ClampedArray
}

// A colour's Cb and Cr from its sRGB values, as OBS has them, and BT.709's luma, which OBS desaturates to
const CB = [-0.100644, -0.338572, 0.439216, 0.501961]
const CR = [0.439216, -0.398942, -0.040274, 0.501961]
const LUMA = [0.2126, 0.7152, 0.0722]

// The four samples round a pixel that OBS blurs the key's distance over, in pixels: one across and half of one down,
// and half of one across and one up, each either way
const AROUND = [
  [-1, -0.5],
  [1, 0.5],
  [-0.5, 1],
  [0.5, -1],
]

const clamp = (x: number, low: number, high: number) => Math.min(Math.max(x, low), high)
// sRGB's transfer, from encoded values to linear light, and back
export const toLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
export const toEncoded = (c: number): number => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055)
const luma = ([r, g, b]: readonly number[]) => LUMA[0] * r + LUMA[1] * g + LUMA[2] * b

// The add-on saturation, by way of HSB: the colour's hue, saturation and brightness, its saturation scaled and held to
// 1 at most, and the colour again from the three
function saturate([r, g, b]: readonly number[], change: number): number[] {
  const value = Math.max(r, g, b)
  const spread = value - Math.min(r, g, b)
  if (spread <= 0) return [r, g, b]
  // The hue, 0 to 6 round from red through yellow, green, cyan, blue and magenta
  let hue = (r - g) / spread + 4
  if (value === r) hue = ((g - b) / spread + 6) % 6
  else if (value === g) hue = (b - r) / spread + 2
  const saturation = Math.min((spread / value) * change, 1)
  // A channel's share of the brightness at full saturation: 1 within a sixth of the way round from its own hue, 0 from
  // two sixths away, and falling between. The offsets bring each channel's own hue, red's 0, green's 2 and blue's 4,
  // round to 0
  const share = (offset: number) => clamp(Math.abs(((hue + offset) % 6) - 3) - 1, 0, 1)
  return [share(0), share(4), share(2)].map((full) => value * (1 - saturation * (1 - full)))
}

// hueSpill's measure of an sRGB colour: its BT.709 Pb and Pr
const SCALE_B = 1.8556
const SCALE_R = 1.5748
function pbpr(encoded: readonly number[]): [number, number] {
  const y = luma(encoded)
  return [(encoded[2] - y) / SCALE_B, (encoded[0] - y) / SCALE_R]
}

function channels(hex: number): [number, number, number] {
  return [((hex >> 16) & 0xff) / 255, ((hex >> 8) & 0xff) / 255, (hex & 0xff) / 255]
}

function chroma([r, g, b]: readonly number[]): [number, number] {
  return [CB[0] * r + CB[1] * g + CB[2] * b + CB[3], CR[0] * r + CR[1] * g + CR[2] * b + CR[3]]
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

// A thousandth of one of OBS's settings of 1 to 1000, which are whole numbers
const thousandth = (x: number) => Math.round(clamp(x, 1, 1000)) / 1000

// The keyed picture, premultiplied, 0 to 1, at the picture's size
export function reference(picture: Picture, settings: Settings): Float64Array {
  const { width, height, data } = picture
  const out = new Float64Array(width * height * 4)

  // The picture as OBS holds a source: premultiplied, in linear light
  const held = new Float64Array(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    const a = data[i * 4 + 3] / 255
    for (let c = 0; c < 3; c++) held[i * 4 + c] = toLinear(data[i * 4 + c] / 255) * a
    held[i * 4 + 3] = a
  }
  // The picture at x, y, in pixels from its top left corner, as OBS's linear sampler gives it: the four pixels round
  // the point, blended, with the picture's edge pixels carried on past its edges
  const sample = (x: number, y: number): number[] => {
    const left = Math.floor(x - 0.5)
    const top = Math.floor(y - 0.5)
    const across = x - 0.5 - left
    const down = y - 0.5 - top
    const result = [0, 0, 0, 0]
    for (const [dx, dy, weight] of [
      [0, 0, (1 - across) * (1 - down)],
      [1, 0, across * (1 - down)],
      [0, 1, (1 - across) * down],
      [1, 1, across * down],
    ]) {
      const i = (clamp(top + dy, 0, height - 1) * width + clamp(left + dx, 0, width - 1)) * 4
      for (let c = 0; c < 4; c++) result[c] += held[i + c] * weight
    }
    return result
  }

  // OBS's settings as its filter uses them
  const [keyCb, keyCr] = chroma(channels(settings.keyColor))
  // For hueSpill, the key's direction from grey, 1 long, or nothing for a key on grey
  const fromGrey = Math.hypot(keyCb - CB[3], keyCr - CR[3])
  const toward = [(keyCb - CB[3]) / Math.max(fromGrey, 1e-3), (keyCr - CR[3]) / Math.max(fromGrey, 1e-3)]
  const distance = (linear: readonly number[]) => {
    const [cb, cr] = chroma(linear.slice(0, 3).map(toEncoded))
    return Math.hypot(cb - keyCb, cr - keyCr)
  }
  const similarity = thousandth(settings.similarity)
  const smoothness = thousandth(settings.smoothness)
  const spill = thousandth(settings.spill)
  const opacity = clamp(settings.opacity, 0, 1)
  const contrast = clamp(settings.contrast, -4, 4)
  const factor = contrast < 0 ? 1 / (1 - contrast) : 1 + contrast
  const gamma = clamp(settings.gamma, -1, 1)
  const exponent = gamma < 0 ? 1 - gamma : 1 / (1 + gamma)
  const brightness = clamp(settings.brightness, -1, 1)
  // The add-ons'
  const tint = channels(settings.tint).map(toLinear)
  const saturation = clamp(settings.saturation, 0, 2)

  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      // The pixel's middle on the picture, mirrored by flip
      const x = (settings.flip ? width - 1 - i : i) + 0.5
      const y = j + 0.5
      const own = sample(x, y)
      let alpha = own[3]
      let rgb = alpha > 0 ? own.slice(0, 3).map((c) => c / alpha) : [0, 0, 0]

      let kept = 1
      if (settings.key) {
        const around = AROUND.reduce((sum, [dx, dy]) => sum + distance(sample(x + dx, y + dy)), 0)
        const beyond = (2 * around + distance(rgb)) / 9 - similarity
        alpha *= opacity
        alpha *= clamp(beyond / smoothness, 0, 1) ** 1.5
        kept = clamp(beyond / spill, 0, 1) ** 1.5
      }

      // The add-ons tint and saturation, inside OBS's filter: after the key's distance is measured, and before spill,
      // which desaturates to the tinted colour's luma as it was before saturation, and before the colour's correction.
      // With the key off, they're all that changes the colour
      rgb = rgb.map((c, k) => c * tint[k])
      const grey = luma(rgb)
      if (saturation !== 1) rgb = saturate(rgb, saturation)

      if (settings.key) {
        if (settings.hueSpill) {
          // The add-on: the part of the colour's Pb and Pr that points the key's way comes out, keeping its luma
          const encoded = rgb.map(toEncoded)
          const lightness = luma(encoded)
          let [pb, pr] = pbpr(encoded)
          const along = Math.max(pb * toward[0] + pr * toward[1], 0) * (1 - kept)
          pb -= toward[0] * along
          pr -= toward[1] * along
          const r = lightness + pr * SCALE_R
          const b = lightness + pb * SCALE_B
          rgb = [r, (lightness - LUMA[0] * r - LUMA[2] * b) / LUMA[1], b].map((c) => toLinear(clamp(c, 0, 1)))
        } else {
          rgb = rgb.map((c) => grey + (c - grey) * kept)
        }
        rgb = rgb.map((c) => Math.max(c, 0) ** exponent * factor + brightness)
      }
      rgb = rgb.map((c) => clamp(c, 0, 1))

      if (settings.crop) alpha *= cutMask(settings.corners, x / width, y / height, width, height)

      const o = (j * width + i) * 4
      for (let c = 0; c < 3; c++) out[o + c] = toEncoded(rgb[c]) * alpha
      out[o + 3] = alpha
    }
  }
  return out
}
