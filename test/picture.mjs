// A picture for the demo to open as a file: a PNG, 200×400, taller than it's wide as a phone's photos often are, its
// left half the camera's blue and its right half the camera's screen green. A PNG keeps its colours exactly
import { writeFile } from 'node:fs/promises'
import { crc32, deflateSync } from 'node:zlib'
import { BLUE, GREEN } from './camera.mjs'

export const PICTURE = { width: 200, height: 400 }

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const check = Buffer.alloc(4)
  check.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, check])
}

// At PICTURE's size, or another, as one wider than the GPU's textures go
export async function writePicture(path, { width, height } = PICTURE) {
  // Each row is a filter byte, 0 for none, then its pixels as RGB
  const row = 1 + width * 3
  const pixels = Buffer.alloc(row * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) pixels.set(x < width / 2 ? BLUE : GREEN, y * row + 1 + x * 3)
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  // 8 bits a channel, RGB, and the standard compression, filtering and no interlace
  header.set([8, 2, 0, 0, 0], 8)
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const png = Buffer.concat([signature, chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))])
  await writeFile(path, png)
}
