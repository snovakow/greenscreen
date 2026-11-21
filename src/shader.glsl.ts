// The keyer in GLSL ES 3.00. The fragment shader is shared by the WebGL2 renderer and the three.js material, each
// giving it vUv, where the pixel is on the output: 0 to 1 across and down. pack.ts says what's in settings.
//
// First it keys as OBS Studio's chroma key filter does, the filter's second version, in the same steps and order:
//   https://github.com/obsproject/obs-studio/blob/master/plugins/obs-filters/data/chroma_key_filter_v2.effect
// - The picture is sampled as OBS holds a source: premultiplied, in linear light, and blended between pixels in
//   linear light, as OBS's sampler blends its texture. The pixel's own colour is then divided by its alpha.
// - How far a colour's chroma is from the key's is measured on its sRGB values. The measure is blurred: four samples
//   round the pixel, a pixel across and half a pixel down, and half a pixel across and a pixel up, each either way,
//   count twice each, and the pixel itself once, of nine.
// - Past similarity the alpha fades in over smoothness, and the colour is desaturated over spill, each on a curve of
//   power 1.5. Opacity multiplies the alpha, and gamma, contrast and brightness the colour, in linear light. The
//   colour is clamped, as OBS's target of 8 bits a channel holds it.
// The add-ons aren't OBS's. Tint and saturation act inside the filter, once the key's distance is measured, which they
// don't change, and before spill and the colour step: the tint multiplies, OBS's spill takes the tinted colour's luma
// to desaturate to, and saturation scales the colour's HSB saturation. They act with the key off too. hueSpill, where
// it's on, takes the key's hue out of the colour in place of OBS's desaturation, by as much, keeping the colour's luma
// and other hues, on its sRGB values. Crop cuts, and flip mirrors the result. The output is the colour multiplied by
// its alpha
export const FRAGMENT: string = /* glsl */ `precision highp float;
precision highp int;
precision highp sampler2D;

uniform sampler2D image;
uniform vec4 settings[8];

in vec2 vUv;
out vec4 fragColor;

// A colour's Cb and Cr from its sRGB values, as OBS's filter has them: BT.709's, in studio range
const vec3 CB = vec3(-0.100644, -0.338572, 0.439216);
const vec3 CR = vec3(0.439216, -0.398942, -0.040274);
const float CHROMA_OFFSET = 0.501961;
// BT.709's luma, which OBS desaturates to
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
// The scales that take B' − Y' and R' − Y' to BT.709's Pb and Pr, for hueSpill
const vec2 CHROMA_SCALE = vec2(1.8556, 1.5748);

float toLinear(float c) {
  return c <= 0.04045 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4);
}

float toEncoded(float c) {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * pow(c, 1.0 / 2.4) - 0.055;
}

vec3 toLinear(vec3 c) {
  return vec3(toLinear(c.r), toLinear(c.g), toLinear(c.b));
}

vec3 toEncoded(vec3 c) {
  return vec3(toEncoded(c.r), toEncoded(c.g), toEncoded(c.b));
}

// The picture's pixel at a column, and a row from the top, clamped to the picture's edges as OBS's sampler clamps.
// It's premultiplied, in linear light, as OBS holds a source, whichever way the texture holds it
vec4 pixelAt(ivec2 at, ivec2 size) {
  at = clamp(at, ivec2(0), size - 1);
  if (settings[4].y > 0.5) at.y = size.y - 1 - at.y;
  vec4 texel = texelFetch(image, at, 0);
  vec3 rgb = settings[4].w > 0.5 ? texel.rgb : toLinear(texel.rgb);
  return vec4(rgb * texel.a, texel.a);
}

// The picture at q, 0 to 1 across and down it, as OBS's linear sampler gives it: the four pixels round q, blended
vec4 sampleAt(vec2 q, ivec2 size) {
  vec2 f = q * vec2(size) - 0.5;
  vec2 corner = floor(f);
  vec2 w = f - corner;
  ivec2 i = ivec2(corner);
  vec4 above = mix(pixelAt(i, size), pixelAt(i + ivec2(1, 0), size), w.x);
  vec4 below = mix(pixelAt(i + ivec2(0, 1), size), pixelAt(i + ivec2(1, 1), size), w.x);
  return mix(above, below, w.y);
}

// How far a colour's chroma is from the key's, from its sRGB values
float keyDistance(vec3 encoded) {
  return distance(vec2(dot(encoded, CB), dot(encoded, CR)) + CHROMA_OFFSET, settings[0].xy);
}

// hueSpill's: an sRGB colour's Pb and Pr, and the colour again from its luma and those
vec2 chromaOf(vec3 encoded) {
  float y = dot(encoded, LUMA);
  return vec2(encoded.b - y, encoded.r - y) / CHROMA_SCALE;
}

vec3 fromLumaChroma(float y, vec2 c) {
  float r = y + c.y * CHROMA_SCALE.y;
  float b = y + c.x * CHROMA_SCALE.x;
  return vec3(r, (y - LUMA.r * r - LUMA.b * b) / LUMA.g, b);
}

// The add-on saturation: the colour's HSB saturation scaled by s, keeping its hue and its brightest channel. Each
// channel's distance below the brightest scales by s, but no further than takes the dimmest to 0, as saturated as a
// colour can be
vec3 saturated(vec3 rgb, float s) {
  float top = max(max(rgb.r, rgb.g), rgb.b);
  float spread = top - min(min(rgb.r, rgb.g), rgb.b);
  return top - (top - rgb) * min(s, top / max(spread, 1e-12));
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
  vec4 correction = settings[2];
  vec4 extras = settings[3];
  vec4 flags = settings[4];

  // Where this pixel is on the picture, mirrored by flip
  vec2 p = vec2(flags.x > 0.5 ? 1.0 - vUv.x : vUv.x, vUv.y);
  ivec2 pixels = textureSize(image, 0);

  vec4 sampled = sampleAt(p, pixels);
  float alpha = sampled.a;
  vec3 rgb = alpha > 0.0 ? sampled.rgb / alpha : vec3(0.0);

  // OBS's filter: the key's distance, and from it the alpha and how much of the colour spill keeps
  bool keyed = key.w > 0.5;
  float kept = 1.0;
  if (keyed) {
    vec2 texel = 1.0 / vec2(pixels);
    vec2 across = vec2(texel.x, 0.5 * texel.y);
    vec2 up = vec2(0.5 * texel.x, -texel.y);
    float around = keyDistance(toEncoded(sampleAt(p - across, pixels).rgb))
      + keyDistance(toEncoded(sampleAt(p + across, pixels).rgb))
      + keyDistance(toEncoded(sampleAt(p - up, pixels).rgb))
      + keyDistance(toEncoded(sampleAt(p + up, pixels).rgb));
    float beyond = (2.0 * around + keyDistance(toEncoded(rgb))) / 9.0 - matte.x;
    alpha *= matte.w;
    alpha *= pow(clamp(beyond / matte.y, 0.0, 1.0), 1.5);
    kept = pow(clamp(beyond / matte.z, 0.0, 1.0), 1.5);
  }

  // The add-ons tint and saturation. Spill desaturates to the tinted colour's luma, as it was before saturation
  rgb *= extras.rgb;
  float grey = dot(rgb, LUMA);
  if (extras.w != 1.0) rgb = saturated(rgb, extras.w);

  // The rest of OBS's filter: spill, then gamma, contrast and brightness
  if (keyed) {
    if (settings[7].y > 0.5) {
      // The add-on hueSpill: only the part of the colour's chroma that points the key's way comes out
      vec3 encoded = toEncoded(rgb);
      vec2 toward = (key.xy - CHROMA_OFFSET) * key.z;
      vec2 c = chromaOf(encoded);
      c -= toward * max(dot(c, toward), 0.0) * (1.0 - kept);
      rgb = toLinear(clamp(fromLumaChroma(dot(encoded, LUMA), c), 0.0, 1.0));
    } else {
      rgb = mix(vec3(grey), rgb, kept);
    }
    rgb = pow(max(rgb, 0.0), vec3(correction.x)) * correction.y + correction.z;
  }
  rgb = clamp(rgb, 0.0, 1.0);

  // The add-on crop
  if (settings[7].x > 0.5) alpha *= cutMask(p, size);

  if (flags.z < 0.5) rgb = toEncoded(rgb);
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
