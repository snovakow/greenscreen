// A static server for a folder on a free port on 127.0.0.1, which pages treat as a secure context, as WebGPU needs
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join, normalize, resolve, sep } from 'node:path'

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.map': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
  '.wasm': 'application/wasm',
}

export async function serve(folder) {
  const root = resolve(folder)
  const server = createServer(async (request, response) => {
    try {
      const path = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname)
      let file = normalize(join(root, path))
      if (file !== root && !file.startsWith(root + sep)) throw new Error('outside')
      if ((await stat(file)).isDirectory()) file = join(file, 'index.html')
      await stat(file)
      response.writeHead(200, {
        'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
        'cache-control': 'no-store',
      })
      createReadStream(file).pipe(response)
    } catch {
      response.writeHead(404, { 'content-type': 'text/plain' })
      response.end('Not found')
    }
  })
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  const { port } = server.address()
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((done) => server.close(done)),
  }
}
