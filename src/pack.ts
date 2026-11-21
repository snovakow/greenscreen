import type { Settings } from './settings.ts'

// The settings as the shaders read them: eight sets of four numbers, a vec4 array in GLSL and a struct of vec4s in
// WGSL. Every shader works from these, so none of them can come to mean a setting differently. The first three hold
// what OBS's filter works from, worked out from the settings as OBS works it out; the rest are the add-ons' and the
// renderers'
//   0  key: its Cb and Cr, 1 / its chroma's distance from grey for hueSpill, the filter on
//   1  matte: similarity, smoothness and spill, each a thousandth of its setting, and opacity
//   2  correction: gamma's exponent, contrast's factor, brightness, unused
//   3  add-ons: tint's r, g and b in linear light, saturation
//   4  flags: flip, texture's rows bottom up, output linear, texture linear. The last three are the renderer's own
//   5  corners 0 and 1
//   6  corners 2 and 3
//   7  switches: crop on, hueSpill on, unused
export const PACKED_LENGTH = 32

// A colour's Cb and Cr from its sRGB values, as OBS's filter has them: BT.709's, in studio range
export const CB = [-0.100644, -0.338572, 0.439216, 0.501961] as const
export const CR = [0.439216, -0.398942, -0.040274, 0.501961] as const

// Into out, which is PACKED_LENGTH long, and returned
export function pack<T extends Float32Array>(settings: Readonly<Settings>, out: T): T {
  // The key's chroma comes from its own sRGB values, as OBS takes them from the colour chosen
  const [r, g, b] = channels(settings.keyColor)
  out[0] = CB[0] * r + CB[1] * g + CB[2] * b + CB[3]
  out[1] = CR[0] * r + CR[1] * g + CR[2] * b + CR[3]
  // For hueSpill, the key's direction from grey, scaled to 1. A key on grey has none, and takes nothing out
  out[2] = 1 / Math.max(Math.hypot(out[0] - CB[3], out[1] - CR[3]), 1e-3)
  out[3] = settings.key ? 1 : 0

  out[4] = settings.similarity / 1000
  out[5] = settings.smoothness / 1000
  out[6] = settings.spill / 1000
  out[7] = settings.opacity

  // An exponent from 2 down to 1/2, and a factor from 1/5 up to 5, each 1 for no change, as OBS makes them
  const { gamma, contrast } = settings
  out[8] = gamma < 0 ? 1 - gamma : 1 / (1 + gamma)
  out[9] = contrast < 0 ? 1 / (1 - contrast) : 1 + contrast
  out[10] = settings.brightness
  out[11] = 0

  // The tint multiplies linear colour, so it's made linear too
  const tint = channels(settings.tint)
  out[12] = toLinear(tint[0])
  out[13] = toLinear(tint[1])
  out[14] = toLinear(tint[2])
  out[15] = settings.saturation

  out[16] = settings.flip ? 1 : 0
  out[17] = 0
  out[18] = 0
  out[19] = 0

  settings.corners.forEach((corner, i) => {
    out[20 + i * 2] = corner.x
    out[21 + i * 2] = corner.y
  })
  out[28] = settings.crop ? 1 : 0
  out[29] = settings.hueSpill ? 1 : 0
  out.fill(0, 30)
  return out
}

// A 0xrrggbb colour's channels, 0 to 1
export function channels(hex: number): [number, number, number] {
  return [((hex >> 16) & 0xff) / 255, ((hex >> 8) & 0xff) / 255, (hex & 0xff) / 255]
}

// sRGB's value to linear light
function toLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}
