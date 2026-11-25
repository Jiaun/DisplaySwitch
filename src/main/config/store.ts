import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { log } from '../logging'
import type { AppConfig, MonitorConfig } from '../../shared/types'

export type { AppConfig, MonitorConfig }

/**
 * 本地配置持久化。
 *
 * 与方案中的 electron-store 等价，但换成零依赖实现：配置就是一个 JSON 文件，
 * 写盘走「临时文件 + rename」保证原子性。这样打包产物里不需要带任何运行时
 * node_modules，安装包更小、也没有 ESM/CJS 兼容隐患。
 */

const DEFAULT_SHORTCUT = 'CommandOrControl+Alt+Shift+S'
const SCHEMA_VERSION = 1
const FILE_NAME = 'config.json'

const defaults: AppConfig = {
  schemaVersion: SCHEMA_VERSION,
  monitors: {},
  activeMonitorId: null,
  shortcut: DEFAULT_SHORTCUT,
  autoLaunch: false,
  closeToTray: true,
  moveWindowsOnSwitch: false,
}

let cache: AppConfig | null = null

function configPath(): string {
  return path.join(app.getPath('userData'), FILE_NAME)
}

function sanitizeInputCode(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 255) return null
  return value
}

function sanitizeMonitor(raw: unknown): MonitorConfig | null {
  if (!raw || typeof raw !== 'object') return null
  const item = raw as Record<string, unknown>
  if (typeof item.id !== 'string' || item.id.length === 0) return null

  return {
    id: item.id,
    name: typeof item.name === 'string' && item.name ? item.name : item.id,
    thisHostInput: sanitizeInputCode(item.thisHostInput),
    otherHostInput: sanitizeInputCode(item.otherHostInput),
  }
}

/** 任何来自磁盘或渲染进程的数据都必须是不可信的，逐字段校验后再合并 */
function normalize(raw: unknown): AppConfig {
  const input = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const monitors: Record<string, MonitorConfig> = {}

  if (input.monitors && typeof input.monitors === 'object') {
    for (const [key, value] of Object.entries(input.monitors as Record<string, unknown>)) {
      const sanitized = sanitizeMonitor(value)
      if (sanitized) monitors[key] = sanitized
    }
  }

  const shortcut =
    typeof input.shortcut === 'string' && /^[A-Za-z0-9+_-]{1,80}$/.test(input.shortcut.trim())
      ? input.shortcut.trim()
      : DEFAULT_SHORTCUT

  return {
    schemaVersion: SCHEMA_VERSION,
    monitors,
    activeMonitorId: typeof input.activeMonitorId === 'string' ? input.activeMonitorId : null,
    shortcut,
    autoLaunch: Boolean(input.autoLaunch),
    closeToTray: input.closeToTray !== false,
    moveWindowsOnSwitch: Boolean(input.moveWindowsOnSwitch),
  }
}

function readFromDisk(): AppConfig {
  try {
    const content = fs.readFileSync(configPath(), 'utf8')
    return normalize(JSON.parse(content))
  } catch {
    // 首次启动或文件损坏时回落到默认值，不让配置问题阻塞应用启动
    return { ...defaults }
  }
}

function writeToDisk(config: AppConfig): void {
  const target = configPath()
  const temp = `${target}.tmp`
  const payload = `${JSON.stringify(config, null, 2)}\n`

  try {
    fs.mkdirSync(path.dirname(target), { recursive: true })
  } catch {
    /* 目录已存在或被限制，继续尝试写文件 */
  }

  // 首选「临时文件 + rename」的原子写，避免断电留下半个 JSON
  try {
    fs.writeFileSync(temp, payload, 'utf8')
    fs.renameSync(temp, target)
    return
  } catch {
    try {
      fs.rmSync(temp, { force: true })
    } catch {
      /* ignore */
    }
  }

  // rename 在某些受限环境（受管设备、沙箱、网络盘）会被拒绝，退回直接覆盖写
  try {
    fs.writeFileSync(target, payload, 'utf8')
  } catch (error) {
    log('error', '配置写入失败，本次修改仅在内存中生效', error)
  }
}

export function getConfig(): AppConfig {
  if (!cache) cache = readFromDisk()
  return { ...cache, monitors: { ...cache.monitors } }
}

/** 只接受白名单字段；渲染进程传来的内容一律视为不可信输入 */
export function saveConfig(patch: unknown): AppConfig {
  if (!patch || typeof patch !== 'object') return getConfig()
  const input = patch as Record<string, unknown>
  const current = getConfig()
  const next: AppConfig = { ...current }

  if (input.monitors && typeof input.monitors === 'object') {
    const monitors: Record<string, MonitorConfig> = {}
    for (const [key, value] of Object.entries(input.monitors as Record<string, unknown>)) {
      const sanitized = sanitizeMonitor(value)
      if (sanitized) monitors[key] = sanitized
    }
    next.monitors = monitors
  }

  if ('activeMonitorId' in input) {
    next.activeMonitorId = typeof input.activeMonitorId === 'string' ? input.activeMonitorId : null
  }

  if (typeof input.shortcut === 'string') {
    const trimmed = input.shortcut.trim()
    if (trimmed && /^[A-Za-z0-9+_-]{1,80}$/.test(trimmed)) next.shortcut = trimmed
  }

  if (typeof input.autoLaunch === 'boolean') next.autoLaunch = input.autoLaunch
  if (typeof input.closeToTray === 'boolean') next.closeToTray = input.closeToTray
  if (typeof input.moveWindowsOnSwitch === 'boolean') next.moveWindowsOnSwitch = input.moveWindowsOnSwitch

  next.schemaVersion = SCHEMA_VERSION
  cache = next
  writeToDisk(next)
  return getConfig()
}

/** 显示器首次被发现时登记进配置，但不覆盖用户已改过的值 */
export function ensureMonitorConfigured(monitorId: string, name: string): MonitorConfig {
  const config = getConfig()
  const existing = config.monitors[monitorId]

  if (!existing) {
    // 新显示器默认不启用切换：DDC 无法判断它是否接了第二台设备，
    // 默认关闭可以避免在单设备显示器上凭空出现输入源切换。
    const created: MonitorConfig = {
      id: monitorId,
      name,
      thisHostInput: null,
      otherHostInput: null,
    }
    saveConfig({ monitors: { ...config.monitors, [monitorId]: created } })
    return created
  }

  if (existing.name !== name) {
    const updated = { ...existing, name }
    saveConfig({ monitors: { ...config.monitors, [monitorId]: updated } })
    return updated
  }

  return existing
}

export function configFilePath(): string {
  return configPath()
}
