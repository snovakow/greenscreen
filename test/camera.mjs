// A camera for Chrome to fake, as a Y4M file: 640×480, its left half screen green (40, 190, 60), its right half blue
// (30, 70, 210), and a red square (220, 30, 30) from 260 to 380 across and 180 to 300 down. Chrome reads it as BT.601
// video in studio range, so the colours come back near these, not exactly
import { writeFile } from 'node:fs/promises'

export const WIDTH = 640
export const HEIGHT = 480
export const GREEN = [40, 190, 60]
export const BLUE = [30, 70, 210]
export const RED = [220, 30, 30]
export const SQUARE = { left: 260, top: 180, right: 380, bottom: 300 }

function colourAt(x, y) {
  if (x >= SQUARE.left && x < SQUARE.right && y >= SQUARE.top && y < SQUARE.bottom) return RED
  return x < WIDTH / 2 ? GREEN : BLUE
}

function yuv([r, g, b]) {
  const [R, G, B] = [r / 255, g / 255, b / 255]
  return [
    Math.round(16 + 65.481 * R + 128.553 * G + 24.966 * B),
    Math.round(128 - 37.797 * R - 74.203 * G + 112 * B),
    Math.round(128 + 112 * R - 93.786 * G - 18.214 * B),
  ]
}

export async function writeCamera(path, frames = 2) {
  const y = Buffer.alloc(WIDTH * HEIGHT)
  const u = Buffer.alloc((WIDTH / 2) * (HEIGHT / 2))
  const v = Buffer.alloc((WIDTH / 2) * (HEIGHT / 2))
  for (let row = 0; row < HEIGHT; row++) {
    for (let column = 0; column < WIDTH; column++) y[row * WIDTH + column] = yuv(colourAt(column, row))[0]
  }
  for (let row = 0; row < HEIGHT / 2; row++) {
    for (let column = 0; column < WIDTH / 2; column++) {
      const [, cb, cr] = yuv(colourAt(column * 2, row * 2))
      u[row * (WIDTH / 2) + column] = cb
      v[row * (WIDTH / 2) + column] = cr
    }
  }
  const header = Buffer.from(`YUV4MPEG2 W${WIDTH} H${HEIGHT} F30:1 Ip A1:1 C420jpeg\n`)
  const frame = Buffer.concat([Buffer.from('FRAME\n'), y, u, v])
  await writeFile(path, Buffer.concat([header, ...Array.from({ length: frames }, () => frame)]))
}
