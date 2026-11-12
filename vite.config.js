import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

// hunspell-asm (spelling in other languages) calls nanoid 2.x as a function; package.json moves it
// to a patched nanoid 3, which isn't callable that way, so its imports get a small stand-in
const nanoidShim = {
  name: 'hunspell-nanoid',
  enforce: 'pre',
  resolveId(source, importer) {
    if (source === 'nanoid' && importer && /[\\/](hunspell-asm|emscripten-wasm-loader)[\\/]/.test(importer)) {
      return fileURLToPath(new URL('./src/vendor/nanoid-shim.cjs', import.meta.url))
    }
  },
}

export default defineConfig({
  clearScreen: false,
  plugins: [nanoidShim],
  worker: { plugins: () => [nanoidShim] },
  server: { port: 1420, strictPort: true, watch: { ignored: ['**/src-tauri/**'] } },
  // harper.js finds its WebAssembly file next to itself (new URL(..., import.meta.url)); pre-bundling would break that
  optimizeDeps: { exclude: ['harper.js'], rolldownOptions: { plugins: [nanoidShim] } },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 4000,
    sourcemap: false,
  },
})
