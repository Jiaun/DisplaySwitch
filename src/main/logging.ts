import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

type Level = 'info' | 'warn' | 'error' | 'debug'

const MAX_BYTES = 512 * 1024
const KEEP_LINES = 400

let logDir = ''
let logFile = ''

function ensureInit(): void {
  if (logFile) return
  logDir = path.join(app.getPath('userData'), 'logs')
  logFile = path.join(logDir, 'display-switch.log')
  try {
    fs.mkdirSync(logDir, { recursive: true })
  } catch {
    /* 日志不可写不应阻塞主流程 */
  }
}

function rotateIfNeeded(): void {
  try {
    const stat = fs.statSync(logFile)
    if (stat.size < MAX_BYTES) return
    fs.renameSync(logFile, `${logFile}.1`)
  } catch {
    /* 文件不存在时忽略 */
  }
}

export function log(level: Level, message: string, detail?: unknown): void {
  ensureInit()
  const stamp = new Date().toISOString()
  let line = `[${stamp}] [${level.toUpperCase()}] ${message}`
  if (detail !== undefined) {
    const text = detail instanceof Error ? `${detail.name}: ${detail.message}` : safeStringify(detail)
    if (text) line += ` | ${text}`
  }

  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)

  try {
    rotateIfNeeded()
    fs.appendFileSync(logFile, `${line}\n`, 'utf8')
  } catch {
    /* 忽略写盘失败 */
  }
}

function safeStringify(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

export function getLogPath(): string {
  ensureInit()
  return logFile
}

export function getRecentLines(limit = KEEP_LINES): string[] {
  ensureInit()
  try {
    const content = fs.readFileSync(logFile, 'utf8')
    const lines = content.split(/\r?\n/).filter(Boolean)
    return lines.slice(-limit)
  } catch {
    return []
  }
}

export function exportLog(destination: string): string {
  ensureInit()
  const target = destination.endsWith('.log') || destination.endsWith('.txt')
    ? destination
    : path.join(destination, `display-switch-${Date.now()}.log`)

  const header = [
    '# DisplaySwitch 诊断日志',
    `导出时间: ${new Date().toISOString()}`,
    `应用版本: ${app.getVersion()}`,
    `Electron: ${process.versions.electron} / Node: ${process.versions.node}`,
    `平台: ${process.platform} ${process.arch} (${process.getSystemVersion?.() ?? ''})`,
    `打包状态: ${app.isPackaged ? '已打包' : '开发模式'}`,
    `模拟模式: ${process.env.DISPLAY_SWITCH_MOCK === '1' ? '是' : '否'}`,
    '',
  ].join('\n')

  const body = getRecentLines(5000).join('\n')
  fs.writeFileSync(target, `${header}${body}\n`, 'utf8')
  return target
}
