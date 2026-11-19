import { Greenscreen as Keyer, warmUp } from './greenscreen.ts'
import { DEFAULT_SETTINGS, KEY_COLORS, RANGES } from './settings.ts'

// The entry of greenscreen.global.js, for a page with no build step: <script src="greenscreen.global.js"> sets
// window.Greenscreen to the keyer, with the library's constants and warmUp() on it
export default class Greenscreen extends Keyer {
  static readonly DEFAULT_SETTINGS = DEFAULT_SETTINGS
  static readonly KEY_COLORS = KEY_COLORS
  static readonly RANGES = RANGES
  static readonly warmUp = warmUp
}
