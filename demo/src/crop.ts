export function clamp(x: number, low: number, high: number) {
  return Math.min(Math.max(x, low), high)
}

// The cutout's corners: four points in the video's coordinates, 0 to 1 across and down the picture, clockwise from the
// top left. The preview's handles move them with these, which keep them inside the picture and keep the shape they make
// convex, as the shader's test for what is inside it needs
export interface Point {
  x: number
  y: number
}

// What a press on the preview takes hold of: a corner, by its index, the whole cutout, or nothing
export const ALL = 4
export const NONE = -1

// How far over a line rounding may leave a corner, in the coordinates' units squared
const TOLERANCE = 1e-9
// The least of the picture the cutout can be cut down to, so its corners never all meet. A pixel of a 1280×720 picture
// is about a millionth of it
const SMALLEST = 1e-6
// How near another corner a corner goes onto it, about a pixel. The shader takes each side's line as an edge of the
// cutout, and the direction of a side between two corners a hair apart is lost in its 32-bit floats, so corners are
// either together, when it has no side to take, or this far apart
const GAP = 1e-3

// Which side of the line from a to b the point x, y is on: negative on the inside of a clockwise shape
function side(x: number, y: number, a: Point, b: Point) {
  return (x - a.x) * (b.y - a.y) - (y - a.y) * (b.x - a.x)
}

function same(a: Point, b: Point) {
  return a.x === b.x && a.y === b.y
}

export function copy(points: readonly Point[]): Point[] {
  return points.map((point) => ({ x: point.x, y: point.y }))
}

// How many corners are at corner i's place, i among them: more than one where corners were dragged together
export function together(points: readonly Point[], i: number) {
  return points.filter((point) => same(point, points[i])).length
}

// What a press at x, y takes hold of, in the pixels of a preview width by height. Inside the cutout drawn in halfway to
// its middle, the whole cutout, unless it spans the picture and has nowhere to go. Otherwise the nearest corner within
// radius, or the first of corners dragged together
export function hitTest(points: readonly Point[], x: number, y: number, width: number, height: number, radius: number) {
  x = clamp(x, 0, width)
  y = clamp(y, 0, height)

  const xs = points.map((point) => point.x)
  const ys = points.map((point) => point.y)
  const spans = Math.min(...xs) <= 0 && Math.max(...xs) >= 1 && Math.min(...ys) <= 0 && Math.max(...ys) >= 1
  if (!spans) {
    const middle = { x: (xs[0] + xs[1] + xs[2] + xs[3]) / 4, y: (ys[0] + ys[1] + ys[2] + ys[3]) / 4 }
    const inner = points.map((point) => ({ x: (point.x + middle.x) / 2, y: (point.y + middle.y) / 2 }))
    const u = x / width
    const v = y / height
    // Corners dragged together leave no side between them to be inside of
    const inside = inner.every((point, i) => {
      const before = inner[(i + 3) % 4]
      return same(before, point) || side(u, v, before, point) < 0
    })
    if (inside) return ALL
  }

  let nearest = NONE
  let least = Infinity
  points.forEach((point, i) => {
    const distance = (point.x * width - x) ** 2 + (point.y * height - y) ** 2
    if (distance < least) {
      least = distance
      nearest = i
    }
  })
  return least <= radius * radius ? nearest : NONE
}

// Moves the cutout by dx and dy from where it was at start, as far as the picture's edges let it go. Moving it from
// where the drag began, rather than by each step, keeps it under the pointer after the pointer has gone past an edge
export function moveQuad(points: Point[], start: readonly Point[], dx: number, dy: number) {
  const xs = start.map((point) => point.x)
  const ys = start.map((point) => point.y)
  dx = clamp(dx, -Math.min(...xs), 1 - Math.max(...xs))
  dy = clamp(dy, -Math.min(...ys), 1 - Math.max(...ys))
  points.forEach((point, i) => {
    point.x = clamp(start[i].x + dx, 0, 1)
    point.y = clamp(start[i].y + dy, 0, 1)
  })
}

