// The public types the keyer's API is written in, kept apart from the modules that use them so that the declarations a
// project reads name nothing newer than they must

// Anything the browser can upload as a texture: a video, an image, a canvas, an ImageBitmap, ImageData or a VideoFrame
export type Source = TexImageSource

// The graphics API a keyer draws with
export type BackendName = 'webgl' | 'webgpu'

export type Canvas = HTMLCanvasElement | OffscreenCanvas
