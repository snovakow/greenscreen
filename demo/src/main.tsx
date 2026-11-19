import { warmUp } from '@snovakow/greenscreen/react'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Finds out which backend 'auto' takes, and gets WebGPU's device ready, while the camera starts. Nothing waits for it
warmUp().catch(() => {})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
