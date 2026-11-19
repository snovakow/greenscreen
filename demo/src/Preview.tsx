import { useEffect, useRef } from 'react'
import type { ChangeEvent, CSSProperties, MouseEvent } from 'react'
import type { Point } from './crop.ts'
import { CropOverlay } from './CropOverlay.tsx'
import { sampleKey } from './eyedropper.ts'
import type { PictureSize, SourceElement } from './useSource.ts'

// The tool up on the preview, if any: the cutout's handles, or the eyedropper for the key. Raw is neither, and the
// preview is small in the corner
export type Mode = 'raw' | 'crop' | 'pick'

interface PreviewProps {
  // The element the picture comes from, which the preview shows, and its picture's size
  source: SourceElement | null
  size: PictureSize | null
  mode: Mode
  // Whether the cutout cuts the picture, for its outline to show on the preview
  crop: boolean
  // The cut's corners, which the handles move in place, saying so with onCorners
  corners: Point[]
  onCorners: () => void
  // While picking, a click on the preview reads the source's colour there for onPick
  onPick: (hex: number) => void
  // Done puts the tool down
  onDone: () => void
  // Camera asks for the camera again, and File opens an image or a video
  onCamera: () => void
  onOpen: (file: File) => void
}

// The source's own picture, small in the corner, with the cutout's outline over it while Crop is on. With a tool up it
// grows: the handles go over it to drag the cutout, or a click on it picks the key. The tools are used here, on the
// source's picture, while the main picture shows what they come to. The source's element stays the same element
// while it's up, so a video playing in it plays on
export function Preview({ source, size, mode, crop, corners, onCorners, onPick, onDone, onCamera, onOpen }: PreviewProps) {
  const host = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)

  // The source's element goes into the preview as it comes, in place of the last
  useEffect(() => {
    const element = host.current
    if (!element || !source) return undefined
    element.append(source)
    return () => source.remove()
  }, [source])

  // No tool until there's a picture to use it on
  const tool = size ? mode : 'raw'
  // The picture's shape, for the stylesheet to keep the preview within its bounds
  const style: CSSProperties & { '--aspect'?: number } = size ? { '--aspect': size.width / size.height } : {}

  let className = 'preview'
  if (tool !== 'raw') className += ' enlarged'
  if (tool === 'pick') className += ' picking'

  // The element's box is the picture, at its own shape and not mirrored by Flip, so where the click is in it is where
  // it is in the frame
  const pick = (event: MouseEvent<HTMLDivElement>) => {
    if (!source) return
    const rect = event.currentTarget.getBoundingClientRect()
    const u = (event.clientX - rect.left) / rect.width
    const v = (event.clientY - rect.top) / rect.height
    const hex = sampleKey(source, u, v)
    if (hex !== null) onPick(hex)
  }

  // The input is emptied, so the same file chosen again opens again
  const choose = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (file) onOpen(file)
  }

  return (
    <div className={className} style={style}>
      <div ref={host} className="source" onClick={tool === 'pick' ? pick : undefined} />
      {size && (crop || tool === 'crop') && (
        <CropOverlay corners={corners} editable={tool === 'crop'} onChange={onCorners} />
      )}
      <div className="buttons">
        <button type="button" onClick={onCamera}>
          Camera
        </button>
        <button type="button" onClick={() => input.current?.click()}>
          File
        </button>
        {tool !== 'raw' && (
          <button type="button" className="done" onClick={onDone}>
            Done
          </button>
        )}
      </div>
      <input ref={input} type="file" accept="image/*,video/*" hidden onChange={choose} />
    </div>
  )
}
