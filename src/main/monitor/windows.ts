import path from 'node:path'
import { existsSync } from 'node:fs'
import { app } from 'electron'
import { runBinary, serialize } from './exec'
import { DdcError, assertValidInputCode, type DisplayController, type MonitorInfo } from './types'

const LIST_TIMEOUT = 8000
const GET_TIMEOUT = 6000
const SET_TIMEOUT = 10000

/**
 * 自研 C++ helper 的定位规则与 macOS 端一致。
 * Windows 侧不依赖任何第三方 CLI，也不申请管理员权限。
 */
function windowsBinaryPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'bin', 'display-ddc.exe')
  }
  const local = path.join(app.getAppPath(), 'resources', 'bin', 'win32-x64', 'display-ddc.exe')
  return existsSync(local) ? local : local
}

function parseJson<T>(stdout: string, failureMessage: string): T {
  const text = stdout.trim()
  if (!text) {
    throw new DdcError('READ_FAILED', failureMessage, '原生组件没有返回任何内容')
  }
  try {
    return JSON.parse(text) as T
  } catch {
    throw new DdcError('READ_FAILED', failureMessage, `无法解析原生组件输出：${text.slice(0, 160)}`)
  }
}

interface WindowsMonitorJson {
  id?: string
  name?: string
  manufacturer?: string
  model?: string
  ddcAvailable?: boolean
  currentInput?: number | null
  supportedInputs?: number[]
  error?: string
}

export class WindowsDisplayController implements DisplayController {
  readonly platform = 'win32' as const

  private binary(): string {
    return windowsBinaryPath()
  }

  async listMonitors(): Promise<MonitorInfo[]> {
    const { stdout } = await runBinary(this.binary(), ['list', '--json'], {
      timeoutMs: LIST_TIMEOUT,
      failureCode: 'READ_FAILED',
      failureMessage: '无法枚举显示器',
    })

    const raw = parseJson<WindowsMonitorJson[]>(stdout, '无法读取显示器列表')
    if (!Array.isArray(raw)) {
      throw new DdcError('READ_FAILED', '显示器列表格式不正确')
    }

    return raw.map((item, index) => ({
      id: String(item.id ?? `monitor-${index}`),
      name: String(item.name ?? `显示器 ${index + 1}`),
      manufacturer: item.manufacturer,
      model: item.model,
      ddcAvailable: Boolean(item.ddcAvailable),
      currentInput: typeof item.currentInput === 'number' ? item.currentInput : undefined,
      error: item.error,
    }))
  }

  async getInput(monitorId: string): Promise<number> {
    return serialize(monitorId, async () => {
      const { stdout } = await runBinary(this.binary(), ['get-input', '--monitor', monitorId], {
        timeoutMs: GET_TIMEOUT,
        failureCode: 'READ_FAILED',
        failureMessage: '读取输入源失败',
      })
      const parsed = parseJson<{ value?: number }>(stdout, '无法读取输入源')
      if (typeof parsed.value !== 'number') {
        throw new DdcError('READ_FAILED', '原生组件没有返回输入源数值')
      }
      return parsed.value
    })
  }

  async setInput(monitorId: string, inputCode: number): Promise<void> {
    assertValidInputCode(inputCode)
    await serialize(monitorId, async () => {
      await runBinary(this.binary(), ['set-input', '--monitor', monitorId, '--value', String(inputCode)], {
        timeoutMs: SET_TIMEOUT,
        failureCode: 'WRITE_FAILED',
        failureMessage: '写入输入源失败',
      })
    })
  }
}
