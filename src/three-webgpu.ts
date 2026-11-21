import {
  clamp,
  dot,
  float,
  floor,
  Fn,
  fwidth,
  If,
  int,
  ivec2,
  max,
  min,
  mix,
  pow,
  select,
  texture,
  textureLoad,
  textureSize,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl'
import { ColorManagement, NodeMaterial, SRGBTransfer, Vector4 } from 'three/webgpu'
import type { Node, Texture } from 'three/webgpu'
import { CB, CR, pack, PACKED_LENGTH } from './pack.ts'
import { DEFAULT_SETTINGS, mergeSettings } from './settings.ts'
import type { Settings } from './settings.ts'

// The keyer as a node material, for three.js's WebGPURenderer, on its WebGPU and WebGL2 backends alike: OBS's chroma
// key filter and the add-ons, in the same steps as the GLSL in shader.glsl.ts, in TSL, from the same packed settings.
// It keys its map as OBS's filter would key it drawn at the mesh's size on screen, and shows it as
// MeshBasicNodeMaterial would, keyed, with the add-ons' colour, mirror and cut. It doesn't apply the texture's
// offset, repeat or rotation, and it reads the map's own pixels and blends them itself, as OBS's sampler does, so it
// uses no mipmaps. Like every node material, it gives the renderer linear colour, which the renderer encodes for the
// screen itself

export interface GreenscreenNodeMaterialParameters {
  // The picture to key: a VideoTexture, a Texture of an image or canvas, or any other 8-bit texture, in sRGB or with no
  // colour space. Its colour space is read when it's given, and when the settings are set
  map?: Texture | null
  settings?: Readonly<Partial<Settings>>
}

type Vec4Uniform = Node<'vec4'> & { value: Vector4 }
type Vec2Node = Node<'vec2'>
type Vec3Node = Node<'vec3'>
type Vec4Node = Node<'vec4'>
type FloatNode = Node<'float'>

interface Uniforms {
  key: Vec4Uniform
  matte: Vec4Uniform
  correction: Vec4Uniform
  extras: Vec4Uniform
  flags: Vec4Uniform
  corners01: Vec4Uniform
  corners23: Vec4Uniform
  switches: Vec4Uniform
}

const NAMES = ['key', 'matte', 'correction', 'extras', 'flags', 'corners01', 'corners23', 'switches'] as const

const LUMA = [0.2126, 0.7152, 0.0722] as const
const SCALE_B = 1.8556
const SCALE_R = 1.5748

const luma = (c: Vec3Node) => dot(c, vec3(...LUMA))

// hueSpill's: an sRGB colour's Pb and Pr, and the colour again from its luma and those
const chromaOf = (encoded: Vec3Node) => {
  const y = luma(encoded)
  return vec2(encoded.z.sub(y).div(SCALE_B), encoded.x.sub(y).div(SCALE_R))
}

const fromLumaChroma = (y: FloatNode, c: Vec2Node) => {
  const r = y.add(c.y.mul(SCALE_R))
  const b = y.add(c.x.mul(SCALE_B))
  return vec3(r, y.sub(r.mul(LUMA[0])).sub(b.mul(LUMA[2])).div(LUMA[1]), b)
}

// The add-on saturation, as in shader.glsl.ts: HSB's saturation scaled, keeping the hue and the brightest channel
const saturated = (rgb: Vec3Node, s: FloatNode) => {
  const top = max(max(rgb.x, rgb.y), rgb.z)
  const spread = top.sub(min(min(rgb.x, rgb.y), rgb.z))
  return vec3(top).sub(vec3(top).sub(rgb).mul(min(s, top.div(max(spread, 1e-12)))))
}

const channelToLinear = (c: FloatNode) => select(c.lessThanEqual(0.04045), c.div(12.92), pow(c.add(0.055).div(1.055), 2.4))
const channelToEncoded = (c: FloatNode) =>
  select(c.lessThanEqual(0.0031308), c.mul(12.92), pow(c, 1 / 2.4).mul(1.055).sub(0.055))
const toLinear = (c: Vec3Node) => vec3(channelToLinear(c.x), channelToLinear(c.y), channelToLinear(c.z))
const toEncoded = (c: Vec3Node) => vec3(channelToEncoded(c.x), channelToEncoded(c.y), channelToEncoded(c.z))

const cutSide = (a: Vec2Node, b: Vec2Node, p: Vec2Node, size: Vec2Node) => {
  const side = b.sub(a).mul(size)
  const len = side.length()
  const q = p.sub(a).mul(size)
  return select(len.equal(0), float(1e6), q.y.mul(side.x).sub(q.x.mul(side.y)).div(max(len, 1e-12)))
}

function keyer(map: Texture, u: Uniforms) {
  return Fn(() => {
    // Where this pixel is on the output, 0 to 1 across and down, and output pixels to the picture's size
    const out = vec2(uv().x, float(1).sub(uv().y)).toVar()
    const size = float(1).div(max(fwidth(out), vec2(1e-6))).toVar()

    // Where it is on the picture, mirrored by flip, and the picture's size in pixels
    const p = vec2(select(u.flags.x.greaterThan(0.5), float(1).sub(out.x), out.x), out.y).toVar()
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- @types/three gives textureSize an untyped node
    const pixels = vec2(textureSize(texture(map), int(0)) as unknown as Node<'uvec2'>).toVar()
    const last = pixels.sub(1).toVar()

    // A pixel, at a column and a row from the top in whole numbers, clamped to the picture's edges and premultiplied in
    // linear light, and the picture at a point between pixels, as OBS's sampler gives it
    const pixelAt = (at: Vec2Node): Vec4Node => {
      const clamped = clamp(at, vec2(0, 0), last).toVar()
      const row = select(u.flags.y.greaterThan(0.5), last.y.sub(clamped.y), clamped.y)
      const texel = textureLoad(map, ivec2(vec2(clamped.x, row)), int(0)).toVar()
      const rgb = select(u.flags.w.greaterThan(0.5), texel.rgb, toLinear(texel.rgb))
      return vec4(rgb.mul(texel.a), texel.a)
    }
    const sampleAt = (q: Vec2Node): Vec4Node => {
      const f = q.mul(pixels).sub(0.5).toVar()
      const corner = floor(f).toVar()
      const w = f.sub(corner).toVar()
      const above = mix(pixelAt(corner), pixelAt(corner.add(vec2(1, 0))), w.x)
      const below = mix(pixelAt(corner.add(vec2(0, 1))), pixelAt(corner.add(vec2(1, 1))), w.x)
      return mix(above, below, w.y)
    }
    const keyDistance = (encoded: Vec3Node) =>
      vec2(dot(encoded, vec3(CB[0], CB[1], CB[2])).add(CB[3]), dot(encoded, vec3(CR[0], CR[1], CR[2])).add(CR[3]))
        .sub(u.key.xy)
        .length()

    const sampled = sampleAt(p).toVar()
    const alpha = sampled.a.toVar()
    const rgb = select(alpha.greaterThan(0), sampled.rgb.div(alpha), vec3(0)).toVar()

    // OBS's filter: the key's distance, and from it the alpha and how much of the colour spill keeps
    const keyed = u.key.w.greaterThan(0.5)
    const kept = float(1).toVar()
    If(keyed, () => {
      const texel = vec2(1, 1).div(pixels).toVar()
      const across = vec2(texel.x, texel.y.mul(0.5)).toVar()
      const up = vec2(texel.x.mul(0.5), texel.y.negate()).toVar()
      const around = keyDistance(toEncoded(sampleAt(p.sub(across)).rgb))
        .add(keyDistance(toEncoded(sampleAt(p.add(across)).rgb)))
        .add(keyDistance(toEncoded(sampleAt(p.sub(up)).rgb)))
        .add(keyDistance(toEncoded(sampleAt(p.add(up)).rgb)))
      const beyond = around.mul(2).add(keyDistance(toEncoded(rgb))).div(9).sub(u.matte.x).toVar()
      alpha.mulAssign(u.matte.w)
      alpha.mulAssign(pow(clamp(beyond.div(u.matte.y), 0, 1), 1.5))
      kept.assign(pow(clamp(beyond.div(u.matte.z), 0, 1), 1.5))
    })

    // The add-ons tint and saturation. Spill desaturates to the tinted colour's luma, as it was before saturation
    rgb.mulAssign(u.extras.xyz)
    const grey = luma(rgb).toVar()
    If(u.extras.w.notEqual(1), () => {
      rgb.assign(saturated(rgb, u.extras.w))
    })

    // The rest of OBS's filter: spill, then gamma, contrast and brightness
    If(keyed, () => {
      If(u.switches.y.greaterThan(0.5), () => {
        // The add-on, hueSpill
        const encoded = toEncoded(rgb).toVar()
        const toward = u.key.xy.sub(vec2(CB[3], CR[3])).mul(u.key.z).toVar()
        const c = chromaOf(encoded).toVar()
        c.subAssign(toward.mul(max(dot(c, toward), 0)).mul(float(1).sub(kept)))
        rgb.assign(toLinear(clamp(fromLumaChroma(luma(encoded), c), 0, 1)))
      }).Else(() => {
        rgb.assign(mix(vec3(grey), rgb, kept))
      })
      rgb.assign(pow(max(rgb, vec3(0)), vec3(u.correction.x)).mul(u.correction.y).add(u.correction.z))
    })
    rgb.assign(clamp(rgb, 0, 1))

    // The add-on crop
    If(u.switches.x.greaterThan(0.5), () => {
      const c0 = u.corners01.xy
      const c1 = u.corners01.zw
      const c2 = u.corners23.xy
      const c3 = u.corners23.zw
      const d = min(
        min(cutSide(c0, c1, p, size), cutSide(c1, c2, p, size)),
        min(cutSide(c2, c3, p, size), cutSide(c3, c0, p, size)),
      )
      alpha.mulAssign(clamp(d.add(0.5), 0, 1))
    })

    // Straight, and linear: the material premultiplies it, and the renderer encodes it
    return vec4(rgb, alpha)
  })()
}

export class GreenscreenNodeMaterial extends NodeMaterial {
  static get type(): string {
    return 'GreenscreenNodeMaterial'
  }

  readonly isGreenscreenNodeMaterial = true
  #settings: Readonly<Settings> = DEFAULT_SETTINGS
  readonly #packed = new Float32Array(PACKED_LENGTH)
  readonly #uniforms: Uniforms = {
    key: uniform(new Vector4()),
    matte: uniform(new Vector4()),
    correction: uniform(new Vector4()),
    extras: uniform(new Vector4()),
    flags: uniform(new Vector4()),
    corners01: uniform(new Vector4()),
    corners23: uniform(new Vector4()),
    switches: uniform(new Vector4()),
  }
  #map: Texture | null = null

  constructor({ map = null, settings = {} }: GreenscreenNodeMaterialParameters = {}) {
    super()
    this.name = 'GreenscreenNodeMaterial'
    this.transparent = true
    this.premultipliedAlpha = true
    this.depthWrite = false
    this.lights = false
    this.map = map
    this.set(settings)
  }

  get map(): Texture | null {
    return this.#map
  }

  // A new map makes a new shader, as each is built for its texture
  set map(map: Texture | null) {
    if (map === this.#map && this.fragmentNode) return
    this.#map = map
    this.fragmentNode = map ? keyer(map, this.#uniforms) : vec4(0)
    this.needsUpdate = true
    this.#write()
  }

  get settings(): Readonly<Settings> {
    return this.#settings
  }

  set(patch: Readonly<Partial<Settings>>): void {
    this.#settings = mergeSettings(this.#settings, patch)
    this.#write()
  }

  reset(): void {
    this.set(DEFAULT_SETTINGS)
  }

  // The packed settings into the uniforms, with the flags the material sets itself: rows bottom up in uv, linear out,
  // and linear in from a texture in sRGB, which the GPU decodes as it's read
  #write() {
    const packed = pack(this.#settings, this.#packed)
    const map = this.#map
    packed[17] = 1
    packed[18] = 1
    packed[19] = map && ColorManagement.getTransfer(map.colorSpace) === SRGBTransfer ? 1 : 0
    const u = this.#uniforms
    NAMES.forEach((name, i) => u[name].value.fromArray(packed, i * 4))
  }

  // A clone keys the same map with the same settings, in uniforms of its own. NodeMaterial's copy would hand it the
  // source's shader, which reads the source's uniforms
  copy(source: this): this {
    super.copy(source)
    if (#settings in source) this.#settings = source.#settings
    this.#map = source.map ?? null
    this.fragmentNode = this.#map ? keyer(this.#map, this.#uniforms) : vec4(0)
    this.needsUpdate = true
    this.#write()
    return this
  }
}
