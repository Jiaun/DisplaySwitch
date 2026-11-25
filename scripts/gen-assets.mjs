#!/usr/bin/env node
/**
 * 生成应用图标（build/icon.png）。
 *
 * 不依赖任何第三方图形库：自己实现 PNG 编码 + 超采样光栅化，
 * 避免为了一个图标引入 sharp / canvas 这类原生依赖。
 *
 * 用法：node scripts/gen-assets.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// ---------- PNG 编码 ----------

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buffer) {
  let crc = -1
  for (let i = 0; i < buffer.length; i++) crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ -1) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const typeBuffer = Buffer.from(type, 'ascii')
  const crcBuffer = Buffer.alloc(4)
  crcBuffer.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0)
  return Buffer.concat([length, typeBuffer, data, crcBuffer])
}

function encodePng(width, height, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }

  const idat = zlib.deflateSync(raw, { level: 9 })
  return Buffer.concat([signature, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))])
}

// ---------- 几何 ----------

function sdRoundRect(px, py, cx, cy, halfW, halfH, radius) {
  const qx = Math.abs(px - cx) - (halfW - radius)
  const qy = Math.abs(py - cy) - (halfH - radius)
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0))
  return outside + Math.min(Math.max(qx, qy), 0) - radius
}

function pointInTriangle(px, py, ax, ay, bx, by, cx, cy) {
  const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by)
  const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy)
  const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay)
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0
  return !(hasNeg && hasPos)
}

const lerp = (a, b, t) => a + (b - a) * t
const clamp01 = (value) => Math.min(1, Math.max(0, value))

// ---------- 图标绘制 ----------

const SIZE = 1024
const SS = 3 // 每像素超采样 3x3

function renderIcon() {
  const rgba = Buffer.alloc(SIZE * SIZE * 4)

  const top = [0x54, 0x93, 0xff]
  const bottom = [0x17, 0x44, 0xce]
  const arrowBlue = [0x1c, 0x4e, 0xd6]

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      let bgCoverage = 0
      let screenCoverage = 0
      let arrowCoverage = 0
      let standCoverage = 0

      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) / SS
          const py = y + (sy + 0.5) / SS

          const inBg = sdRoundRect(px, py, 512, 512, 470, 470, 232) <= 0
          if (!inBg) continue
          bgCoverage += 1

          const inScreen = sdRoundRect(px, py, 512, 452, 296, 186, 48) <= 0
          if (inScreen) screenCoverage += 1

          const inStand =
            sdRoundRect(px, py, 512, 700, 44, 46, 10) <= 0 ||
            sdRoundRect(px, py, 512, 762, 152, 26, 26) <= 0
          if (inStand) standCoverage += 1

          // 屏内双向箭头，表达"切换"
          if (inScreen) {
            const shaftTop = sdRoundRect(px, py, 512, 410, 108, 21, 21) <= 0
            const headTop = pointInTriangle(px, py, 596, 356, 690, 410, 596, 464)
            const shaftBottom = sdRoundRect(px, py, 512, 496, 108, 21, 21) <= 0
            const headBottom = pointInTriangle(px, py, 428, 442, 334, 496, 428, 550)
            if (shaftTop || headTop || shaftBottom || headBottom) arrowCoverage += 1
          }
        }
      }

      const total = SS * SS
      const bgAlpha = bgCoverage / total
      if (bgAlpha === 0) continue

      const t = clamp01(y / SIZE)
      let r = lerp(top[0], bottom[0], t)
      let g = lerp(top[1], bottom[1], t)
      let b = lerp(top[2], bottom[2], t)

      const screenAlpha = Math.min(1, screenCoverage / Math.max(1, bgCoverage))
      const standAlpha = Math.min(1, standCoverage / Math.max(1, bgCoverage))
      const white = Math.max(screenAlpha, standAlpha)

      if (white > 0) {
        r = lerp(r, 255, white)
        g = lerp(g, 255, white)
        b = lerp(b, 255, white)
      }

      const arrowAlpha = Math.min(1, arrowCoverage / Math.max(1, bgCoverage))
      if (arrowAlpha > 0) {
        r = lerp(r, arrowBlue[0], arrowAlpha)
        g = lerp(g, arrowBlue[1], arrowAlpha)
        b = lerp(b, arrowBlue[2], arrowAlpha)
      }

      const offset = (y * SIZE + x) * 4
      rgba[offset] = Math.round(r)
      rgba[offset + 1] = Math.round(g)
      rgba[offset + 2] = Math.round(b)
      rgba[offset + 3] = Math.round(bgAlpha * 255)
    }
  }

  return encodePng(SIZE, SIZE, rgba)
}

const outDir = path.join(root, 'build')
fs.mkdirSync(outDir, { recursive: true })
const target = path.join(outDir, 'icon.png')
fs.writeFileSync(target, renderIcon())
console.log(`已生成应用图标: ${path.relative(root, target)} (${SIZE}x${SIZE})`)
