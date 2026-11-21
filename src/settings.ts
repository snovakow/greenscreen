// What the keyer does to a picture, and how that's packed into the numbers each of its shaders reads

// A point on the picture: 0 to 1 across it from the left, and 0 to 1 down it from the top
export interface Point {
  x: number
  y: number
}

// The keyer keys as OBS Studio's chroma key filter does, the filter's second version, and takes its settings in OBS's
// units, ranges and defaults, so a filter's numbers can be copied from OBS as they are. The add-ons are the library's
// own, and not in OBS. At their defaults they change nothing, and the picture is keyed exactly as OBS keys it
//   https://github.com/obsproject/obs-studio/blob/master/plugins/obs-filters/chroma-key-filter.c
export interface Settings {
  // OBS's chroma key filter

  // Whether the filter runs, as its eye in OBS's list of filters. Off, the picture passes through it as it came, and
  // only the add-ons apply
  key: boolean
  // OBS's Key Color, as 0xrrggbb. KEY_COLORS has OBS's Green, Blue and Magenta. Any other colour is OBS's Custom Color
  keyColor: number
  // OBS's Similarity, 1 to 1000: how near the key a colour's chroma must be to be taken out
  similarity: number
  // OBS's Smoothness, 1 to 1000: how far past similarity a colour fades back in
  smoothness: number
  // OBS's Key Color Spill Reduction, 1 to 1000: how far past similarity a colour kept is desaturated, which takes the
  // key's cast off edges and hair
  spill: number
  // OBS's Opacity, 0 to 1
  opacity: number
  // OBS's Contrast, −4 to 4: a factor from 1/5 to 5, 0 for no change
  contrast: number
  // OBS's Brightness, −1 to 1, added: 0 for no change
  brightness: number
  // OBS's Gamma, −1 to 1: an exponent from 2 to 1/2, 0 for no change
  gamma: number

  // Add-ons: the library's own, not OBS's. They act on the picture OBS's filter gives, except hueSpill, which acts
  // inside the filter

  // Spill takes out only the key's hue, keeping each colour's luma and its other hues, where OBS's spill desaturates
  // the whole colour. It reaches as far as spill does, and takes as much of the key's hue out as OBS would of the colour
  hueSpill: boolean
  // Mirrors the picture left to right
  flip: boolean
  // Cuts the picture down to the shape its corners make
  crop: boolean
  // The cut's four corners, clockwise from the top left, in the picture's own coordinates: not mirrored by flip. The
  // shape they make must be convex. They're kept while crop is off
  corners: readonly Readonly<Point>[]
  // Multiplies the picture's colour, as 0xrrggbb: white for no change
  tint: number
  // 0 for grey, 1 for no change, up to 2
  saturation: number
}

export type NumericSetting = 'similarity' | 'smoothness' | 'spill' | 'opacity' | 'contrast' | 'brightness' | 'gamma' | 'saturation'

export interface Range {
  readonly min: number
  readonly max: number
  // The step OBS's slider moves in, or the add-on's. Values between steps are kept as they are, except similarity's,
  // smoothness's and spill's, which OBS keeps as whole numbers, and which are rounded to them
  readonly step: number
}

// Each number's limits, for a control panel to use: OBS's sliders', and the add-on's. Values outside them are clamped
export const RANGES: Readonly<Record<NumericSetting, Range>> = Object.freeze({
  similarity: { min: 1, max: 1000, step: 1 },
  smoothness: { min: 1, max: 1000, step: 1 },
  spill: { min: 1, max: 1000, step: 1 },
  opacity: { min: 0, max: 1, step: 0.0001 },
  contrast: { min: -4, max: 4, step: 0.01 },
  brightness: { min: -1, max: 1, step: 0.0001 },
  gamma: { min: -1, max: 1, step: 0.01 },
  saturation: { min: 0, max: 2, step: 0.01 },
})

// OBS's Green, Blue and Magenta. OBS writes its blue as 0xFF9900, as it keeps colours as 0xbbggrr
export const KEY_COLORS: Readonly<{ green: number; blue: number; magenta: number }> = Object.freeze({
  green: 0x00ff00,
  blue: 0x0099ff,
  magenta: 0xff00ff,
})

// The whole picture, which is where the cut starts
const WHOLE: readonly Readonly<Point>[] = Object.freeze([
  Object.freeze({ x: 0, y: 0 }),
  Object.freeze({ x: 1, y: 0 }),
  Object.freeze({ x: 1, y: 1 }),
  Object.freeze({ x: 0, y: 1 }),
])

// OBS's defaults for its filter, with the add-ons changing nothing
export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
  key: true,
  keyColor: KEY_COLORS.green,
  similarity: 400,
  smoothness: 80,
  spill: 100,
  opacity: 1,
  contrast: 0,
  brightness: 0,
  gamma: 0,
  hueSpill: false,
  flip: false,
  crop: false,
  corners: WHOLE,
  tint: 0xffffff,
  saturation: 1,
})

const NUMBERS: readonly NumericSetting[] = [
  'similarity',
  'smoothness',
  'spill',
  'opacity',
  'contrast',
  'brightness',
  'gamma',
  'saturation',
]

// The numbers OBS keeps as whole numbers, as its sliders for them move in whole steps and it stores them as integers
const WHOLE_NUMBERS: ReadonlySet<NumericSetting> = new Set(['similarity', 'smoothness', 'spill'])

// The settings with the patch's changes made, as a new frozen object. A value that's undefined leaves the setting as
// it was, and a name that isn't a setting is passed over, so an app's own object of settings can be given as it is.
// A value of the wrong kind throws, so a mistake shows where it's made
export function mergeSettings(base: Readonly<Settings>, patch: Readonly<Partial<Settings>>): Readonly<Settings> {
  const next: Settings = { ...base }
  if (patch.key !== undefined) next.key = flag('key', patch.key)
  if (patch.hueSpill !== undefined) next.hueSpill = flag('hueSpill', patch.hueSpill)
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
  const clamped = clamp(value, RANGES[name].min, RANGES[name].max)
  return WHOLE_NUMBERS.has(name) ? Math.round(clamped) : clamped
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
