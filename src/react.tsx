'use client'

// The keyer is an object outside React that these effects drive, as a canvas or a media element would be, not state
// to be copied, so setting its source and its canvas's style is what they're for. And this is a library's entry, which
// exports its hook and constants beside the component, as fast refresh, which wants components alone, isn't for it
/* oxlint-disable react/immutability, react/only-export-components */

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { Greenscreen as Keyer } from './greenscreen.ts'
import type { BackendChoice } from './greenscreen.ts'
import { DEFAULT_SETTINGS } from './settings.ts'
import type { Settings } from './settings.ts'
import { warnUnkeyable } from './source.ts'
import type { Source } from './types.ts'

// The keyer for React: a hook that keeps one, and a component that shows its canvas. Each keyer makes its own canvas
// rather than drawing in one React made, as a canvas can only ever have one kind of context, and StrictMode mounts
// everything twice

export type { Greenscreen as Keyer } from './greenscreen.ts'
export type { BackendChoice, GreenscreenOptions } from './greenscreen.ts'
export { warmUp } from './greenscreen.ts'
export { DEFAULT_SETTINGS, KEY_COLORS, RANGES } from './settings.ts'
export type { NumericSetting, Point, Range, Settings } from './settings.ts'
export type { BackendName, Source } from './types.ts'

export interface UseGreenscreenOptions {
  // 'auto' by default. A new backend makes a new keyer
  backend?: BackendChoice
  // While true, the keyer doesn't render by itself, and render() is yours to call
  paused?: boolean
  // The source's picture can't be keyed, as the keyer's own onError says. A new function on each render is fine
  onError?: (error: unknown) => void
}

type Given<T> = { -readonly [K in keyof T]?: T[K] }

// The settings that are given, without the ones set to undefined, which go back to their defaults
function given<T extends object>(settings: T | undefined): Given<T> {
  const found: Given<T> = {}
  if (!settings) return found
  for (const key in settings) if (settings[key] !== undefined) found[key] = settings[key]
  return found
}

// A keyer keying source with settings, rendering on every animation frame unless paused. It's made after the first
// render, so the hook returns null until then, and disposed when the component unmounts
export function useGreenscreen(
  source: Source | null | undefined,
  settings?: Readonly<Partial<Settings>>,
  options: UseGreenscreenOptions = {},
): Keyer | null {
  const { backend = 'auto', paused = false, onError } = options
  const [keyer, setKeyer] = useState<Keyer | null>(null)

  // The latest handler, which the keyer calls through, so a new one doesn't make a new keyer. It's brought up to date
  // after each render, before that render's source is given to the keyer
  const handler = useRef(onError)
  useEffect(() => {
    handler.current = onError
  })

  // Made in an effect, which StrictMode runs twice, so each mount has its own, disposed as it goes
  useEffect(() => {
    const made = new Keyer(null, { backend, onError: (error) => (handler.current ?? warnUnkeyable)(error) })
    // oxlint-disable-next-line react/set-state-in-effect -- the keyer is made here, where it can be disposed
    setKeyer(made)
    return () => made.dispose()
  }, [backend])

  useEffect(() => {
    if (keyer) keyer.source = source ?? null
  }, [keyer, source])

  // On every render, the settings over the defaults, so one no longer given goes back. set() compares, and draws
  // again only when something has changed
  useEffect(() => {
    keyer?.set({ ...DEFAULT_SETTINGS, ...given(settings) })
  })

  useEffect(() => {
    if (!keyer || paused) return undefined
    keyer.start()
    return () => keyer.stop()
  }, [keyer, paused])

  return keyer
}

export interface GreenscreenProps extends UseGreenscreenOptions {
  // A video, image, canvas or any other picture the browser can upload
  source: Source | null | undefined
  // Over the defaults
  settings?: Readonly<Partial<Settings>>
  // How the picture fits the element, as CSS's object-fit: 'contain' by default
  fit?: CSSProperties['objectFit']
  className?: string
  style?: CSSProperties
}

// The keyed picture, in a div the canvas fills: size the div with className or style. See-through where the key and
// the cut take the picture out. The ref is the keyer, null until it's made after the first render
export const Greenscreen = forwardRef<Keyer | null, GreenscreenProps>(function Greenscreen(
  { source, settings, backend, paused, onError, fit = 'contain', className, style },
  ref,
) {
  const keyer = useGreenscreen(source, settings, { backend, paused, onError })
  const host = useRef<HTMLDivElement>(null)

  useImperativeHandle<Keyer | null, Keyer | null>(ref, () => keyer, [keyer])

  useEffect(() => {
    const element = host.current
    if (!element || !keyer) return undefined
    const canvas = keyer.canvas
    canvas.style.display = 'block'
    canvas.style.width = '100%'
    canvas.style.height = '100%'
    canvas.style.objectFit = fit ?? 'contain'
    element.append(canvas)
    return () => canvas.remove()
  }, [keyer, fit])

  return <div ref={host} className={className} style={style} />
})
