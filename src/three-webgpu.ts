import {
  clamp,
  dot,
  float,
  Fn,
  fwidth,
  If,
  int,
  max,
  min,
  mix,
  pow,
  select,
  sRGBTransferEOTF,
  sRGBTransferOETF,
  texture,
  textureSize,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl'
import { ColorManagement, NodeMaterial, SRGBTransfer, Vector4 } from 'three/webgpu'
import type { Node, Texture } from 'three/webgpu'
import { pack, PACKED_LENGTH } from './pack.ts'
import { DEFAULT_SETTINGS, mergeSettings } from './settings.ts'
import type { Settings } from './settings.ts'

// The keyer as a node material, for three.js's WebGPURenderer, on its WebGPU and WebGL2 backends alike: the same steps
// as the GLSL in shader.glsl.ts, in TSL, from the same packed settings. It shows its map as MeshBasicNodeMaterial
// would, keyed, mirrored, cut and coloured, though it doesn't apply the texture's offset, repeat or rotation. Like
// every node material, it gives the renderer linear colour, which the renderer encodes for the screen itself

export interface GreenscreenNodeMaterialParameters {
  // The picture to key: a VideoTexture, a Texture of an image or canvas, or any other 8-bit texture, in sRGB or with no
  // colour space. Its colour space is read when it's given, and when the settings are set
  map?: Texture | null
  settings?: Readonly<Partial<Settings>>
}

type Vec4Uniform = Node<'vec4'> & { value: Vector4 }
type Vec2Node = Node<'vec2'>
type Vec3Node = Node<'vec3'>
type FloatNode = Node<'float'>

interface Uniforms {
  key: Vec4Uniform
  matte: Vec4Uniform
  colour: Vec4Uniform
  tone: Vec4Uniform
  flags: Vec4Uniform
  corners01: Vec4Uniform
  corners23: Vec4Uniform
}

const LUMA = [0.2126, 0.7152, 0.0722] as const
const SCALE_B = 1.8556
const SCALE_R = 1.5748

const luma = (c: Vec3Node) => dot(c, vec3(...LUMA))

const chroma = (c: Vec3Node) => {
  const y = luma(c)
  return vec2(c.z.sub(y).div(SCALE_B), c.x.sub(y).div(SCALE_R))
}

const fromLumaChroma = (y: FloatNode, c: Vec2Node) => {
  const r = y.add(c.y.mul(SCALE_R))
  const b = y.add(c.x.mul(SCALE_B))
  return vec3(r, y.sub(r.mul(LUMA[0])).sub(b.mul(LUMA[2])).div(LUMA[1]), b)
}

const ramp = (x: FloatNode, width: FloatNode) => {
  const t = clamp(x.div(max(width, 1e-5)), 0, 1)
  return t.mul(t).mul(float(3).sub(t.mul(2)))
}

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

    const p = vec2(select(u.flags.x.greaterThan(0.5), float(1).sub(out.x), out.x), out.y).toVar()
    const t = vec2(p.x, float(1).sub(p.y)).toVar()
    const fetch = (at: Vec2Node) => {
      const sample = texture(map, at).level(float(0))
      // @types/three gives the transfer functions untyped nodes
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      const encoded = sRGBTransferOETF(sample.rgb) as unknown as Vec3Node
      return vec4(select(u.flags.w.greaterThan(0.5), encoded, sample.rgb), sample.a)
    }
    const keyDistance = (c: Vec3Node) => chroma(c).sub(u.key.xy).length().mul(u.key.z)

    const texel = fetch(t).toVar()
    const rgb = texel.rgb.toVar()
    const alpha = texel.a.mul(u.matte.w).toVar()

    If(u.tone.w.greaterThan(0.5), () => {
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

    If(u.key.w.greaterThan(0.5), () => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- @types/three gives textureSize an untyped node
      const dimensions = textureSize(texture(map), int(0)) as unknown as Node<'ivec2'>
      const h = vec2(0.5, 0.5).div(vec2(dimensions)).toVar()
      const near = keyDistance(fetch(t.sub(h)).rgb)
        .add(keyDistance(fetch(t.add(h)).rgb))
        .add(keyDistance(fetch(t.add(vec2(h.x, h.y.negate()))).rgb))
        .add(keyDistance(fetch(t.add(vec2(h.x.negate(), h.y))).rgb))
      const beyond = keyDistance(rgb).mul(0.5).add(near.mul(0.125)).sub(u.matte.x).toVar()
      alpha.mulAssign(ramp(beyond, u.matte.y))
      const amount = float(1).sub(ramp(beyond, u.matte.z)).toVar()
      If(amount.greaterThan(0), () => {
        const direction = u.key.xy.mul(u.key.z).toVar()
        const c = chroma(rgb).toVar()
        c.subAssign(direction.mul(max(dot(c, direction), 0)).mul(amount))
        rgb.assign(fromLumaChroma(luma(rgb), c))
      })
    })

    rgb.mulAssign(u.colour.xyz)
    rgb.assign(mix(vec3(luma(rgb)), rgb, u.colour.w))
    rgb.assign(pow(max(rgb, vec3(0)), vec3(u.tone.x)))
    rgb.assign(rgb.sub(0.5).mul(u.tone.y).add(0.5).add(u.tone.z))
    rgb.assign(clamp(rgb, 0, 1))
    // Straight, and linear: the material premultiplies it, and the renderer encodes it
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    return vec4(sRGBTransferEOTF(rgb) as unknown as Vec3Node, alpha)
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
    colour: uniform(new Vector4()),
    tone: uniform(new Vector4()),
    flags: uniform(new Vector4()),
    corners01: uniform(new Vector4()),
    corners23: uniform(new Vector4()),
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
  // and linear in from a texture in sRGB, which the node that samples it decodes
  #write() {
    const packed = pack(this.#settings, this.#packed)
    const map = this.#map
    packed[17] = 1
    packed[18] = 1
    packed[19] = map && ColorManagement.getTransfer(map.colorSpace) === SRGBTransfer ? 1 : 0
    const u = this.#uniforms
    const names = ['key', 'matte', 'colour', 'tone', 'flags', 'corners01', 'corners23'] as const
    names.forEach((name, i) => u[name].value.fromArray(packed, i * 4))
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
