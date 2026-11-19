// The keyer in GLSL ES 3.00. The fragment shader is shared by the WebGL2 renderer and the three.js material, each
// giving it vUv, where the pixel is on the output: 0 to 1 across and down. settings.ts says what's in settings.
//
// It works on the picture's sRGB values throughout, as they come. The key is a distance in the Pb–Pr plane of BT.709,
// as a fraction of the key's own distance from grey, steadied against noise by the 2×2 blocks diagonally round each
// pixel. Spill takes the component along the key's direction out of the colour's chroma, keeping its luma. The tint
// multiplies, saturation mixes with luma, and gamma, contrast (about mid-grey) and brightness follow, in that order.
// The output is that colour multiplied by its alpha
export const FRAGMENT: string = /* glsl */ `precision highp float;
precision highp int;
precision highp sampler2D;

uniform sampler2D image;
uniform vec4 settings[8];

in vec2 vUv;
out vec4 fragColor;

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
const vec2 CHROMA_SCALE = vec2(1.8556, 1.5748);

float luma(vec3 c) {
  return dot(c, LUMA);
}

// Pb and Pr, each from -0.5 to 0.5
vec2 chroma(vec3 c) {
  float y = luma(c);
  return vec2(c.b - y, c.r - y) / CHROMA_SCALE;
}

vec3 fromLumaChroma(float y, vec2 c) {
  float r = y + c.y * CHROMA_SCALE.y;
  float b = y + c.x * CHROMA_SCALE.x;
  return vec3(r, (y - LUMA.r * r - LUMA.b * b) / LUMA.g, b);
}

vec3 toLinear(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}

vec3 toEncoded(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

// The picture's sRGB values at t, whichever way its texture holds them
vec4 fetch(vec2 t) {
  vec4 texel = texture(image, t);
  if (settings[4].w > 0.5) texel.rgb = toEncoded(texel.rgb);
  return texel;
}

float keyDistance(vec3 c) {
  return length(chroma(c) - settings[0].xy) * settings[0].z;
}

// 0 below 0 and 1 past width, smoothly between
float ramp(float x, float width) {
  float t = clamp(x / max(width, 1e-5), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

// How far inside the cut's side from a to b the point p is, in output pixels. The points are in the picture's
// coordinates, and size scales them to output pixels once they're subtracted, so a short side between two corners
// close together keeps its direction. Two corners together leave no side, and a triangle
float cutSide(vec2 a, vec2 b, vec2 p, vec2 size) {
  vec2 side = (b - a) * size;
  float len = length(side);
  if (len == 0.0) return 1.0e6;
  vec2 q = (p - a) * size;
  return (q.y * side.x - q.x * side.y) / len;
}

// 1 inside the cut, 0 outside, and between across the output pixel a side passes through, so its edges are smooth at
// any size. The corners must make a convex shape, which a point is inside where it is inside all of its sides. They
// go clockwise, which puts the inside of each side on its right
float cutMask(vec2 p, vec2 size) {
  vec2 c0 = settings[5].xy;
  vec2 c1 = settings[5].zw;
  vec2 c2 = settings[6].xy;
  vec2 c3 = settings[6].zw;
  float d = min(
    min(cutSide(c0, c1, p, size), cutSide(c1, c2, p, size)),
    min(cutSide(c2, c3, p, size), cutSide(c3, c0, p, size))
  );
  return clamp(d + 0.5, 0.0, 1.0);
}

void main() {
  // Output pixels to the picture's width and height, for the cut's soft edge
  vec2 size = 1.0 / max(fwidth(vUv), vec2(1e-6));
  vec4 key = settings[0];
  vec4 matte = settings[1];
  vec4 colour = settings[2];
  vec4 tone = settings[3];
  vec4 flags = settings[4];

  // Where this pixel is on the picture, mirrored by flip, and where that is in the texture
  vec2 p = vec2(flags.x > 0.5 ? 1.0 - vUv.x : vUv.x, vUv.y);
  vec2 t = flags.y > 0.5 ? vec2(p.x, 1.0 - p.y) : p;

  vec4 texel = fetch(t);
  vec3 rgb = texel.rgb;
  float alpha = texel.a * matte.w;
  if (tone.w > 0.5) alpha *= cutMask(p, size);

  if (key.w > 0.5) {
    vec2 h = 0.5 / vec2(textureSize(image, 0));
    float near = keyDistance(fetch(t - h).rgb) + keyDistance(fetch(t + h).rgb)
      + keyDistance(fetch(t + vec2(h.x, -h.y)).rgb) + keyDistance(fetch(t + vec2(-h.x, h.y)).rgb);
    float beyond = 0.5 * keyDistance(rgb) + 0.125 * near - matte.x;
    alpha *= ramp(beyond, matte.y);
    float amount = 1.0 - ramp(beyond, matte.z);
    if (amount > 0.0) {
      vec2 direction = key.xy * key.z;
      vec2 c = chroma(rgb);
      c -= direction * max(dot(c, direction), 0.0) * amount;
      rgb = fromLumaChroma(luma(rgb), c);
    }
  }

  rgb *= colour.rgb;
  rgb = mix(vec3(luma(rgb)), rgb, colour.w);
  rgb = pow(max(rgb, 0.0), vec3(tone.x));
  rgb = (rgb - 0.5) * tone.y + 0.5 + tone.z;
  rgb = clamp(rgb, 0.0, 1.0);
  if (flags.z > 0.5) rgb = toLinear(rgb);
  fragColor = vec4(rgb * alpha, alpha);
}
`

// One triangle over the whole canvas, its corners made from their index, so there's nothing to upload
export const VERTEX: string = /* glsl */ `#version 300 es
out vec2 vUv;
void main() {
  vec2 position = vec2(float((gl_VertexID & 1) << 2) - 1.0, float((gl_VertexID & 2) << 1) - 1.0);
  vUv = vec2(position.x + 1.0, 1.0 - position.y) * 0.5;
  gl_Position = vec4(position, 0.0, 1.0);
}
`
