import { useGreenscreen } from '@snovakow/greenscreen/react'

// The hook, for drawing the keyer's canvas yourself
export function useKeyedCanvas(video: HTMLVideoElement | null): HTMLCanvasElement | null {
  const keyer = useGreenscreen(video, { similarity: 0.45 }, { paused: false })
  return keyer?.canvas ?? null
}
