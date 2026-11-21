# Greenscreen

A chroma keyer for the browser, on WebGPU or WebGL2. It keys as [OBS Studio](https://obsproject.com)'s chroma key filter does, and takes the filter's settings in OBS's units, so a key tuned in OBS can be copied across as it is. It takes a video, an image or a canvas, keys a colour out of it, and draws the result into a canvas of its own: see-through where the key was, at the picture's own size.

It also has add-ons of its own, which OBS's filter doesn't have. They can take only the key's hue out of edges, mirror the picture, cut it down to a four-cornered shape, and tint it or change its saturation.

It has no dependencies, and it works on its own from plain JavaScript, from TypeScript with its own types, from React, and in three.js scenes.

```sh
npm install @snovakow/greenscreen
```

| Import | For | Needs |
|---|---|---|
| `@snovakow/greenscreen` | Plain JavaScript and TypeScript | nothing |
| `@snovakow/greenscreen/react` | The `<Greenscreen>` component and `useGreenscreen` hook | React 18 or later |
| `@snovakow/greenscreen/three` | `GreenscreenMaterial`, for three.js's `WebGLRenderer` | three.js r170 or later |
| `@snovakow/greenscreen/three/webgpu` | `GreenscreenNodeMaterial`, for three.js's `WebGPURenderer` | three.js r170 or later |

The package is ES modules only. React and three.js are optional peer dependencies: install whichever you use.

## Plain JavaScript

```js
import { Greenscreen } from '@snovakow/greenscreen'

const video = document.querySelector('video')
video.srcObject = await navigator.mediaDevices.getUserMedia({ video: true })
await video.play()

const keyer = new Greenscreen(video)
document.body.append(keyer.canvas)
keyer.start()
```

Green is keyed out by default. `start()` renders on every animation frame. If your page already has a loop, call `keyer.render()` from it instead.

The keyer draws into `keyer.canvas`. That canvas keeps its picture between renders, so you can show it on the page, or draw it into another canvas with `drawImage` at any time, for example to composite or record it. Its colours are premultiplied by alpha, which is what `drawImage` expects.

To change the key, call `set()` with the settings to change:

```js
keyer.set({ keyColor: 0x28be3c, similarity: 300, crop: true, corners })
```

### Without a build step

Two more builds are in `dist`, each the whole core in one file:

```html
<!-- An ES module -->
<script type="module">
  import { Greenscreen } from './greenscreen.min.js'
</script>

<!-- A classic script, which sets window.Greenscreen -->
<script src="./greenscreen.global.js"></script>
<script>
  const keyer = new Greenscreen(video, { settings: { keyColor: Greenscreen.KEY_COLORS.blue } })
</script>
```

The global build puts `DEFAULT_SETTINGS`, `KEY_COLORS`, `RANGES` and `warmUp` on `Greenscreen` itself. An import map can also point the package's name at `dist/index.js`, as [examples/plain](examples/plain) does.

## TypeScript

The package ships its own declarations, and the settings and the API are fully typed:

```ts
import { Greenscreen, RANGES } from '@snovakow/greenscreen'
import type { Settings } from '@snovakow/greenscreen'

const keyer = new Greenscreen(video, { backend: 'webgl' })
const { min, max, step } = RANGES.similarity
keyer.set({ similarity: 450 } satisfies Partial<Settings>)
```

They check under `moduleResolution` `bundler`, `node16` and `nodenext`.

In a worker, give the keyer an `OffscreenCanvas` and type it as one: `new Greenscreen<OffscreenCanvas>(frame, { canvas })`.

## React

```tsx
import { Greenscreen } from '@snovakow/greenscreen/react'

<Greenscreen source={video} settings={{ similarity: 450 }} className="picture" />
```

The component renders a `<div>` and puts the keyer's canvas in it, fitted with CSS `object-fit`. Give the `div` a size with `className` or `style`.

Its props are:
- `source`
- `settings`, applied over the defaults
- `backend`
- `paused`, which stops it rendering by itself
- `onError`, as the keyer's, which can be a new function on each render
- `fit`, `'contain'` by default
- `className` and `style`

Its ref is the keyer. It's `null` until the keyer is made, just after the first render.

`useGreenscreen(source, settings?, { backend, paused, onError })` gives you the same keyer without the component, for drawing its canvas yourself. It returns `null` on the first render, and disposes the keyer when the component unmounts. StrictMode is safe: each mount gets a keyer, and therefore a canvas, of its own.

## three.js

On a mesh, `GreenscreenMaterial` keys its `map` and shows it as `MeshBasicMaterial` would show that map, though it doesn't apply the texture's `offset`, `repeat` or `rotation`:

```js
import { GreenscreenMaterial } from '@snovakow/greenscreen/three'

const map = new THREE.VideoTexture(video)
map.colorSpace = THREE.SRGBColorSpace
const material = new GreenscreenMaterial({ map, settings: { similarity: 450 } })
scene.add(new THREE.Mesh(new THREE.PlaneGeometry(16 / 9, 1), material))
```

`GreenscreenNodeMaterial`, from `@snovakow/greenscreen/three/webgpu`, does the same for `WebGPURenderer`, on both of its backends. Both materials take `map` and `settings`, and have `set()`, `reset()` and `settings` like the keyer.

The texture may be in sRGB or have no colour space. Either way it's keyed as OBS would key a picture of those sRGB values drawn at the mesh's size on screen. The materials read the texture's pixels and blend them themselves, in linear light as OBS's sampler does, so they use no mipmaps. Where the GPU decodes a texture in sRGB, it's a little less precise than the core, so a steep fade can differ from the core's by several levels at hard edges.

## Settings

The settings are OBS's for its chroma key filter, in OBS's units, ranges and defaults, followed by the add-ons, which are the library's own. The numbers in OBS's filter dialog can be copied across as they are.

### OBS's chroma key filter

| Setting | In OBS | Values | Default | What it does |
|---|---|---|---|---|
| `key` | The filter's eye | boolean | `true` | Runs the filter. Off, the picture passes through it unchanged, and only the add-ons apply. |
| `keyColor` | Key Color Type, Key Color | `0xrrggbb` | `0x00ff00` | The colour taken out. |
| `similarity` | Similarity | 1 to 1000 | 400 | How near the key a colour must be to be taken out. |
| `smoothness` | Smoothness | 1 to 1000 | 80 | How far past `similarity` a colour fades back in. |
| `spill` | Key Color Spill Reduction | 1 to 1000 | 100 | How far past `similarity` a colour that's kept is desaturated, which takes the key's cast off edges. |
| `opacity` | Opacity | 0 to 1 | 1 | |
| `contrast` | Contrast | −4 to 4 | 0 | A factor from ⅕ to 5. |
| `brightness` | Brightness | −1 to 1 | 0 | Added to the colour. |
| `gamma` | Gamma | −1 to 1 | 0 | An exponent from 2 to ½. |

`KEY_COLORS` holds OBS's three presets: `green` is `0x00ff00`, `blue` is `0x0099ff` and `magenta` is `0xff00ff`. Any other colour is OBS's Custom Color. OBS stores colours as `0xbbggrr`, so a Key Color read from OBS's own files has its red and blue the other way round: OBS's blue, `0xFF9900`, is `0x0099ff` here.

`similarity`, `smoothness` and `spill` are whole numbers, as in OBS, and any other number is rounded to the nearest.

### Add-ons

The add-ons are the library's own, and not in OBS. At their defaults they change nothing. `flip` and `crop` act on the picture OBS's filter gives. `tint`, `saturation` and `hueSpill` act inside the filter, between its steps or in place of one; [How it keys](#how-it-keys) says where.

| Setting | Values | Default | What it does |
|---|---|---|---|
| `hueSpill` | boolean | `false` | Makes spill take out only the key's hue, where OBS's spill desaturates the whole colour. Each colour keeps its luma and its other hues, so a green cast comes off edges and hair, and skin and hair keep their own colour. It reaches as far as `spill`, and takes out as much of the key's hue as OBS would take of the colour. A colour that's near the key itself turns toward its other hues rather than grey: at OBS's defaults, cyan turns sky blue and olive brown. |
| `flip` | boolean | `false` | Mirrors the keyed picture left to right. |
| `crop` | boolean | `false` | Cuts the picture down to the shape `corners` make. |
| `corners` | four `{ x, y }` | the whole picture | Clockwise from the top left. They're in the picture's coordinates, 0 to 1 with y down, and not mirrored by `flip`. The shape must be convex. |
| `tint` | `0xrrggbb` | `0xffffff` | Multiplies the colour, in linear light. It acts once the key's distance is measured, so it doesn't change what's keyed, and before spill, gamma, contrast and brightness. |
| `saturation` | 0 to 2 | 1 | Scales the colour's HSB saturation, in linear light, keeping its hue and its brightest channel, after `tint` and before spill. 0 turns a colour to the grey of its brightest channel. No colour goes past full saturation, where its dimmest channel is 0. |

`DEFAULT_SETTINGS` holds the defaults, and `RANGES` the limits and a slider step for each number: OBS's sliders' own, for OBS's settings.

How settings are handled:
- **Out of range:** a number outside its range is clamped.
- **Wrong kind:** a value of the wrong kind throws a `TypeError`.
- **Undefined or unknown:** an `undefined` value, or a name that isn't a setting, is ignored. You can pass an app's own settings object as it is.
- **Copied, not kept:** `set()` copies everything it's given, corners included. Changing your object afterwards does nothing until you pass it again.
- **Snapshots:** `keyer.settings` is a frozen snapshot.

### How it keys

The keyer does what OBS's filter does, the filter's [second version](https://github.com/obsproject/obs-studio/blob/master/plugins/obs-filters/data/chroma_key_filter_v2.effect), in the same order, with two of the add-ons between its steps:

1. **The picture** is read as OBS holds a source: premultiplied, in linear light, and blended between pixels in linear light. Each pixel's own colour is then divided by its alpha.
2. **The distance from the key** is measured between colours' Cb and Cr, as BT.709 has them in studio range, worked out from their sRGB values. It's blurred, out of nine: the pixel itself counts once, and four samples round it count twice each. The samples are one pixel across and half a pixel down, and half a pixel across and one pixel up, each both ways. The settings count in thousandths of this distance, so a `similarity` of 400 is 0.4.
3. **The add-ons `tint` and `saturation`**, which aren't OBS's, act on the colour: the tint multiplies it, then saturation scales its HSB saturation. With `key` off, they act all the same, and the filter's own steps don't.
4. **Past `similarity`,** the alpha comes in over `smoothness`, and the colour comes back from grey over `spill`, each as the 1.5 power of the way across. Grey is the colour's BT.709 luma, after `tint` and before `saturation`. `opacity` multiplies the alpha.
5. **The colour** is raised to `gamma`'s exponent and multiplied by `contrast`'s factor, and `brightness` is added, all in linear light. Then it's clamped.

After that `crop` cuts the picture down, and the colour is encoded to sRGB for the canvas. `flip` mirrors the whole of it. With `hueSpill` on, step 4 takes out only the key's hue rather than greying the colour. It works on the colour's sRGB values, in BT.709's Pb and Pr. The part of the colour's chroma that points the key's way from grey comes out, by as much as OBS would grey it, and its luma is kept.

The one difference from OBS is the browser's. A page blends a see-through canvas into what's behind it on sRGB values, where OBS blends a source into its scene in linear light. So a partly see-through pixel mixes differently with what's behind it: at soft edges, and all over at an `opacity` below 1. Opaque pixels come out the same.

## The keyer

```ts
new Greenscreen(source?, { canvas?, backend?, settings?, onLost?, onRestored?, onError? })
```

**Construction options:**
- **`source`:** a `<video>`, `<img>`, `<canvas>`, `OffscreenCanvas`, `ImageBitmap`, `ImageData` or `VideoFrame`. You can set it later. An animated image, such as a GIF, is keyed as a still. For motion, use a video, or set each frame as the source as a `VideoFrame`, which `ImageDecoder` can decode.
- **`canvas`:** the canvas to draw in. It must be one no context has been taken from. Without it, the keyer makes its own.
- **`backend`:** `'auto'` (the default), `'webgpu'` or `'webgl'`. See [Backends](#backends).
- **`onLost`, `onRestored`:** called when the graphics context or device is lost and when it comes back. The keyer redraws on the next render after it's back.
- **`onError`:** called once for each picture that can't be keyed, with what was thrown. That's a `RangeError` for a picture wider or taller than the GPU's textures go, often 8192 or 16384 pixels, and a `SecurityError` for one from another site without CORS. The canvas is left see-through until a picture can be keyed. Without `onError`, the keyer warns in the console. It isn't called for a source with no picture yet, such as a video still loading, or for a backend that can't be had, which `initialized` reports.

**Properties:**
- **`canvas`:** where the keyed picture is drawn.
- **`backend`:** `'webgl'`, `'webgpu'`, or `null` until it has one.
- **`initialized`:** a promise that resolves with the backend, or rejects if it can't be had.
- **`ready`:** whether `canvas` holds a picture of the current source. It's false while the source's picture can't be keyed; see `onError`.
- **`frame`:** counts the pictures drawn.
- **`settings`:** the current settings.
- **`source`:** can be read and set.

**Methods:**
- **`render()`:** draws, but only when there's something new: a video frame, a changed setting, a new source or size. It's cheap to call on every frame, and returns `ready`.
- **`start()`, `stop()`:** render on every animation frame, and stop.
- **`set(patch)`, `reset()`:** change settings, or go back to the defaults.
- **`invalidate()`:** takes the picture again on the next render. Only an `ImageBitmap`, `ImageData` or `VideoFrame` whose pixels you've changed needs it. Videos are watched for new frames, an image for a new `src`, and a canvas is taken again on every render, as nothing says when it's been drawn on.
- **`dispose()`:** frees the context or device's resources at once. The keyer and its canvas can't be used again.

### Backends

`'auto'` chooses WebGPU where the browser has a GPU adapter for it, and WebGL2 elsewhere. A fallback adapter, which runs WebGPU on the CPU, doesn't count, as WebGL2 is then likely on the GPU. Ask for one by name with `backend: 'webgpu'` or `backend: 'webgl'`.

A keyer draws nothing until it has its backend:
- A WebGL2 keyer has it at once.
- A WebGPU keyer has it once the device is ready.
- An `'auto'` keyer has it once it's known which to take.

So call `warmUp()` early on, and keyers made after it has resolved draw from their first render. It resolves with the backend `'auto'` comes to. `warmUp('webgpu')` gets WebGPU ready, and rejects where WebGPU isn't available.

Every WebGPU keyer on a page shares one device. A WebGL2 keyer has a context of its own, and browsers allow a page only so many, about 16 in Chrome, so dispose keyers you're finished with.

## Demo and checks

[demo](demo) is a greenscreen app built on the React entry. It keys the camera, or an image or video you open with File or drop on the page, which stays in your browser. It has a lil-gui panel, with OBS's controls under OBS's names in one folder and the add-ons in another, a preview to pick the key from, and handles to drag the cut's corners. `demo/check` is a page of checks. It holds the defaults, ranges and presets to OBS's, keys a test picture with every part of the library the browser can run, on WebGL2 and on WebGPU, and compares each pixel with the keyer worked out on the CPU. Open it in any browser to see whether the library works there.

To work on the library, you need [Node.js](https://nodejs.org) 22.12 or later. In a clone:

```sh
npm install
npm run dev            # the demo, with the library from its sources
npm test               # the checks and the demo, in headless Chrome
npm run test:examples  # the packed package in the plain, TypeScript and React examples
npm run probe          # what this machine's Chrome offers: WebGL2, and WebGPU's adapters
```

The checks run in Chrome twice, once on the machine's GPU and once on SwiftShader, its software renderer. Set `CHROME` to use another Chrome. `npm run build` makes the package in `dist` and the demo site in `demo/dist`. `npm run typecheck` and `npm run lint` check the code.

## Licence

MIT. The keying follows the maths of OBS Studio's chroma key filter, and the credit for it is OBS's. OBS Studio is GPL-2.0-or-later. The library's code is its own, and none of OBS's code is in this package.
