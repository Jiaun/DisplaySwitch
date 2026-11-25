import path from 'node:path'
import { existsSync } from 'node:fs'
import { app } from 'electron'
import { runBinary, serialize } from './exec'
import {
  DdcError,
  assertValidInputCode,
  type DisplayController,
  type MonitorInfo,
} from './types'

interface RawDisplay {
  index: number
  name: string
  uuid: string
  manufacturer?: string
  model?: string
}

const LIST_TIMEOUT = 6000
const READ_TIMEOUT = 5000
const WRITE_TIMEOUT = 8000

/**
 * 所有 DDC 操作共用一条串行队列。
 * 实测：两块屏并行读取时其中一块会返回「无回包」，串行则稳定。
 */
const DDC_QUEUE_KEY = 'm1ddc-ddc-channel'

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * m1ddc 可执行文件定位：
 * - 打包后：<Resources>/bin/m1ddc（由 electron-builder 的 extraResources 放置）
 * - 开发时：项目内 resources/bin/darwin-arm64/m1ddc，其次回退到 Homebrew 版本
 * 生产环境绝不依赖 Homebrew 路径。
 */
function macBinaryPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'bin', 'm1ddc')
  }
  const local = path.join(app.getAppPath(), 'resources', 'bin', 'darwin-arm64', 'm1ddc')
  if (existsSync(local)) return local
  const brew = '/opt/homebrew/bin/m1ddc'
  if (existsSync(brew)) return brew
  return local
}

/** 解析 `m1ddc display list detailed` 的多行输出 */
export function parseDetailedList(stdout: string): RawDisplay[] {
  const displays: RawDisplay[] = []
  let current: RawDisplay | null = null

  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trimEnd()
    if (!line.trim()) continue

    const header = line.match(/^\[(\d+)\]\s*(.+?)\s*\(([^)]+)\)\s*$/)
    if (header) {
      current = {
        index: Number(header[1]),
        name: header[2].trim(),
        uuid: header[3].trim(),
      }
      displays.push(current)
      continue
    }

    const field = line.match(/^\s*-\s*([^:]+):\s*(.*)$/)
    if (field && current) {
      const key = field[1].trim().toLowerCase()
      const value = field[2].trim()
      if (value && value !== '(null)') {
        if (key === 'product name') current.name = value
        else if (key === 'manufacturer') current.manufacturer = value
        else if (key === 'model' && !/^\d+\s*\(0x[0-9a-f]+\)$/i.test(value)) current.model = value
      }
    }
  }

  return displays.filter((display) => display.uuid.length > 0)
}

/** 解析 `m1ddc display list`，只用于把 UUID 映射回当前启动顺序下的索引 */
export function parseSimpleList(stdout: string): RawDisplay[] {
  const displays: RawDisplay[] = []
  for (const line of stdout.split(/\r?\n/)) {
    const match = line.trim().match(/^\[(\d+)\]\s*(.+?)\s*\(([^)]+)\)\s*$/)
    if (match) {
      displays.push({ index: Number(match[1]), name: match[2].trim(), uuid: match[3].trim() })
    }
  }
  return displays
}

export class MacDisplayController implements DisplayController {
  readonly platform = 'darwin' as const

  private binary(): string {
    return macBinaryPath()
  }

  /**
   * 索引在重插线/重启后会漂移，而 UUID 稳定。
   * 因此每次操作前都重新列一遍显示器，用 UUID 换算出当次索引，
   * 避免"多显示器时打错屏"——把另一台电脑的画面切走是很难受的事故。
   */
  private async resolveIndex(monitorId: string): Promise<number> {
    const { stdout } = await runBinary(this.binary(), ['display', 'list'], {
      timeoutMs: LIST_TIMEOUT,
      failureCode: 'READ_FAILED',
      failureMessage: '无法枚举显示器',
    })
    const displays = parseSimpleList(stdout)
    const hit = displays.find((display) => display.uuid === monitorId)
    if (!hit) {
      throw new DdcError('MONITOR_NOT_FOUND', '该显示器当前未连接', `列表中未找到 ${monitorId}`)
    }
    return hit.index
  }

  async listMonitors(): Promise<MonitorInfo[]> {
    const { stdout } = await runBinary(this.binary(), ['display', 'list', 'detailed'], {
      timeoutMs: LIST_TIMEOUT,
      failureCode: 'READ_FAILED',
      failureMessage: '无法枚举显示器',
    })

    const displays = parseDetailedList(stdout)
    if (displays.length === 0) return []

    // 必须串行回读：实测两块屏并行读取时，m1ddc 会让其中一块返回「无回包」，
    // 单块屏单次读取则稳定正确。DDC 通道本身不支持并发访问。
    const monitors: MonitorInfo[] = []
    for (const display of displays) {
      const base: MonitorInfo = {
        id: display.uuid,
        name: display.name || `显示器 ${display.index}`,
        manufacturer: display.manufacturer,
        model: display.model,
        ddcAvailable: true,
      }

      try {
        const value = await this.readInputWithRetry(display.index)
        monitors.push({ ...base, currentInput: value })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        monitors.push({ ...base, error: message })
      }
    }
    return monitors
  }

  /**
   * 回读带重试。实测 VG2781-4K 在空闲一段时间后的第一次读取会返回「无回包」，
   * 紧接着再读就正常（0 → 15）。回读是幂等操作，重试安全；
   * 写入则不重试，避免盲切。
   */
  private async readInputWithRetry(index: number, attempts = 3): Promise<number> {
    let lastError: unknown = null

    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        return await this.readInputByIndex(index)
      } catch (error) {
        lastError = error
        const retriable = error instanceof DdcError && error.code === 'READ_FAILED'
        if (!retriable) throw error
        if (attempt < attempts - 1) await sleep(250 * (attempt + 1))
      }
    }

    throw lastError
  }

  private async readInputByIndex(index: number): Promise<number> {
    return serialize(DDC_QUEUE_KEY, async () => {
      const { stdout } = await runBinary(this.binary(), ['display', String(index), 'get', 'input'], {
        timeoutMs: READ_TIMEOUT,
        failureCode: 'READ_FAILED',
        failureMessage: '读取输入源失败',
      })

      const text = stdout.trim()
      if (!/^\d+$/.test(text)) {
        throw new DdcError('READ_FAILED', '显示器未返回有效的输入源读数', text.slice(0, 120) || undefined)
      }

      const value = Number(text)
      // m1ddc 在收不到 VCP 回包时输出 0，而 0 并不是任何真实输入源
      if (value === 0) {
        throw new DdcError('READ_FAILED', '显示器未返回输入源读数', 'VCP 0x60 无回包，可能支持写入但不支持回读。')
      }
      return value
    })
  }

  async getInput(monitorId: string): Promise<number> {
    const index = await this.resolveIndex(monitorId)
    return this.readInputWithRetry(index)
  }

  async setInput(monitorId: string, inputCode: number): Promise<void> {
    assertValidInputCode(inputCode)
    const index = await this.resolveIndex(monitorId)

    // 与读取共用同一条队列：DDC 写入与回读并发同样会导致无回包
    await serialize(DDC_QUEUE_KEY, async () => {
      await runBinary(this.binary(), ['display', String(index), 'set', 'input', String(inputCode)], {
        timeoutMs: WRITE_TIMEOUT,
        failureCode: 'WRITE_FAILED',
        failureMessage: '写入输入源失败，显示器可能不支持该 VCP 值',
      })
    })
  }
}
