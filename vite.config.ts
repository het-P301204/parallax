import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    target: 'es2022',
    // A risk register is a list of an organisation's unmitigated weaknesses
    // with owners' names attached. PARALLAX claims one never leaves the tab it
    // is opened in, and CI enforces the claim by scanning the built bundle for
    // network APIs. Vite's modulepreload polyfill is the only thing it injects
    // that contains a `fetch`, and there are no dynamic imports for it to
    // preload, so dropping it costs nothing and keeps the check honest.
    modulePreload: { polyfill: false },
  },
})
