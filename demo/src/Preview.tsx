import type { CSSProperties, MouseEvent, Ref } from 'react'
import type { Point } from './crop.ts'
import { CropOverlay } from './CropOverlay.tsx'
import { sampleKey } from './eyedropper.ts'
import type { VideoSize } from './useCamera.ts'

// The tool up on the preview, if any: the cutout's handles, or the eyedropper for the key. Raw is neither, and the
// preview is small in the corner
export type Mode = 'raw' | 'crop' | 'pick'

interface PreviewProps {
  videoRef: Ref<HTMLVideoElement>
  size: VideoSize | null
  mode: Mode
  // Whether the cutout cuts the picture, for its outline to show on the preview
  crop: boolean
  // The cut's corners, which the handles move in place, saying so with onCorners
  corners: Point[]
  onCorners: () => void
  // While picking, a click on the preview reads the camera's colour there for onPick
  onPick: (hex: number) => void
  // Done puts the tool down
  onDone: () => void
  onLoad: () => void
}

// The camera's own picture, small in the corner, with the cutout's outline over it while Crop is on. With a tool up it
// grows: the handles go over it to drag the cutout, or a click on it picks the key. The tools are used here, on the
// camera's picture, while the main picture shows what they come to. The video element stays the same element
// throughout, so the stream playing in it plays on
export function Preview({ videoRef, size, mode, crop, corners, onCorners, onPick, onDone, onLoad }: PreviewProps) {
  // No tool until there's a picture to use it on
  const tool = size ? mode : 'raw'
  // The video's shape, for the stylesheet to keep the grown preview under a height
  const style: CSSProperties & { '--aspect'?: number } = size ? { '--aspect': size.width / size.height } : {}

  let className = 'preview'
  if (tool !== 'raw') className += ' enlarged'
  if (tool === 'pick') className += ' picking'

  // The video element's box is the picture, at the video's own shape and not mirrored by Flip, so where the click is
  // in it is where it is in the frame
  const pick = (event: MouseEvent<HTMLVideoElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const u = (event.clientX - rect.left) / rect.width
    const v = (event.clientY - rect.top) / rect.height
    const hex = sampleKey(event.currentTarget, u, v)
    if (hex !== null) onPick(hex)
  }

  return (
    <div className={className} style={style}>
      <video ref={videoRef} autoPlay muted playsInline onClick={tool === 'pick' ? pick : undefined} />
      {size && (crop || tool === 'crop') && (
        <CropOverlay corners={corners} editable={tool === 'crop'} onChange={onCorners} />
      )}
      {tool !== 'raw' && (
        <button type="button" className="done" onClick={onDone}>
          Done
        </button>
      )}
      <button type="button" className="load" onClick={onLoad}>
        Load
      </button>
    </div>
  )
}
