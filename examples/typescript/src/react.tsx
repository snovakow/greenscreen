import { Greenscreen } from '@snovakow/greenscreen/react'
import type { Keyer, Settings } from '@snovakow/greenscreen/react'
import { useRef } from 'react'

// The React entry from TypeScript: the component and its ref. useKeyedCanvas.ts has the hook

export function Screen({ video, settings }: { video: HTMLVideoElement | null; settings: Partial<Settings> }) {
  const keyer = useRef<Keyer>(null)
  return <Greenscreen ref={keyer} source={video} settings={settings} fit="cover" style={{ width: 640, height: 360 }} />
}

export function Mistake({ video }: { video: HTMLVideoElement | null }) {
  // @ts-expect-error fit is a CSS object-fit value
  return <Greenscreen source={video} fit="squash" />
}
