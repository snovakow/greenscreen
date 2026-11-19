import { useCallback, useEffect, useRef, useState } from 'react'

export interface VideoSize {
  width: number
  height: number
}

// Plays the camera in the <video> that takes ref. It asks for the camera on mount and again on each load(); the newest
// request wins, and the stream it replaces stops, which frees the camera. Returns the element as well, for the texture,
// and the video's size once it has one
export function useCamera() {
  // The element twice over: a ref to play streams in, and state for the texture to read as it renders
  const element = useRef<HTMLVideoElement | null>(null)
  const [video, setVideo] = useState<HTMLVideoElement | null>(null)
  const ref = useCallback((node: HTMLVideoElement | null) => {
    element.current = node
    setVideo(node)
  }, [])

  const playing = useRef<MediaStream | null>(null)
  const latest = useRef(0)

  const load = useCallback(() => {
    const request = (latest.current += 1)
    void openCamera().then((stream) => {
      if (!stream) return
      // A request overtaken by a newer one, or still out when the page unmounted, stops as it arrives
      if (request !== latest.current || !element.current) {
        stop(stream)
        return
      }
      if (playing.current) stop(playing.current)
      playing.current = stream
      element.current.srcObject = stream
    })
  }, [])

  useEffect(() => {
    load()
    return () => {
      latest.current += 1
      if (playing.current) stop(playing.current)
      playing.current = null
    }
  }, [load])

  // The size, from the stream's metadata and again whenever the camera changes it
  const [size, setSize] = useState<VideoSize | null>(null)
  useEffect(() => {
    if (!video) return undefined
    const measure = () => {
      if (video.videoWidth && video.videoHeight) setSize({ width: video.videoWidth, height: video.videoHeight })
    }
    video.addEventListener('loadedmetadata', measure)
    video.addEventListener('resize', measure)
    return () => {
      video.removeEventListener('loadedmetadata', measure)
      video.removeEventListener('resize', measure)
    }
  }, [video])

  return { ref, video, size, load }
}

// The camera's stream, or null where there's no camera or no permission to use it, with the reason logged. The page
// then stays black, as the prototype's did
async function openCamera(): Promise<MediaStream | null> {
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: false, video: true })
  } catch (error) {
    console.error(error)
    return null
  }
}

function stop(stream: MediaStream) {
  for (const track of stream.getTracks()) track.stop()
}
