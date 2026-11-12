// hunspell-asm and emscripten-wasm-loader call nanoid 2.x as a function to name their virtual
// files; newer nanoid versions are not callable that way. vite.config.js points their "nanoid"
// here. Only a random name of the given length is needed. CommonJS, like nanoid 2.x.
const ABC = 'useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict'
module.exports = function nanoid(size = 21) {
  const bytes = crypto.getRandomValues(new Uint8Array(size))
  let id = ''
  for (const b of bytes) id += ABC[b & 63]
  return id
}
module.exports.default = module.exports
