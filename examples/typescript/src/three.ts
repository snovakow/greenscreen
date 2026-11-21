import { GreenscreenMaterial } from '@snovakow/greenscreen/three'
import { GreenscreenNodeMaterial } from '@snovakow/greenscreen/three/webgpu'
import { Mesh, PlaneGeometry, SRGBColorSpace, VideoTexture } from 'three'
import type { Scene } from 'three'

// The three.js materials from TypeScript: one for WebGLRenderer, one for WebGPURenderer

export function addScreen(scene: Scene, video: HTMLVideoElement, webgpu: boolean): void {
  const map = new VideoTexture(video)
  map.colorSpace = SRGBColorSpace
  const material = webgpu
    ? new GreenscreenNodeMaterial({ map, settings: { similarity: 450 } })
    : new GreenscreenMaterial({ map, settings: { similarity: 450 } })
  material.set({ flip: true })
  scene.add(new Mesh(new PlaneGeometry(16 / 9, 1), material))
  // @ts-expect-error keyColor is a number
  material.set({ keyColor: 'green' })
}