// Moves corner i towards x, y, as far as it can go while the cutout stays convex. It can't cross the line between its
// neighbours, where the cutout would fold in on itself, so it stops on that line, or on the neighbour it went past. Nor
// can it cross the line of the side beyond either neighbour, where the cutout would bend in at that neighbour, so it
// comes back along the line from the other neighbour until it is on that line. Coming back that way, it stays on the
// side of every line it was already kept to. It goes onto any corner it comes within GAP of. If rounding still leaves a
// shape the shader can't draw, or one too small to see, the corner stays where it was
export function moveCorner(points: Point[], i: number, x: number, y: number) {
  const corner = points[i]
  const next = points[(i + 1) % 4]
  const opposite = points[(i + 2) % 4]
  const previous = points[(i + 3) % 4]
  const was = { x: corner.x, y: corner.y }

  let point = { x: clamp(x, 0, 1), y: clamp(y, 0, 1) }

  if (side(point.x, point.y, previous, next) < 0) {
    const dx = next.x - previous.x
    const dy = next.y - previous.y
    const t = ((point.x - previous.x) * dx + (point.y - previous.y) * dy) / (dx * dx + dy * dy)
    if (t <= 0) point = { x: previous.x, y: previous.y }
    else if (t >= 1) point = { x: next.x, y: next.y }
    else point = { x: previous.x + dx * t, y: previous.y + dy * t }
  }

  point = stopAt(point, previous, next, opposite)
  point = stopAt(point, next, opposite, previous)

  const reached = point
  let nearest = GAP
  for (const other of [next, opposite, previous]) {
    const distance = Math.hypot(reached.x - other.x, reached.y - other.y)
    if (distance < nearest) {
      nearest = distance
      point = { x: other.x, y: other.y }
    }
  }

  corner.x = clamp(point.x, 0, 1)
  corner.y = clamp(point.y, 0, 1)
  if (!drawable(points)) {
    corner.x = was.x
    corner.y = was.y
  }
}

// Which of the corners at corner i's place a drag towards x, y takes. Corners dragged together can each come apart only
// on their own side, so it's the one that gets nearest
export function pickCorner(points: readonly Point[], i: number, x: number, y: number) {
  let best = i
  let least = Infinity
  points.forEach((point, j) => {
    if (!same(point, points[i])) return
    const trial = copy(points)
    moveCorner(trial, j, x, y)
    const distance = (trial[j].x - x) ** 2 + (trial[j].y - y) ** 2
    if (distance < least) {
      least = distance
      best = j
    }
  })
  return best
}

// The point, or, where it is past the line from a to b, the place on that line where the way from `from` to it crosses
// the line. The side values find that place, so there is nothing to divide by zero: from is on the line or inside it,
// and the point is past it. From past the line too can only come from rounding, which the shape's check then catches
function stopAt(point: Point, from: Point, a: Point, b: Point): Point {
  const past = side(point.x, point.y, a, b)
  if (past <= 0) return point
  const before = side(from.x, from.y, a, b)
  if (before > 0) return point
  const t = before / (before - past)
  return { x: from.x + (point.x - from.x) * t, y: from.y + (point.y - from.y) * t }
}

// A shape the shader can draw: every corner inside the line of every side, or on it, so that what is inside all of the
// sides is the shape itself, with some of the picture inside it
function drawable(points: readonly Point[]) {
  let area = 0
  for (let i = 0; i < 4; i++) {
    const a = points[i]
    const b = points[(i + 1) % 4]
    if (!Number.isFinite(a.x) || !Number.isFinite(a.y)) return false
    for (const point of points) if (side(point.x, point.y, a, b) > TOLERANCE) return false
    area += a.x * b.y - b.x * a.y
  }
  return area / 2 >= SMALLEST
}
