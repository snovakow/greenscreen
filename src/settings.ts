// What the keyer does to a picture, and how that's packed into the numbers each of its shaders reads

// A point on the picture: 0 to 1 across it from the left, and 0 to 1 down it from the top
export interface Point {
  x: number
  y: number
}

export interface Settings {
  // Whether the key colour is taken out. Off, the rest of the settings still apply
  key: boolean
  // The colour taken out, as 0xrrggbb
  keyColor: number
  // How near the key a colour must be to be taken out, 0 to 1: a fraction of how far the key is from grey, so 0
  // takes out the key alone and 1 reaches grey
  similarity: number
  // How far past similarity a colour fades back in, 0 to 1, in the same units
  smoothness: number
  // How far past similarity the key's own tint is taken out of what's kept, 0 to 1, in the same units. It takes the
  // key's cast off edges and hair
  spill: number
  // Mirrors the picture left to right
  flip: boolean
  // Cuts the picture down to the shape its corners make
  crop: boolean
  // The cut's four corners, clockwise from the top left, in the picture's own coordinates: not mirrored by flip. The
  // shape they make must be convex. They're kept while crop is off
  corners: readonly Readonly<Point>[]
  // 0 to 1
  opacity: number
  // Multiplies the picture's colour, as 0xrrggbb: white for no change
  tint: number
  // 0 for grey, 1 for no change, up to 2
  saturation: number
  // -1 to 1, 0 for no change
  brightness: number
  contrast: number
  gamma: number
}

export type NumericSetting = 'similarity' | 'smoothness' | 'spill' | 'opacity' | 'saturation' | 'brightness' | 'contrast' | 'gamma'

export interface Range {
  readonly min: number
  readonly max: number
  // A step for a slider to move in. Values between steps are kept as they are
  readonly step: number
}

// Each number's limits, for a control panel to use. Values outside them are clamped
export const RANGES: Readonly<Record<NumericSetting, Range>> = Object.freeze({
  similarity: { min: 0, max: 1, step: 0.001 },
  smoothness: { min: 0, max: 1, step: 0.001 },
  spill: { min: 0, max: 1, step: 0.001 },
  opacity: { min: 0, max: 1, step: 0.001 },
  saturation: { min: 0, max: 2, step: 0.01 },
  brightness: { min: -1, max: 1, step: 0.001 },
  contrast: { min: -1, max: 1, step: 0.01 },
  gamma: { min: -1, max: 1, step: 0.01 },
})

// Screen colours to start from. A key picked from the screen itself, as it's lit, keys better
export const KEY_COLORS: Readonly<{ green: number; blue: number; magenta: number }> = Object.freeze({
  green: 0x00ff00,
  blue: 0x0000ff,
  magenta: 0xff00ff,
})

// The whole picture, which is where the cut starts
const WHOLE: readonly Readonly<Point>[] = Object.freeze([
  Object.freeze({ x: 0, y: 0 }),
  Object.freeze({ x: 1, y: 0 }),
  Object.freeze({ x: 1, y: 1 }),
  Object.freeze({ x: 0, y: 1 }),
])

// Green keyed out of the picture as it comes, uncut and unchanged otherwise
export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
  key: true,
  keyColor: KEY_COLORS.green,
  similarity: 0.5,
  smoothness: 0.1,
  spill: 0.2,
  flip: false,
  crop: false,
  corners: WHOLE,
  opacity: 1,
  tint: 0xffffff,
  saturation: 1,
  brightness: 0,
  contrast: 0,
  gamma: 0,
})

const NUMBERS: readonly NumericSetting[] = [
  'similarity',
  'smoothness',
  'spill',
  'opacity',
  'saturation',
  'brightness',
  'contrast',
  'gamma',
]

// The settings with the patch's changes made, as a new frozen object. A value that's undefined leaves the setting as
// it was, and a name that isn't a setting is passed over, so an app's own object of settings can be given as it is.
// A value of the wrong kind throws, so a mistake shows where it's made
export function mergeSettings(base: Readonly<Settings>, patch: Readonly<Partial<Settings>>): Readonly<Settings> {
  const next: Settings = { ...base }
  if (patch.key !== undefined) next.key = flag('key', patch.key)
  if (patch.flip !== undefined) next.flip = flag('flip', patch.flip)
  if (patch.crop !== undefined) next.crop = flag('crop', patch.crop)
  if (patch.keyColor !== undefined) next.keyColor = colour('keyColor', patch.keyColor)
  if (patch.tint !== undefined) next.tint = colour('tint', patch.tint)
  if (patch.corners !== undefined) next.corners = corners(patch.corners)
  for (const name of NUMBERS) {
    const value = patch[name]
    if (value !== undefined) next[name] = number(name, value)
  }
  return Object.freeze(next)
}

const clamp = (x: number, low: number, high: number) => Math.min(Math.max(x, low), high)

function flag(name: string, value: unknown): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`Greenscreen: ${name} must be true or false`)
  return value
}

function colour(name: string, value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 0xffffff) {
    throw new TypeError(`Greenscreen: ${name} must be a colour from 0x000000 to 0xffffff`)
  }
  return value
}

function number(name: NumericSetting, value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`Greenscreen: ${name} must be a number`)
  return clamp(value, RANGES[name].min, RANGES[name].max)
}

function corners(value: unknown): readonly Readonly<Point>[] {
  if (!Array.isArray(value) || value.length !== 4) throw new TypeError('Greenscreen: corners must be four points')
  return Object.freeze(
    value.map((point: unknown) => {
      const x: unknown = typeof point === 'object' && point !== null && 'x' in point ? point.x : undefined
      const y: unknown = typeof point === 'object' && point !== null && 'y' in point ? point.y : undefined
      if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) {
        throw new TypeError('Greenscreen: each corner must have a number x and y')
      }
      return Object.freeze({ x: clamp(x, 0, 1), y: clamp(y, 0, 1) })
    }),
  )
}
