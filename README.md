# Greenscreen

A chroma keyer for the browser, on WebGPU or WebGL2. It takes a video, an image or a canvas, keys a colour out of it, and draws the result into a canvas of its own: see-through where the key was, at the picture's own size. It can also mirror the picture, cut it down to a four-cornered shape, and change its colour.

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
keyer.set({ keyColor: 0x28be3c, similarity: 0.4, crop: true, corners })
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
keyer.set({ similarity: 0.4 } satisfies Partial<Settings>)
```

They check under `moduleResolution` `bundler`, `node16` and `nodenext`.

In a worker, give the keyer an `OffscreenCanvas` and type it as one: `new Greenscreen<OffscreenCanvas>(frame, { canvas })`.

## React

```tsx
import { Greenscreen } from '@snovakow/greenscreen/react'

<Greenscreen source={video} settings={{ similarity: 0.4 }} className="picture" />
```

The component renders a `<div>` and puts the keyer's canvas in it, fitted with CSS `object-fit`. Give the `div` a size with `className` or `style`.

Its props are:
- `source`
- `settings`, applied over the defaults
- `backend`
- `paused`, which stops it rendering by itself
- `fit`, `'contain'` by default
- `className` and `style`

Its ref is the keyer. It's `null` until the keyer is made, just after the first render.

`useGreenscreen(source, settings?, { backend, paused })` gives you the same keyer without the component, for drawing its canvas yourself. It returns `null` on the first render, and disposes the keyer when the component unmounts. StrictMode is safe: each mount gets a keyer, and therefore a canvas, of its own.

## three.js

On a mesh, `GreenscreenMaterial` keys its `map` and shows it as `MeshBasicMaterial` would show that map, though it doesn't apply the texture's `offset`, `repeat` or `rotation`:

```js
import { GreenscreenMaterial } from '@snovakow/greenscreen/three'

const map = new THREE.VideoTexture(video)
map.colorSpace = THREE.SRGBColorSpace
const material = new GreenscreenMaterial({ map, settings: { similarity: 0.4 } })
scene.add(new THREE.Mesh(new THREE.PlaneGeometry(16 / 9, 1), material))
```

`GreenscreenNodeMaterial`, from `@snovakow/greenscreen/three/webgpu`, does the same for `WebGPURenderer`, on both of its backends. Both materials take `map` and `settings`, and have `set()`, `reset()` and `settings` like the keyer.

The texture may be in sRGB or have no colour space; it's keyed on its sRGB values either way. In three.js, the GPU decodes an image texture in sRGB before it blends neighbouring texels. So at hard edges the key can differ by a level or two from the core's, which always blends the encoded values.

## Settings

| Setting | Values | Default | What it does |
|---|---|---|---|
| `key` | boolean | `true` | Takes the key colour out. Off, the other settings still apply. |
| `keyColor` | `0xrrggbb` | `0x00ff00` | The colour taken out. One picked from the screen as it's lit keys better than a preset. |
| `similarity` | 0 to 1 | 0.5 | How near the key a colour must be to be taken out. It's a fraction of the key's own distance from grey: 0 takes out only the key, and 1 reaches grey. |
| `smoothness` | 0 to 1 | 0.1 | How far past `similarity` a colour fades back in. |
| `spill` | 0 to 1 | 0.2 | How far past `similarity` the key's tint is taken out of what's kept, which takes a green cast off edges and hair. |
| `flip` | boolean | `false` | Mirrors the picture left to right. |
| `crop` | boolean | `false` | Cuts the picture down to the shape `corners` make. |
| `corners` | four `{ x, y }` | the whole picture | Clockwise from the top left. They're in the picture's coordinates, 0 to 1 with y down, and not mirrored by `flip`. The shape must be convex. |
| `opacity` | 0 to 1 | 1 | |
| `tint` | `0xrrggbb` | `0xffffff` | Multiplies the colour. |
| `saturation` | 0 to 2 | 1 | 0 is grey. |
| `brightness` | −1 to 1 | 0 | |
| `contrast` | −1 to 1 | 0 | About mid-grey, from ×¼ to ×4. |
| `gamma` | −1 to 1 | 0 | An exponent from 2 to ½. |

`DEFAULT_SETTINGS` holds the defaults, `RANGES` the limits and a slider step for each number, and `KEY_COLORS` the presets `green`, `blue` and `magenta`.

How settings are handled:
- **Out of range:** a number outside its range is clamped.
- **Wrong kind:** a value of the wrong kind throws a `TypeError`.
- **Undefined or unknown:** an `undefined` value, or a name that isn't a setting, is ignored. You can pass an app's own settings object as it is.
- **Copied, not kept:** `set()` copies everything it's given, corners included. Changing your object afterwards does nothing until you pass it again.
- **Snapshots:** `keyer.settings` is a frozen snapshot.

## The keyer

```ts
new Greenscreen(source?, { canvas?, backend?, settings?, onLost?, onRestored? })
```

**Construction options:**
- **`source`:** a `<video>`, `<img>`, `<canvas>`, `OffscreenCanvas`, `ImageBitmap`, `ImageData` or `VideoFrame`. You can set it later.
- **`canvas`:** the canvas to draw in. It must be one no context has been taken from. Without it, the keyer makes its own.
- **`backend`:** `'auto'` (the default), `'webgpu'` or `'webgl'`. See [Backends](#backends).
- **`onLost`, `onRestored`:** called when the graphics context or device is lost and when it comes back. The keyer redraws on the next render after it's back.

**Properties:**
- **`canvas`:** where the keyed picture is drawn.
- **`backend`:** `'webgl'`, `'webgpu'`, or `null` until it has one.
- **`initialized`:** a promise that resolves with the backend, or rejects if it can't be had.
- **`ready`:** whether `canvas` holds a picture of the current source.
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

[demo](demo) is the single-camera greenscreen app this package grew out of. It's rebuilt on the React entry, with a lil-gui panel, a preview to pick the key from, and handles to drag the cut's corners. `demo/check` is a page of checks. It keys a test picture with every part of the library the browser can run, on WebGL2 and on WebGPU, and compares each pixel with the keyer worked out on the CPU. Open it in any browser to see whether the library works there.

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

MIT, from version 0.3.0. Before 0.3.0 this repository was an app whose keying shader was ported from OBS Studio, which is GPL-2.0. Those versions aren't covered by this licence, and none of that code is in this package.
