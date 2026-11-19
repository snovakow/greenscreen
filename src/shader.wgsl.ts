// The keyer in WGSL, for the WebGPU renderer: the same steps as the GLSL in shader.glsl.ts, which says what they are.
// Its texture always holds the picture's sRGB values with the top row first, so it reads none of the renderer flags
// that the GLSL takes from three.js
export const SHADER: string = /* wgsl */ `
struct Settings {
  key: vec4f,
  matte: vec4f,
  colour: vec4f,
  tone: vec4f,
  flags: vec4f,
  corners: array<vec4f, 2>,
  spare: vec4f,
}

@group(0) @binding(0) var imageSampler: sampler;
@group(0) @binding(1) var image: texture_2d<f32>;
@group(0) @binding(2) var<uniform> settings: Settings;

struct Varyings {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
}

// One triangle over the whole canvas, its corners made from their index
@vertex
fn vertexMain(@builtin(vertex_index) index: u32) -> Varyings {
  let position = vec2f(f32((index & 1u) << 2u) - 1.0, f32((index & 2u) << 1u) - 1.0);
  var result: Varyings;
  result.position = vec4f(position, 0.0, 1.0);
  result.uv = vec2f(position.x + 1.0, 1.0 - position.y) * 0.5;
  return result;
}

const LUMA = vec3f(0.2126, 0.7152, 0.0722);
const CHROMA_SCALE = vec2f(1.8556, 1.5748);

fn luma(c: vec3f) -> f32 {
  return dot(c, LUMA);
}

fn chroma(c: vec3f) -> vec2f {
  let y = luma(c);
  return vec2f(c.b - y, c.r - y) / CHROMA_SCALE;
}

fn fromLumaChroma(y: f32, c: vec2f) -> vec3f {
  let r = y + c.y * CHROMA_SCALE.y;
  let b = y + c.x * CHROMA_SCALE.x;
  return vec3f(r, (y - LUMA.r * r - LUMA.b * b) / LUMA.g, b);
}

fn fetch(t: vec2f) -> vec4f {
  return textureSampleLevel(image, imageSampler, t, 0.0);
}

fn keyDistance(c: vec3f) -> f32 {
  return length(chroma(c) - settings.key.xy) * settings.key.z;
}

fn ramp(x: f32, width: f32) -> f32 {
  let t = clamp(x / max(width, 1e-5), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

fn cutSide(a: vec2f, b: vec2f, p: vec2f, size: vec2f) -> f32 {
  let side = (b - a) * size;
  let len = length(side);
  if (len == 0.0) {
    return 1.0e6;
  }
  let q = (p - a) * size;
  return (q.y * side.x - q.x * side.y) / len;
}

fn cutMask(p: vec2f, size: vec2f) -> f32 {
  let c0 = settings.corners[0].xy;
  let c1 = settings.corners[0].zw;
  let c2 = settings.corners[1].xy;
  let c3 = settings.corners[1].zw;
  let d = min(
    min(cutSide(c0, c1, p, size), cutSide(c1, c2, p, size)),
    min(cutSide(c2, c3, p, size), cutSide(c3, c0, p, size))
  );
  return clamp(d + 0.5, 0.0, 1.0);
}

@fragment
fn fragmentMain(input: Varyings) -> @location(0) vec4f {
  // Taken first, while every pixel takes the same way, as a derivative must be
  let size = 1.0 / max(fwidth(input.uv), vec2f(1e-6));
  let key = settings.key;
  let matte = settings.matte;
  let colour = settings.colour;
  let tone = settings.tone;

  let p = vec2f(select(input.uv.x, 1.0 - input.uv.x, settings.flags.x > 0.5), input.uv.y);

  let texel = fetch(p);
  var rgb = texel.rgb;
  var alpha = texel.a * matte.w;
  if (tone.w > 0.5) {
    alpha *= cutMask(p, size);
  }

  if (key.w > 0.5) {
    let h = 0.5 / vec2f(textureDimensions(image));
    let near = keyDistance(fetch(p - h).rgb) + keyDistance(fetch(p + h).rgb)
      + keyDistance(fetch(p + vec2f(h.x, -h.y)).rgb) + keyDistance(fetch(p + vec2f(-h.x, h.y)).rgb);
    let beyond = 0.5 * keyDistance(rgb) + 0.125 * near - matte.x;
    alpha *= ramp(beyond, matte.y);
    let amount = 1.0 - ramp(beyond, matte.z);
    if (amount > 0.0) {
      let direction = key.xy * key.z;
      var c = chroma(rgb);
      c -= direction * max(dot(c, direction), 0.0) * amount;
      rgb = fromLumaChroma(luma(rgb), c);
    }
  }

  rgb *= colour.rgb;
  rgb = mix(vec3f(luma(rgb)), rgb, colour.w);
  rgb = pow(max(rgb, vec3f(0.0)), vec3f(tone.x));
  rgb = (rgb - 0.5) * tone.y + 0.5 + tone.z;
  rgb = clamp(rgb, vec3f(0.0), vec3f(1.0));
  return vec4f(rgb * alpha, alpha);
}
`
