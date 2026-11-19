import type { Settings } from './settings.ts'

// The settings as the shaders read them: eight sets of four numbers, a vec4 array in GLSL and a struct of vec4s in
// WGSL. Every shader works from these, so none of them can come to mean a setting differently
//   0  key: its Pb and Pr, 1 / its distance from grey, on
//   1  matte: similarity, smoothness, spill's reach past similarity, opacity
//   2  colour: tint's r, g and b, saturation
//   3  tone: gamma's exponent, contrast's factor, brightness, crop on
//   4  flags: flip, texture's rows bottom up, output linear, texture linear. The last three are the renderer's own
//   5  corners 0 and 1
//   6  corners 2 and 3
//   7  unused
export const PACKED_LENGTH = 32

// BT.709's luma weights, and the scales that take B' − Y' and R' − Y' to Pb and Pr, each from −0.5 to 0.5
export const LUMA = [0.2126, 0.7152, 0.0722] as const
export const CHROMA_SCALE = [1.8556, 1.5748] as const

// Into out, which is PACKED_LENGTH long, and returned
export function pack<T extends Float32Array>(settings: Readonly<Settings>, out: T): T {
  const [r, g, b] = channels(settings.keyColor)
  const y = LUMA[0] * r + LUMA[1] * g + LUMA[2] * b
  const pb = (b - y) / CHROMA_SCALE[0]
  const pr = (r - y) / CHROMA_SCALE[1]
  out[0] = pb
  out[1] = pr
  out[2] = 1 / Math.max(Math.hypot(pb, pr), 1e-3)
  out[3] = settings.key ? 1 : 0

  out[4] = settings.similarity
  out[5] = settings.smoothness
  // Spill is a share of the way from similarity to grey, so it reaches further as similarity comes down
  out[6] = settings.spill * Math.max(1 - settings.similarity, 0)
  out[7] = settings.opacity

  const tint = channels(settings.tint)
  out[8] = tint[0]
  out[9] = tint[1]
  out[10] = tint[2]
  out[11] = settings.saturation

  // An exponent from 2 down to 1/2, and a factor from 1/4 up to 4, each 1 for no change
  out[12] = 2 ** -settings.gamma
  out[13] = 4 ** settings.contrast
  out[14] = settings.brightness
  out[15] = settings.crop ? 1 : 0

  out[16] = settings.flip ? 1 : 0
  out[17] = 0
  out[18] = 0
  out[19] = 0

  settings.corners.forEach((corner, i) => {
    out[20 + i * 2] = corner.x
    out[21 + i * 2] = corner.y
  })
  out.fill(0, 28)
  return out
}

// A 0xrrggbb colour's channels, 0 to 1
export function channels(hex: number): [number, number, number] {
  return [((hex >> 16) & 0xff) / 255, ((hex >> 8) & 0xff) / 255, (hex & 0xff) / 255]
}
