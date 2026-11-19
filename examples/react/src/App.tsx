import { DEFAULT_SETTINGS, Greenscreen } from '@snovakow/greenscreen/react'
import type { Settings } from '@snovakow/greenscreen/react'
import { useState } from 'react'

// The React entry in a React app, in StrictMode: a picture keyed, with a slider for the key's similarity

// A picture to key: green, with a red square in the middle. A <video> playing a camera works the same way
function makePicture() {
  const picture = document.createElement('canvas')
  picture.width = 160
  picture.height = 120
  const context = picture.getContext('2d')
  if (context) {
    context.fillStyle = 'rgb(40 190 60)'
    context.fillRect(0, 0, 160, 120)
    context.fillStyle = 'rgb(220 30 30)'
    context.fillRect(60, 40, 40, 40)
  }
  return picture
}

export default function App() {
  const [picture] = useState(makePicture)
  const [settings, setSettings] = useState<Partial<Settings>>({ similarity: DEFAULT_SETTINGS.similarity })
  return (
    <>
      <h1>Greenscreen in React</h1>
      <Greenscreen source={picture} settings={settings} className="keyed" />
      <label>
        Similarity{' '}
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={settings.similarity}
          onChange={(event) => setSettings({ similarity: Number(event.target.value) })}
        />
      </label>
    </>
  )
}
