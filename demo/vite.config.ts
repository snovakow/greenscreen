import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

// The demo site: the greenscreen app, and the page of checks beside it. Both import the library by its published
// names, which point at its sources here, so they use it as an app that installed it would, with no build between

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url))

export default defineConfig({
  root: here('.'),
  plugins: [react()],
  // Relative asset paths, so the build works from whatever folder it's served from
  base: '',
  resolve: {
    alias: [
      { find: /^@snovakow\/greenscreen$/, replacement: here('../src/index.ts') },
      { find: /^@snovakow\/greenscreen\/react$/, replacement: here('../src/react.tsx') },
      { find: /^@snovakow\/greenscreen\/three$/, replacement: here('../src/three.ts') },
      { find: /^@snovakow\/greenscreen\/three\/webgpu$/, replacement: here('../src/three-webgpu.ts') },
    ],
  },
  // Bundled for the dev server up front, as the checks load them only as they run, and finding them then would reload
  // the page under the checks
  optimizeDeps: {
    include: ['three', 'three/webgpu', 'three/tsl', 'react', 'react-dom/client', 'lil-gui'],
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // three.js, which only the checks load, is in chunks of up to about 730 kB; they aren't split
    chunkSizeWarningLimit: 1500,
    rolldownOptions: {
      input: {
        main: here('index.html'),
        check: here('check/index.html'),
      },
    },
  },
})
