import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

// An app that installed the package, built as any React app is
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: '',
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true },
})
