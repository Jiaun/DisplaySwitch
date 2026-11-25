import { nativeImage, type NativeImage } from 'electron'

/**
 * 托盘图标在运行时逐像素绘制，不依赖外部二进制资源。
 * 好处：仓库里没有容易漏打包的 .png，图标永远与代码同步；
 * macOS 使用 template image（随深浅色菜单栏自动变色），Windows 使用彩色图标。
 */

type Rgb = [number, number, number]

function sdRoundRect(
  px: number,
  py: number,
  cx: number,
  cy: number,
  halfW: number,
  halfH: number,
  radius: number
): number {
  const qx = Math.abs(px - cx) - (halfW - radius)
  const qy = Math.abs(py - cy) - (halfH - radius)
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0))
  return outside + Math.min(Math.max(qx, qy), 0) - radius
}

interface PaintOptions {
  size: number
  color: Rgb
  /** 显示器轮廓内部是否留空（描边样式） */
  outlined: boolean
}

/** 渲染"显示器"字形：外框 + 支架 + 底座 */
function paintDisplay(options: PaintOptions): Buffer {
  const { size, color, outlined } = options
  const scale = size / 44
  const buffer = Buffer.alloc(size * size * 4)
  const samples = 3
  const [r, g, b] = color

  const screenCx = 22 * scale
  const screenCy = 19 * scale
  const halfW = 16 * scale
  const halfH = 11 * scale
  const radius = 3.5 * scale
  const stroke = 2.6 * scale

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let coverage = 0

      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const px = x + (sx + 0.5) / samples
          const py = y + (sy + 0.5) / samples

          const dScreen = sdRoundRect(px, py, screenCx, screenCy, halfW, halfH, radius)
          let inside = outlined ? Math.abs(dScreen) <= stroke / 2 : dScreen <= 0

          // 支架
          if (!inside) {
            const dStem = sdRoundRect(px, py, screenCx, 32 * scale, 2.2 * scale, 3.2 * scale, 0.6 * scale)
            if (dStem <= 0) inside = true
          }

          // 底座
          if (!inside) {
            const dBase = sdRoundRect(px, py, screenCx, 36.5 * scale, 8.5 * scale, 1.7 * scale, 1.7 * scale)
            if (dBase <= 0) inside = true
          }

          if (inside) coverage += 1
        }
      }

      const alpha = Math.round((coverage / (samples * samples)) * 255)
      const offset = (y * size + x) * 4
      // nativeImage.createFromBitmap 期望 BGRA
      buffer[offset] = b
      buffer[offset + 1] = g
      buffer[offset + 2] = r
      buffer[offset + 3] = alpha
    }
  }

  return buffer
}

function createImage(options: PaintOptions, scaleFactor: number): NativeImage {
  const image = nativeImage.createFromBitmap(paintDisplay(options), {
    width: options.size,
    height: options.size,
    scaleFactor,
  })
  return image
}

/**
 * macOS 菜单栏图标：22pt，2x 用 44px 位图。
 * 只有 alpha 参与着色，因此统一用黑色绘制并标记为 template。
 */
export function createTrayIcon(): NativeImage {
  if (process.platform === 'darwin') {
    const image = createImage({ size: 44, color: [0, 0, 0], outlined: true }, 2)
    image.setTemplateImage(true)
    return image
  }

  if (process.platform === 'win32') {
    return createImage({ size: 32, color: [37, 99, 235], outlined: false }, 1).resize({ width: 16, height: 16 })
  }

  return createImage({ size: 32, color: [37, 99, 235], outlined: false }, 1)
}

/** 托盘需要表示"正在切换"时使用的变体：实心，视觉上更重 */
export function createTrayIconActive(): NativeImage {
  if (process.platform === 'darwin') {
    const image = createImage({ size: 44, color: [0, 0, 0], outlined: false }, 2)
    image.setTemplateImage(true)
    return image
  }
  return createTrayIcon()
}

export function createWindowIcon(): NativeImage {
  return createImage({ size: 256, color: [37, 99, 235], outlined: false }, 1)
}
