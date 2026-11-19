import type { Settings } from '@snovakow/greenscreen'
import type { Filter } from './reference.ts'

export type Status = 'pass' | 'fail' | 'skip'

export interface Outcome {
  group: string
  name: string
  status: Status
  detail: string
}

// Thrown by a check that can't run here, which is a skip and not a failure
export class Skip extends Error {}

// Something that keys pictures, for the checks every way of keying must pass
export interface Subject {
  group: string
  // How its texture blends between texels, which the reference follows
  filter?: Filter
  // How far a channel may be from the reference, out of 255, if not the usual. A texture decoded from sRGB is blended
  // by the GPU at a precision a little short of the reference's
  tolerance?: number
  // Why it can't run here, or null when it can
  unavailable(): Promise<string | null>
  // Keys the canvas's picture with the settings, over the defaults, and returns what it drew into. It's read at once,
  // before the next key
  key(source: HTMLCanvasElement, settings: Partial<Settings>): Promise<{ canvas: CanvasImageSource; width: number; height: number }>
  dispose(): void
}

export type Report = (outcome: Outcome) => void

// Runs a check and reports it. A check passes by returning, with what it found to say, fails by throwing, and skips by
// throwing Skip
export async function check(
  report: Report,
  group: string,
  name: string,
  run: () => Promise<string | void> | string | void,
): Promise<boolean> {
  try {
    const detail = (await run()) ?? ''
    report({ group, name, status: 'pass', detail })
    return true
  } catch (error) {
    if (error instanceof Skip) {
      report({ group, name, status: 'skip', detail: error.message })
      return true
    }
    report({ group, name, status: 'fail', detail: error instanceof Error ? error.message : String(error) })
    return false
  }
}

export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

// A seeded random number generator, so a failing sweep fails the same way again
export function random(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
