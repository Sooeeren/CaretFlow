import { defineConfig } from 'vite'

export default defineConfig({
  clearScreen: false,
  server: { port: 1420, strictPort: true, watch: { ignored: ['**/src-tauri/**'] } },
  // harper.js finds its WebAssembly file next to itself (new URL(..., import.meta.url)); pre-bundling would break that
  optimizeDeps: { exclude: ['harper.js'] },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 4000,
    sourcemap: false,
  },
})
