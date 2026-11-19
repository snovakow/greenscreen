import { contextOf, tooLarge } from './renderer.ts'
import type { Renderer, RendererEvents } from './renderer.ts'
import { FRAGMENT, VERTEX } from './shader.glsl.ts'
import type { Canvas, Source } from './types.ts'

// Drawn with blending premultiplied, as the shader's output is, and kept between draws, so the canvas can be copied
// from at any time and not just in the task that drew it
const ATTRIBUTES: WebGLContextAttributes = {
  alpha: true,
  premultipliedAlpha: true,
  antialias: false,
  depth: false,
  stencil: false,
  preserveDrawingBuffer: true,
}

export class WebGLRenderer implements Renderer {
  readonly backend = 'webgl'
  readonly #canvas: Canvas
  readonly #gl: WebGL2RenderingContext
  readonly #events: RendererEvents
  #program: WebGLProgram | null = null
  #settings: WebGLUniformLocation | null = null
  #texture: WebGLTexture | null = null
  #width = 0
  #height = 0
  // The most pixels a side it can take and draw
  #limit = 0
  #lost = false

  constructor(canvas: Canvas, events: RendererEvents) {
    const gl = contextOf(canvas, 'webgl2', ATTRIBUTES)
    if (!gl) throw new Error('Greenscreen: WebGL2 is not available on this canvas')
    this.#canvas = canvas
    this.#gl = gl
    this.#events = events
    canvas.addEventListener('webglcontextlost', this.#onLost)
    canvas.addEventListener('webglcontextrestored', this.#onRestored)
    this.#build()
  }

  get lost() {
    return this.#lost
  }

  // The program and the texture, as at first and again once a lost context is back. The picture is uploaded as it
  // comes: top row first, not premultiplied, in sRGB
  #build() {
    const gl = this.#gl
    const program = gl.createProgram()
    const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX)
    const fragment = compile(gl, gl.FRAGMENT_SHADER, `#version 300 es\n${FRAGMENT}`)
    gl.attachShader(program, vertex)
    gl.attachShader(program, fragment)
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS) && !gl.isContextLost()) {
      throw new Error(`Greenscreen: the shader didn't link: ${gl.getProgramInfoLog(program)}`)
    }
    gl.deleteShader(vertex)
    gl.deleteShader(fragment)
    gl.useProgram(program)
    gl.uniform1i(gl.getUniformLocation(program, 'image'), 0)
    this.#program = program
    this.#settings = gl.getUniformLocation(program, 'settings')

    const texture = gl.createTexture()
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.BROWSER_DEFAULT_WEBGL)
    this.#texture = texture
    this.#width = 0
    this.#height = 0
    // The widest picture it can take and draw: its largest texture, and its largest viewport, as the canvas is sized to
    // the picture. A lost context says neither, and draws nothing until it's back
    const texture2D: unknown = gl.getParameter(gl.MAX_TEXTURE_SIZE)
    const viewport: unknown = gl.getParameter(gl.MAX_VIEWPORT_DIMS)
    const sides = [texture2D, ...(viewport instanceof Int32Array ? viewport : [])]
    this.#limit = Math.min(...sides.filter((side) => typeof side === 'number'))
  }

  // A picture larger than the context's textures throws, as it would otherwise be drawn black
  upload(source: Source, width: number, height: number) {
    if (this.#lost) return
    const limit = this.#limit
    if (width > limit || height > limit) throw tooLarge(width, height, 'WebGL2', limit)
    const gl = this.#gl
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.#texture)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, this.#straight(source, width, height))
    this.#width = width
    this.#height = height
  }

  // WebGL uploads an ImageBitmap as it was made, ignoring the unpacking flags, so one made premultiplied, as they are
  // by default, would arrive premultiplied. Drawn into a canvas first, it arrives straight, as everything else does
  #bitmaps: OffscreenCanvasRenderingContext2D | null = null

  #straight(source: Source, width: number, height: number): Source {
    if (typeof ImageBitmap === 'undefined' || !(source instanceof ImageBitmap) || typeof OffscreenCanvas === 'undefined') {
      return source
    }
    let context = this.#bitmaps
    if (!context) {
      context = new OffscreenCanvas(width, height).getContext('2d')
      if (!context) return source
      this.#bitmaps = context
    }
    const canvas = context.canvas
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width
      canvas.height = height
    } else {
      context.clearRect(0, 0, width, height)
    }
    context.drawImage(source, 0, 0)
    return canvas
  }

  // Every pixel is drawn over, unblended, so there's nothing to clear first
  draw(settings: Float32Array<ArrayBuffer>) {
    if (this.#lost || !this.#width || !this.#height) return
    const gl = this.#gl
    const canvas = this.#canvas
    if (canvas.width !== this.#width || canvas.height !== this.#height) {
      canvas.width = this.#width
      canvas.height = this.#height
    }
    gl.viewport(0, 0, this.#width, this.#height)
    gl.useProgram(this.#program)
    gl.uniform4fv(this.#settings, settings)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.#texture)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  // The drawing buffer is kept between draws, so it stays clear until the next
  clear() {
    if (this.#lost) return
    const gl = this.#gl
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
  }

  // Lost, its default is prevented, which lets the browser give it back
  #onLost = (event: Event) => {
    event.preventDefault()
    this.#lost = true
    this.#program = null
    this.#texture = null
    this.#width = 0
    this.#height = 0
    this.#events.lost()
  }

  #onRestored = () => {
    this.#lost = false
    this.#build()
    this.#events.restored()
  }

  // Loses the context on purpose, as that frees it at once rather than when it's collected, and a page can only have
  // so many
  dispose() {
    const gl = this.#gl
    this.#canvas.removeEventListener('webglcontextlost', this.#onLost)
    this.#canvas.removeEventListener('webglcontextrestored', this.#onRestored)
    if (!this.#lost) {
      gl.deleteTexture(this.#texture)
      gl.deleteProgram(this.#program)
    }
    this.#lost = true
    gl.getExtension('WEBGL_lose_context')?.loseContext()
  }
}

function compile(gl: WebGL2RenderingContext, type: number, source: string) {
  const shader = gl.createShader(type)
  if (!shader) throw new Error('Greenscreen: no shader could be made')
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS) && !gl.isContextLost()) {
    throw new Error(`Greenscreen: the shader didn't compile: ${gl.getShaderInfoLog(shader)}`)
  }
  return shader
}
