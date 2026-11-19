import { DEFAULT_SETTINGS } from '@snovakow/greenscreen'
import type { Point, Settings } from '@snovakow/greenscreen'
import { Greenscreen } from '@snovakow/greenscreen/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Panel } from './Panel.tsx'
import type { PanelHandle } from './Panel.tsx'
import { Preview } from './Preview.tsx'
import type { Mode } from './Preview.tsx'
import { useCamera } from './useCamera.ts'

const whole = () => DEFAULT_SETTINGS.corners.map((corner) => ({ x: corner.x, y: corner.y }))

// The camera keyed, filling the window over black, with the panel to tune it and the camera's own picture in the
// corner to work the tools on
export default function App() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  // The cut's corners, which the preview's handles move in place, and copy into the settings as they go
  const [corners] = useState<Point[]>(whole)
  // The tool up on the preview, one at a time
  const [mode, setMode] = useState<Mode>('raw')
  const panel = useRef<PanelHandle>(null)
  const { ref, video, size, load } = useCamera()

  const change = useCallback((patch: Partial<Settings>) => setSettings((current) => ({ ...current, ...patch })), [])
  // Crop turned off puts the handles down, as there's no cut left to show
  const changeCrop = useCallback((on: boolean) => {
    if (!on) setMode((current) => (current === 'crop' ? 'raw' : current))
  }, [])
  const moveCorners = useCallback(
    () => change({ corners: corners.map((corner) => ({ x: corner.x, y: corner.y })) }),
    [change, corners],
  )

  // Back to the picture as it comes, with the cut back on the whole picture
  const reset = useCallback(() => {
    corners.splice(0, 4, ...whole())
    setSettings(DEFAULT_SETTINGS)
    setMode('raw')
  }, [corners])

  // Each tool's button puts its tool up, in place of the other, or down again. Done on the preview puts either down
  const toggleCrop = useCallback(() => setMode((current) => (current === 'crop' ? 'raw' : 'crop')), [])
  const togglePick = useCallback(() => setMode((current) => (current === 'pick' ? 'raw' : 'pick')), [])
  const done = useCallback(() => setMode('raw'), [])

  // A click on the preview sets the key and turns it on. The eyedropper stays up for another, while the main picture
  // shows how the last one keys, until Pick key again, Done or Escape puts it down
  const pick = useCallback((hex: number) => {
    panel.current?.setKey(hex)
  }, [])

  // Edit crop turns Crop on, so the picture shows the cut as the corners move
  useEffect(() => {
    if (mode === 'crop') panel.current?.setCrop(true)
  }, [mode])

  // Escape puts the tool down too. It listens as the key comes down to the page, before the panel, which still has the
  // focus from the tool's button and stops keys going any further
  useEffect(() => {
    if (mode === 'raw') return undefined
    const cancel = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMode('raw')
    }
    window.addEventListener('keydown', cancel, true)
    return () => window.removeEventListener('keydown', cancel, true)
  }, [mode])

  return (
    <>
      <Greenscreen source={video} settings={settings} className="picture" />
      <Panel
        ref={panel}
        onChange={change}
        onCrop={changeCrop}
        onReset={reset}
        mode={mode}
        onEditCrop={toggleCrop}
        onPickKey={togglePick}
      />
      <Preview
        videoRef={ref}
        size={size}
        mode={mode}
        crop={settings.crop}
        corners={corners}
        onCorners={moveCorners}
        onPick={pick}
        onDone={done}
        onLoad={load}
      />
    </>
  )
}
