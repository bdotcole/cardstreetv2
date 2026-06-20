// Generates app/favicon.ico (multi-resolution: 16/32/48) from public/logo.png.
// Next.js App Router auto-serves app/favicon.ico at /favicon.ico and injects the
// <link rel="icon"> tag, which is what puts the brand mark in the browser tab.
//
// sharp can't encode ICO, so we resize to PNG at each size and pack the ICO
// container ourselves. The Vista+ ICO format permits PNG-compressed entries,
// which every current browser and Windows itself understand.
//
// Run: node scripts/generate-favicon.mjs

import sharp from 'sharp'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(root, 'public', 'logo.png')
const OUT = join(root, 'app', 'favicon.ico')
const SIZES = [16, 32, 48]

const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 }

// The source has wide transparent margins; trimming first lets the card fan
// read clearly even at 16px. A small pad keeps it from touching the edges.
async function renderSize(trimmed, size) {
  const pad = Math.max(1, Math.round(size * 0.06))
  const inner = size - pad * 2
  return sharp(trimmed)
    .resize(inner, inner, { fit: 'contain', background: TRANSPARENT })
    .extend({ top: pad, bottom: pad, left: pad, right: pad, background: TRANSPARENT })
    .png()
    .toBuffer()
}

function buildIco(images) {
  const count = images.length
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: 1 = icon
  header.writeUInt16LE(count, 4)

  const entries = []
  let offset = 6 + count * 16
  for (const { size, data } of images) {
    const entry = Buffer.alloc(16)
    entry.writeUInt8(size >= 256 ? 0 : size, 0) // width (0 means 256)
    entry.writeUInt8(size >= 256 ? 0 : size, 1) // height
    entry.writeUInt8(0, 2)  // palette color count
    entry.writeUInt8(0, 3)  // reserved
    entry.writeUInt16LE(1, 4)   // color planes
    entry.writeUInt16LE(32, 6)  // bits per pixel
    entry.writeUInt32LE(data.length, 8)
    entry.writeUInt32LE(offset, 12)
    entries.push(entry)
    offset += data.length
  }

  return Buffer.concat([header, ...entries, ...images.map((i) => i.data)])
}

const trimmed = await sharp(SRC).trim().toBuffer()
const images = await Promise.all(
  SIZES.map(async (size) => ({ size, data: await renderSize(trimmed, size) }))
)
writeFileSync(OUT, buildIco(images))
console.log(`Wrote ${OUT} (${SIZES.join('/')}px)`)
