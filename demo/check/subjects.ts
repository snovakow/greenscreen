import type { Settings } from '@snovakow/greenscreen'
import type { Subject } from './harness.ts'

// The three.js materials, held to the same checks as the core: each draws a plane the size of its canvas, with the
// picture as its map, through an orthographic camera. three.js is loaded only here

const full = async (settings: Partial<Settings>) => {
  const { DEFAULT_SETTINGS } = await import('@snovakow/greenscreen')
  return { ...DEFAULT_SETTINGS, ...settings }
}

function webglSubject(srgb: boolean): Subject {
  let dispose = () => {}
  let key: Subject['key'] | null = null
  return {
    group: `three.js WebGLRenderer, ${srgb ? 'sRGB texture' : 'texture with no colour space'}`,
    tolerance: srgb ? 3 : 2,
    steepest: srgb ? 50 : 1,
    async unavailable() {
      return document.createElement('canvas').getContext('webgl2') ? null : 'WebGL2 is not available'
    },
    async key(source, settings) {
      if (!key) {
        const three = await import('three')
        const { GreenscreenMaterial } = await import('@snovakow/greenscreen/three')
        const renderer = new three.WebGLRenderer({ alpha: true, premultipliedAlpha: true, antialias: false })
        renderer.setPixelRatio(1)
        renderer.setClearColor(0x000000, 0)
        const map = new three.CanvasTexture(source)
        map.generateMipmaps = false
        map.minFilter = three.LinearFilter
        if (srgb) map.colorSpace = three.SRGBColorSpace
        const material = new GreenscreenMaterial({ map })
        const scene = new three.Scene()
        scene.add(new three.Mesh(new three.PlaneGeometry(2, 2), material))
        const camera = new three.OrthographicCamera(-1, 1, 1, -1, 0.1, 10)
        camera.position.z = 1
        let current = source
        key = async (next, patch) => {
          if (next !== current) {
            map.image = next
            map.needsUpdate = true
            current = next
          }
          renderer.setSize(next.width, next.height, false)
          material.set(await full(patch))
          renderer.render(scene, camera)
          return { canvas: renderer.domElement, width: next.width, height: next.height }
        }
        dispose = () => {
          material.dispose()
          map.dispose()
          renderer.dispose()
          renderer.forceContextLoss()
        }
      }
      return key(source, settings)
    },
    dispose: () => dispose(),
  }
}

function nodeSubject(backend: 'webgpu' | 'webgl'): Subject {
  let dispose = () => {}
  let key: Subject['key'] | null = null
  return {
    group: `three.js WebGPURenderer on ${backend === 'webgpu' ? 'WebGPU' : 'WebGL2'}`,
    tolerance: 3,
    steepest: 50,
    async unavailable() {
      if (backend === 'webgl') return document.createElement('canvas').getContext('webgl2') ? null : 'WebGL2 is not available'
      if (!navigator.gpu) return 'WebGPU is not available'
      return (await navigator.gpu.requestAdapter()) ? null : 'WebGPU has no adapter here'
    },
    async key(source, settings) {
      if (!key) {
        const three = await import('three/webgpu')
        const { GreenscreenNodeMaterial } = await import('@snovakow/greenscreen/three/webgpu')
        const renderer = new three.WebGPURenderer({ alpha: true, antialias: false, forceWebGL: backend === 'webgl' })
        await renderer.init()
        renderer.setPixelRatio(1)
        renderer.setClearColor(0x000000, 0)
        const map = new three.CanvasTexture(source)
        map.generateMipmaps = false
        map.minFilter = three.LinearFilter
        map.colorSpace = three.SRGBColorSpace
        const material = new GreenscreenNodeMaterial({ map })
        const scene = new three.Scene()
        scene.add(new three.Mesh(new three.PlaneGeometry(2, 2), material))
        const camera = new three.OrthographicCamera(-1, 1, 1, -1, 0.1, 10)
        camera.position.z = 1
        let current = source
        key = async (next, patch) => {
          if (next !== current) {
            map.image = next
            map.needsUpdate = true
            current = next
          }
          renderer.setSize(next.width, next.height, false)
          material.set(await full(patch))
          renderer.render(scene, camera)
          return { canvas: renderer.domElement, width: next.width, height: next.height }
        }
        dispose = () => {
          material.dispose()
          map.dispose()
          void renderer.dispose()
        }
      }
      return key(source, settings)
    },
    dispose: () => dispose(),
  }
}

export async function extraSubjects(): Promise<Subject[]> {
  return [webglSubject(true), webglSubject(false), nodeSubject('webgpu'), nodeSubject('webgl')]
}
