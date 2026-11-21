import { ColorManagement, GLSL3, RawShaderMaterial, SRGBTransfer } from 'three'
import type { IUniform, Texture, WebGLRenderer } from 'three'
import { pack, PACKED_LENGTH } from './pack.ts'
import { DEFAULT_SETTINGS, mergeSettings } from './settings.ts'
import type { Settings } from './settings.ts'
import { FRAGMENT } from './shader.glsl.ts'

// The keyer as a three.js material, for WebGLRenderer: the core's own GLSL, drawn on whatever mesh it's given. It keys
// the texture in map as OBS's filter would key it drawn at the mesh's size on screen, and shows it as MeshBasicMaterial
// would show that map on the mesh, keyed, then mirrored, cut and coloured by the add-ons. It doesn't apply the
// texture's offset, repeat or rotation. It reads the map's own pixels and blends them itself, as OBS's sampler does, so
// it uses no mipmaps. The cut's corners, and OBS's samples round each pixel, are on the picture as it shows on the
// mesh, with y down

export interface GreenscreenMaterialParameters {
  // The picture to key: a VideoTexture, a Texture of an image or canvas, or any other 8-bit texture. It may be in
  // sRGB or have no colour space; either way it's keyed as OBS keys a picture of those sRGB values. It must not be
  // premultiplied
  map?: Texture | null
  settings?: Readonly<Partial<Settings>>
}

const VERTEX = /* glsl */ `precision highp float;
in vec3 position;
in vec2 uv;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
out vec2 vUv;
void main() {
  vUv = vec2(uv.x, 1.0 - uv.y);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

interface Uniforms {
  [uniform: string]: IUniform
  image: IUniform<Texture | null>
  settings: IUniform<Float32Array>
}

export class GreenscreenMaterial extends RawShaderMaterial {
  readonly isGreenscreenMaterial = true
  declare uniforms: Uniforms
  #settings: Readonly<Settings> = DEFAULT_SETTINGS

  constructor({ map = null, settings = {} }: GreenscreenMaterialParameters = {}) {
    super({
      name: 'GreenscreenMaterial',
      glslVersion: GLSL3,
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: { image: { value: map }, settings: { value: new Float32Array(PACKED_LENGTH) } },
      // Its output is premultiplied, and blends as that is
      transparent: true,
      premultipliedAlpha: true,
      depthWrite: false,
    })
    this.set(settings)
  }

  get map(): Texture | null {
    return this.uniforms.image.value
  }

  set map(texture: Texture | null) {
    this.uniforms.image.value = texture
  }

  // The settings it keys with, as a frozen object
  get settings(): Readonly<Settings> {
    return this.#settings
  }

  // Changes the settings named, leaving the rest. The values are copied
  set(patch: Readonly<Partial<Settings>>): void {
    this.#settings = mergeSettings(this.#settings, patch)
    pack(this.#settings, this.uniforms.settings.value)
    this.uniformsNeedUpdate = true
  }

  reset(): void {
    this.set(DEFAULT_SETTINGS)
  }

  // What the shader can't know from the settings: the texture's rows run bottom up in uv, as MeshBasicMaterial
  // samples them; whether the texture gives linear values, as an 8-bit sRGB texture other than a video's does in
  // three.js; and whether what it draws into wants linear values, as anything but the screen does
  onBeforeRender(renderer: WebGLRenderer): void {
    const packed = this.uniforms.settings.value
    const target = renderer.getRenderTarget()
    const space =
      target === null
        ? renderer.outputColorSpace
        : 'isXRRenderTarget' in target && target.isXRRenderTarget === true
          ? target.texture.colorSpace
          : ColorManagement.workingColorSpace
    const map = this.map
    packed[17] = 1
    packed[18] = ColorManagement.getTransfer(space) === SRGBTransfer ? 0 : 1
    packed[19] =
      map && !('isVideoTexture' in map && map.isVideoTexture === true) && ColorManagement.getTransfer(map.colorSpace) === SRGBTransfer
        ? 1
        : 0
    this.uniformsNeedUpdate = true
  }

  // A clone keys with the same settings, in a settings array of its own
  copy(source: this): this {
    super.copy(source)
    this.uniforms.settings.value = Float32Array.from(source.uniforms.settings.value)
    if (#settings in source) this.#settings = source.#settings
    return this
  }
}
