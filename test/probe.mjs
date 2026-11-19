// What this machine's Chrome offers the keyer: the WebGL2 renderer, and whether WebGPU gives an adapter and a working
// device, under each set of flags known to bring up a software adapter. Run it first on a new machine:
//   node test/probe.mjs
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launch } from './chrome.mjs'
import { serve } from './serve.mjs'

const CONFIGS = [
  [],
  ['--enable-unsafe-webgpu'],
  ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist'],
  ['--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader'],
  ['--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader', '--enable-features=Vulkan'],
  ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader'],
  ['--enable-unsafe-webgpu', '--use-angle=swiftshader', '--use-webgpu-adapter=swiftshader'],
  ['--enable-unsafe-webgpu', '--use-angle=metal'],
]

// Runs in the page: the WebGL2 renderer's name, then each kind of adapter, a device from it, and a pixel cleared and
// read back through it
const PROBE = `(async () => {
  const out = { secure: isSecureContext }
  const gl = document.createElement('canvas').getContext('webgl2')
  if (gl) {
    const info = gl.getExtension('WEBGL_debug_renderer_info')
    out.webgl2 = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)
  } else {
    out.webgl2 = null
  }
  out.gpu = 'gpu' in navigator
  if (!navigator.gpu) return out
  for (const [name, options] of [['adapter', {}], ['fallback', { forceFallbackAdapter: true }]]) {
    try {
      const adapter = await navigator.gpu.requestAdapter(options)
      if (!adapter) { out[name] = null; continue }
      const info = adapter.info ?? {}
      const entry = { vendor: info.vendor, architecture: info.architecture, description: info.description,
        isFallbackAdapter: info.isFallbackAdapter ?? adapter.isFallbackAdapter }
      try {
        const device = await adapter.requestDevice()
        const texture = device.createTexture({ size: [1, 1], format: 'rgba8unorm',
          usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC })
        const buffer = device.createBuffer({ size: 256, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ })
        const encoder = device.createCommandEncoder()
        encoder.beginRenderPass({ colorAttachments: [{ view: texture.createView(), loadOp: 'clear', storeOp: 'store',
          clearValue: { r: 1, g: 0.5, b: 0, a: 1 } }] }).end()
        encoder.copyTextureToBuffer({ texture }, { buffer, bytesPerRow: 256 }, [1, 1])
        device.queue.submit([encoder.finish()])
        await buffer.mapAsync(GPUMapMode.READ)
        entry.pixel = Array.from(new Uint8Array(buffer.getMappedRange(), 0, 4))
        device.destroy()
      } catch (error) {
        entry.deviceError = String(error)
      }
      out[name] = entry
    } catch (error) {
      out[name] = 'error: ' + error
    }
  }
  return out
})()`

// An empty page on 127.0.0.1, as WebGPU is only offered to secure contexts, which about:blank isn't here
const folder = await mkdtemp(join(tmpdir(), 'greenscreen-probe-'))
await writeFile(join(folder, 'index.html'), '<!doctype html><title>Probe</title>')
const server = await serve(folder)

try {
  for (const flags of CONFIGS) {
    const browser = await launch({ flags: ['--enable-unsafe-swiftshader', ...flags] })
    try {
      const { gpu } = await browser.send('SystemInfo.getInfo')
      const page = await browser.newPage(`${server.url}/`)
      const result = await page.evaluate(PROBE)
      console.log(`\n# ${flags.join(' ') || '(no flags)'}`)
      console.log(`  feature status: webgpu ${gpu.featureStatus.webgpu}, webgl2 ${gpu.featureStatus.webgl2}`)
      console.log(`  ${JSON.stringify(result)}`)
    } catch (error) {
      console.log(`\n# ${flags.join(' ')}\n  failed: ${error.message}`)
    } finally {
      await browser.close()
    }
  }
} finally {
  await server.close()
  await rm(folder, { recursive: true, force: true })
}
