import { defineConfig } from 'vite'

// The core as a single minified file, for a page with no build step: an ES module to import, greenscreen.min.js, and
// with --mode global a classic script, greenscreen.global.js, that sets window.Greenscreen. tsc has already put the
// unbundled modules in dist, so it's left as it is
export default defineConfig(({ mode }) => {
  const global = mode === 'global'
  return {
    publicDir: false,
    build: {
      outDir: 'dist',
      emptyOutDir: false,
      sourcemap: true,
      minify: true,
      lib: global
        ? { entry: 'src/global.ts', name: 'Greenscreen', formats: ['iife'], fileName: () => 'greenscreen.global.js' }
        : { entry: 'src/index.ts', formats: ['es'], fileName: () => 'greenscreen.min.js' },
      rolldownOptions: { output: { minify: true } },
    },
  }
})
