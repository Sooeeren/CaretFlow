// A small ZIP writer for the office and e-book exports (.docx, .odt and .epub are ZIP files).
// Entries are deflated with the browser's CompressionStream where it exists, else stored; an
// entry can ask to be stored (EPUB and ODT need their `mimetype` file first and uncompressed).

const CRC = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(data) {
  let c = 0xffffffff
  for (let i = 0; i < data.length; i++) c = CRC[(c ^ data[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

async function deflate(data) {
  if (typeof CompressionStream === 'undefined') return null
  try {
    const s = new Blob([data]).stream().pipeThrough(new CompressionStream('deflate-raw'))
    return new Uint8Array(await new Response(s).arrayBuffer())
  } catch {
    return null // deflate-raw is missing in older WebKitGTK: store instead
  }
}

const enc = new TextEncoder()

/**
 * @param files [{ name, data: string | Uint8Array, store?: boolean }] in the order they go into the file
 * @returns Uint8Array with the ZIP file
 */
export async function zip(files) {
  const chunks = []
  const central = []
  let offset = 0
  // DOS time: one fixed timestamp keeps exports of the same text byte-identical
  const time = 0
  const date = ((2026 - 1980) << 9) | (1 << 5) | 1
  for (const f of files) {
    const name = enc.encode(f.name)
    const raw = typeof f.data === 'string' ? enc.encode(f.data) : f.data
    const crc = crc32(raw)
    let body = raw
    let method = 0
    if (!f.store && raw.length > 64) {
      const d = await deflate(raw)
      if (d && d.length < raw.length) {
        body = d
        method = 8
      }
    }
    const head = new DataView(new ArrayBuffer(30))
    head.setUint32(0, 0x04034b50, true)
    head.setUint16(4, 20, true)
    head.setUint16(6, 0x0800, true) // UTF-8 names
    head.setUint16(8, method, true)
    head.setUint16(10, time, true)
    head.setUint16(12, date, true)
    head.setUint32(14, crc, true)
    head.setUint32(18, body.length, true)
    head.setUint32(22, raw.length, true)
    head.setUint16(26, name.length, true)
    head.setUint16(28, 0, true)
    chunks.push(new Uint8Array(head.buffer), name, body)

    const cd = new DataView(new ArrayBuffer(46))
    cd.setUint32(0, 0x02014b50, true)
    cd.setUint16(4, 20, true)
    cd.setUint16(6, 20, true)
    cd.setUint16(8, 0x0800, true)
    cd.setUint16(10, method, true)
    cd.setUint16(12, time, true)
    cd.setUint16(14, date, true)
    cd.setUint32(16, crc, true)
    cd.setUint32(20, body.length, true)
    cd.setUint32(24, raw.length, true)
    cd.setUint16(28, name.length, true)
    cd.setUint32(42, offset, true)
    central.push(new Uint8Array(cd.buffer), name)
    offset += 30 + name.length + body.length
  }
  const cdSize = central.reduce((n, c) => n + c.length, 0)
  const end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, 0x06054b50, true)
  end.setUint16(8, files.length, true)
  end.setUint16(10, files.length, true)
  end.setUint32(12, cdSize, true)
  end.setUint32(16, offset, true)
  const all = [...chunks, ...central, new Uint8Array(end.buffer)]
  const out = new Uint8Array(all.reduce((n, c) => n + c.length, 0))
  let p = 0
  for (const c of all) {
    out.set(c, p)
    p += c.length
  }
  return out
}
