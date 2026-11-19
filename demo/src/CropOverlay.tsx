import { useCallback, useEffect, useRef } from 'react'
import type { PointerEvent } from 'react'
import { ALL, clamp, copy, hitTest, moveCorner, moveQuad, NONE, pickCorner, together } from './crop.ts'
import type { Point } from './crop.ts'

// The handles' colours, and their sizes in CSS pixels
const LINE = '#de3b1d'
const FACE = '#ececec'
const LIT = 'orange'
const KNOB = 8
// How near a corner a press takes hold of it, and a finger's, which covers more of what it's aiming at
const REACH = 16
const REACH_TOUCH = 24
// How far a drag from corners dragged together goes before choosing which of them it takes
const SLOP = 4

interface CropOverlayProps {
  // The cut's corners, which a drag moves in place
  corners: Point[]
  // Whether the handles are up to drag. Without them it's just the outline, which the pointer goes through to the
  // picture under it
  editable: boolean
  // A drag has moved the corners
  onChange: () => void
}

// A drag: the pointer making it, what it holds, where it began, and how far the corner it holds was from the pointer,
// so the corner keeps that distance rather than jumping to the pointer
interface Drag {
  pointer: number
  target: number
  x: number
  y: number
  dx: number
  dy: number
  start: Point[]
  // False until a drag from corners dragged together has chosen one of them
  chosen: boolean
}

// The cut's outline over the source's preview, and while editable, its handles: a knob at each corner to drag. Once
// the cut is smaller than the picture, it drags whole from inside. A drag moves the corners in place and says so, for
// the keyer to take them
export function CropOverlay({ corners, editable, onChange }: CropOverlayProps) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const hover = useRef(NONE)
  const drag = useRef<Drag | null>(null)

  const redraw = useCallback(() => {
    if (canvas.current) draw(canvas.current, corners, editable, drag.current?.target ?? hover.current)
  }, [corners, editable])

  // Put down with a drag still going, the handles let go of it. They no longer hear its release, and a drag left held
  // would keep the next press from taking hold
  useEffect(() => {
    if (editable) return
    const element = canvas.current
    const held = drag.current
    if (element && held && element.hasPointerCapture(held.pointer)) element.releasePointerCapture(held.pointer)
    drag.current = null
    hover.current = NONE
  }, [editable])

  // As many pixels as the screen has under it, drawn again whenever its size changes. Observing it reports its size at
  // once, so it's drawn again too whenever what it draws changes
  useEffect(() => {
    const element = canvas.current
    if (!element) return undefined
    const observer = new ResizeObserver(([entry]) => {
      const ratio = window.devicePixelRatio
      element.width = Math.round(entry.contentRect.width * ratio)
      element.height = Math.round(entry.contentRect.height * ratio)
      redraw()
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [redraw])

  const press = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!event.isPrimary || event.button !== 0 || drag.current) return
    const { x, y, width, height } = locate(event)
    // A finger has no hover to aim with first, so the press finds what it's on itself
    const target = hitTest(corners, x, y, width, height, reach(event))
    hover.current = target
    if (target !== NONE) {
      event.preventDefault()
      event.currentTarget.setPointerCapture(event.pointerId)
      const held = target === ALL ? { x: x / width, y: y / height } : corners[target]
      drag.current = {
        pointer: event.pointerId,
        target,
        x,
        y,
        dx: held.x * width - x,
        dy: held.y * height - y,
        start: copy(corners),
        chosen: target === ALL || together(corners, target) === 1,
      }
    }
    redraw()
  }

  const move = (event: PointerEvent<HTMLCanvasElement>) => {
    const { x, y, width, height } = locate(event)
    const held = drag.current
    if (!held) {
      hover.current = hitTest(corners, x, y, width, height, reach(event))
      redraw()
      return
    }
    if (event.pointerId !== held.pointer) return

    if (held.target === ALL) {
      moveQuad(corners, held.start, (x - held.x) / width, (y - held.y) / height)
    } else {
      const u = (x + held.dx) / width
      const v = (y + held.dy) / height
      if (!held.chosen) {
        // Corners dragged together wait to see which way the pointer goes
        if (Math.hypot(x - held.x, y - held.y) < SLOP) return
        held.target = pickCorner(corners, held.target, u, v)
        held.chosen = true
      }
      moveCorner(corners, held.target, u, v)
    }
    onChange()
    redraw()
  }

  // Ends the drag, however it ends. A mouse's hover goes back to what is under it; a finger's to nothing
  const release = (event: PointerEvent<HTMLCanvasElement>) => {
    if (drag.current?.pointer !== event.pointerId) return
    drag.current = null
    if (event.type === 'pointerup' && event.pointerType !== 'touch') {
      const { x, y, width, height } = locate(event)
      hover.current = hitTest(corners, x, y, width, height, reach(event))
    } else {
      hover.current = NONE
    }
    redraw()
  }

  const leave = () => {
    if (drag.current) return
    hover.current = NONE
    redraw()
  }

  const handlers = editable
    ? {
        onPointerDown: press,
        onPointerMove: move,
        onPointerUp: release,
        onPointerCancel: release,
        onLostPointerCapture: release,
        onPointerLeave: leave,
      }
    : {}

  return <canvas ref={canvas} className={editable ? 'overlay' : 'overlay outline'} {...handlers} />
}

// Where the pointer is on the preview, in CSS pixels, and the preview's size
function locate(event: PointerEvent<HTMLCanvasElement>) {
  const rect = event.currentTarget.getBoundingClientRect()
  return { x: event.clientX - rect.left, y: event.clientY - rect.top, width: rect.width, height: rect.height }
}

function reach(event: PointerEvent<HTMLCanvasElement>) {
  return event.pointerType === 'touch' ? REACH_TOUCH : REACH
}

// The outline, a CSS pixel wide and kept inside the canvas so that it shows all round the picture, and while editable,
// the knobs, kept inside it too. The one held or under the pointer is lit and drawn last, on top; all of them are lit
// for the whole cutout
function draw(canvas: HTMLCanvasElement, corners: readonly Point[], editable: boolean, active: number) {
  const context = canvas.getContext('2d')
  if (!context) return
  const { width, height } = canvas
  const ratio = window.devicePixelRatio
  context.clearRect(0, 0, width, height)

  const half = ratio / 2
  context.lineWidth = ratio
  context.strokeStyle = LINE
  context.beginPath()
  for (const corner of corners) {
    context.lineTo(
      clamp(corner.x * width, half, width - half),
      clamp(corner.y * height, half, height - half),
    )
  }
  context.closePath()
  context.stroke()

  if (!editable) {
    canvas.style.cursor = ''
    return
  }

  const size = KNOB * ratio
  const order = [0, 1, 2, 3].filter((i) => i !== active)
  if (active !== NONE && active !== ALL) order.push(active)
  for (const i of order) {
    const x = clamp(corners[i].x * width - size / 2, 0, width - size)
    const y = clamp(corners[i].y * height - size / 2, 0, height - size)
    context.fillStyle = LINE
    context.fillRect(x, y, size, size)
    context.fillStyle = active === ALL || active === i ? LIT : FACE
    context.fillRect(x + ratio, y + ratio, size - 2 * ratio, size - 2 * ratio)
  }

  canvas.style.cursor = active === NONE ? '' : 'move'
}
