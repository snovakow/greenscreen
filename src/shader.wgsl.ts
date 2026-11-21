// The keyer in WGSL, for the WebGPU renderer: OBS's chroma key filter and the add-ons, in the same steps as the GLSL
// in shader.glsl.ts, which says what they are. Its texture always holds the picture's sRGB values with the top row
// first, so it reads none of the renderer flags that the GLSL takes from three.js
export const SHADER: string = /* wgsl */ `
struct Settings {
  key: vec4f,
  matte: vec4f,
  correction: vec4f,
  extras: vec4f,
  flags: vec4f,
  corners: array<vec4f, 2>,
  switches: vec4f,
}

@group(0) @binding(0) var image: texture_2d<f32>;
@group(0) @binding(1) var<uniform> settings: Settings;

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

const CB = vec3f(-0.100644, -0.338572, 0.439216);
const CR = vec3f(0.439216, -0.398942, -0.040274);
const CHROMA_OFFSET = 0.501961;
const LUMA = vec3f(0.2126, 0.7152, 0.0722);
const CHROMA_SCALE = vec2f(1.8556, 1.5748);

fn channelToLinear(c: f32) -> f32 {
  return select(pow((c + 0.055) / 1.055, 2.4), c / 12.92, c <= 0.04045);
}

fn channelToEncoded(c: f32) -> f32 {
  return select(1.055 * pow(c, 1.0 / 2.4) - 0.055, 12.92 * c, c <= 0.0031308);
}

fn toLinear(c: vec3f) -> vec3f {
  return vec3f(channelToLinear(c.r), channelToLinear(c.g), channelToLinear(c.b));
}

fn toEncoded(c: vec3f) -> vec3f {
  return vec3f(channelToEncoded(c.r), channelToEncoded(c.g), channelToEncoded(c.b));
}

fn pixelAt(at: vec2i, size: vec2i) -> vec4f {
  let texel = textureLoad(image, clamp(at, vec2i(0), size - 1), 0);
  return vec4f(toLinear(texel.rgb) * texel.a, texel.a);
}

fn sampleAt(q: vec2f, size: vec2i) -> vec4f {
  let f = q * vec2f(size) - 0.5;
  let corner = floor(f);
  let w = f - corner;
  let i = vec2i(corner);
  let above = mix(pixelAt(i, size), pixelAt(i + vec2i(1, 0), size), w.x);
  let below = mix(pixelAt(i + vec2i(0, 1), size), pixelAt(i + vec2i(1, 1), size), w.x);
  return mix(above, below, w.y);
}

fn keyDistance(encoded: vec3f) -> f32 {
  return distance(vec2f(dot(encoded, CB), dot(encoded, CR)) + CHROMA_OFFSET, settings.key.xy);
}

fn chromaOf(encoded: vec3f) -> vec2f {
  let y = dot(encoded, LUMA);
  return vec2f(encoded.b - y, encoded.r - y) / CHROMA_SCALE;
}

fn fromLumaChroma(y: f32, c: vec2f) -> vec3f {
  let r = y + c.y * CHROMA_SCALE.y;
  let b = y + c.x * CHROMA_SCALE.x;
  return vec3f(r, (y - LUMA.r * r - LUMA.b * b) / LUMA.g, b);
}

fn saturated(rgb: vec3f, s: f32) -> vec3f {
  let top = max(max(rgb.r, rgb.g), rgb.b);
  let spread = top - min(min(rgb.r, rgb.g), rgb.b);
  return top - (top - rgb) * min(s, top / max(spread, 1e-12));
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
  let correction = settings.correction;
  let extras = settings.extras;

  let p = vec2f(select(input.uv.x, 1.0 - input.uv.x, settings.flags.x > 0.5), input.uv.y);
  let pixels = vec2i(textureDimensions(image));

  let sampled = sampleAt(p, pixels);
  var alpha = sampled.a;
  var rgb = select(vec3f(0.0), sampled.rgb / alpha, alpha > 0.0);

  // OBS's filter: the key's distance, and from it the alpha and how much of the colour spill keeps
  let keyed = key.w > 0.5;
  var kept = 1.0;
  if (keyed) {
    let texel = 1.0 / vec2f(pixels);
    let across = vec2f(texel.x, 0.5 * texel.y);
    let up = vec2f(0.5 * texel.x, -texel.y);
    let around = keyDistance(toEncoded(sampleAt(p - across, pixels).rgb))
      + keyDistance(toEncoded(sampleAt(p + across, pixels).rgb))
      + keyDistance(toEncoded(sampleAt(p - up, pixels).rgb))
      + keyDistance(toEncoded(sampleAt(p + up, pixels).rgb));
    let beyond = (2.0 * around + keyDistance(toEncoded(rgb))) / 9.0 - matte.x;
    alpha *= matte.w;
    alpha *= pow(clamp(beyond / matte.y, 0.0, 1.0), 1.5);
    kept = pow(clamp(beyond / matte.z, 0.0, 1.0), 1.5);
  }

  // The add-ons tint and saturation. Spill desaturates to the tinted colour's luma, as it was before saturation
  rgb *= extras.rgb;
  let grey = dot(rgb, LUMA);
  if (extras.w != 1.0) {
    rgb = saturated(rgb, extras.w);
  }

  // The rest of OBS's filter: spill, then gamma, contrast and brightness
  if (keyed) {
    if (settings.switches.y > 0.5) {
      // The add-on, hueSpill
      let encoded = toEncoded(rgb);
      let toward = (key.xy - CHROMA_OFFSET) * key.z;
      var c = chromaOf(encoded);
      c -= toward * max(dot(c, toward), 0.0) * (1.0 - kept);
      rgb = toLinear(clamp(fromLumaChroma(dot(encoded, LUMA), c), vec3f(0.0), vec3f(1.0)));
    } else {
      rgb = mix(vec3f(grey), rgb, kept);
    }
    rgb = pow(max(rgb, vec3f(0.0)), vec3f(correction.x)) * correction.y + correction.z;
  }
  rgb = clamp(rgb, vec3f(0.0), vec3f(1.0));

  // The add-on crop
  if (settings.switches.x > 0.5) {
    alpha *= cutMask(p, size);
  }

  return vec4f(toEncoded(rgb) * alpha, alpha);
}
`
