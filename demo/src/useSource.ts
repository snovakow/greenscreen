import { useCallback, useEffect, useRef, useState } from 'react'

// The element a picture comes from: a video, playing the camera or a video file, or an image
export type SourceElement = HTMLVideoElement | HTMLImageElement

export interface PictureSize {
  width: number
  height: number
}

// A source, and how to let go of what it plays
interface Source {
  element: SourceElement
  release: () => void
}

// What the demo keys: the camera, which it asks for on mount and again on each camera(), or an image or video file
// given to open(). Each comes in an element of its own, made off the page, which takes the last one's place once it
// has a picture. So a camera refused, or a file that won't open, leaves the last picture up and says why in message.
// The newest request wins, and what it replaces is let go of once it's off the page: a camera's stream stops, which
// frees the camera, and a file is unloaded. Returns the element, for the keyer and the preview, and its picture's size
export function useSource() {
  const [source, setSource] = useState<Source | null>(null)
  const [size, setSize] = useState<PictureSize | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const latest = useRef(0)

  // Puts the source up in place of the last, unless a newer request has come since, when it's let go of at once
  const show = useCallback((request: number, next: Source) => {
    if (request !== latest.current) {
      next.release()
      return
    }
    setSource(next)
    setSize(sizeOf(next.element))
    setMessage(null)
  }, [])

  // Says why a request failed, unless a newer one has come since
  const fail = useCallback((request: number, why: string) => {
    if (request === latest.current) setMessage(why)
  }, [])

  const camera = useCallback(() => {
    const request = (latest.current += 1)
    void (async () => {
      let stream: MediaStream
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true })
      } catch (error) {
        console.error(error)
        fail(request, `No camera: ${reason(error)}`)
        return
      }
      const video = videoElement()
      const release = () => {
        for (const track of stream.getTracks()) track.stop()
        video.srcObject = null
      }
      if (request !== latest.current) {
        release()
        return
      }
      video.srcObject = stream
      try {
        await video.play()
      } catch (error) {
        release()
        fail(request, `The camera won't play: ${reason(error)}`)
        return
      }
      show(request, { element: video, release })
    })()
  }, [show, fail])

  // An image, or a video, which loops. A file the browser has no type for may still be a video it can play
  const open = useCallback(
    (file: File) => {
      const request = (latest.current += 1)
      const image = file.type.startsWith('image/')
      if (!image && file.type && !file.type.startsWith('video/')) {
        fail(request, `${file.name} isn't an image or a video`)
        return
      }
      const url = URL.createObjectURL(file)
      const element = image ? new Image() : videoElement()
      const release = () => {
        element.removeAttribute('src')
        if (element instanceof HTMLVideoElement) {
          element.pause()
          element.load()
        }
        URL.revokeObjectURL(url)
      }
      if (element instanceof HTMLVideoElement) element.loop = true
      element.src = url
      void (element instanceof HTMLVideoElement ? element.play() : element.decode()).then(
        () => {
          const [width, height] = dimensions(element)
          if (width && height) {
            show(request, { element, release })
          } else {
            release()
            fail(request, `${file.name} has no picture`)
          }
        },
        () => {
          release()
          fail(request, `${file.name} won't ${image ? 'open' : 'play'} in this browser`)
        },
      )
    },
    [show, fail],
  )

  // The camera to start with. Requests still out when the page goes are let go of as they arrive
  useEffect(() => {
    camera()
    return () => {
      latest.current += 1
    }
  }, [camera])

  // A source is let go of once another has taken its place on the page, or the page has gone
  useEffect(() => {
    if (!source) return undefined
    return () => source.release()
  }, [source])

  const element = source?.element ?? null

  // A video's size again whenever it changes, as a camera's can
  useEffect(() => {
    if (!(element instanceof HTMLVideoElement)) return undefined
    const measure = () => {
      if (element.videoWidth && element.videoHeight) setSize(sizeOf(element))
    }
    element.addEventListener('resize', measure)
    return () => element.removeEventListener('resize', measure)
  }, [element])

  return { element, size, message, camera, open }
}

// Muted, so it can play without a click first
function videoElement() {
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  return video
}

function dimensions(element: SourceElement): [number, number] {
  if (element instanceof HTMLVideoElement) return [element.videoWidth, element.videoHeight]
  return [element.naturalWidth, element.naturalHeight]
}

function sizeOf(element: SourceElement): PictureSize {
  const [width, height] = dimensions(element)
  return { width, height }
}

function reason(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
