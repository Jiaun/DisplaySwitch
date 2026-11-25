/**
 * 共享的显示器类型定义与常量。
 * 该文件同时被主进程与渲染进程引用（仅类型与常量，无 Node 依赖）。
 */

export interface MonitorInfo {
  /** 稳定标识：macOS 为 System UUID，Windows 为显示器设备路径哈希 */
  id: string
  name: string
  manufacturer?: string
  model?: string
  /** DDC/CI 通道是否可用（能读到 VCP 或至少能建立物理句柄） */
  ddcAvailable: boolean
  /** 当前输入源 VCP 0x60 值，读取失败时为 undefined */
  currentInput?: number
  /** 读取失败/写入被拒绝时的原因 */
  error?: string
}

export interface DisplayController {
  readonly platform: string
  listMonitors(): Promise<MonitorInfo[]>
  getInput(monitorId: string): Promise<number>
  setInput(monitorId: string, inputCode: number): Promise<void>
}

/**
 * MCCS 常见输入源取值。注意：这只是"常见映射"，
 * 不同厂商（尤其 LG 使用 input-alt 寻址、部分便携屏）取值不同，
 * 因此 UI 必须允许用户手动输入任意 0-255 的值。
 */
export const COMMON_INPUT_CODES = {
  DP1: 0x0f, // 15
  DP2: 0x10, // 16
  HDMI1: 0x11, // 17
  HDMI2: 0x12, // 18
  USBC: 0x1b, // 27
} as const

export const INPUT_OPTIONS: Array<{ code: number; label: string }> = [
  { code: 15, label: 'DisplayPort 1' },
  { code: 16, label: 'DisplayPort 2' },
  { code: 17, label: 'HDMI 1' },
  { code: 18, label: 'HDMI 2' },
  { code: 27, label: 'USB-C' },
]

/** 已知取值的短名，未知取值回退为十六进制 */
export function inputLabel(code: number | undefined): string {
  if (code === undefined || code === null || Number.isNaN(code)) return '未知'
  const hit = INPUT_OPTIONS.find((option) => option.code === code)
  if (hit) return hit.label
  return `自定义 (0x${code.toString(16).padStart(2, '0')})`
}

/**
 * 启用切换时给出一个对端接口的初始猜测，减少手工配置成本。
 * 只是猜测：用户必须自己确认第二台电脑实际插在哪个口上。
 */
export function guessOtherInput(currentInput: number | undefined): number {
  if (currentInput === COMMON_INPUT_CODES.HDMI1) return COMMON_INPUT_CODES.DP1
  if (currentInput === COMMON_INPUT_CODES.DP1) return COMMON_INPUT_CODES.HDMI1
  if (currentInput === COMMON_INPUT_CODES.HDMI2) return COMMON_INPUT_CODES.DP2
  if (currentInput === COMMON_INPUT_CODES.DP2) return COMMON_INPUT_CODES.HDMI2
  return COMMON_INPUT_CODES.HDMI1
}

export type DdcErrorCode =
  | 'BINARY_MISSING'
  | 'TIMEOUT'
  | 'MONITOR_NOT_FOUND'
  | 'READ_FAILED'
  | 'WRITE_FAILED'
  | 'INVALID_INPUT'
  | 'UNSUPPORTED_PLATFORM'
  | 'NOT_CONFIGURED'
  | 'UNKNOWN'

export interface SerializedDdcError {
  code: DdcErrorCode
  message: string
  detail?: string
}

/** 带分类的可序列化错误，便于渲染进程区分"没插显示器"和"显示器不支持" */
export class DdcError extends Error {
  readonly code: DdcErrorCode
  readonly detail?: string

  constructor(code: DdcErrorCode, message: string, detail?: string) {
    super(message)
    this.name = 'DdcError'
    this.code = code
    this.detail = detail
  }

  toJSON(): SerializedDdcError {
    return { code: this.code, message: this.message, detail: this.detail }
  }
}

export function toSerializedError(error: unknown): SerializedDdcError {
  if (error instanceof DdcError) return error.toJSON()
  if (error instanceof Error) {
    return { code: 'UNKNOWN', message: error.message }
  }
  return { code: 'UNKNOWN', message: String(error) }
}

export function assertValidInputCode(code: unknown): asserts code is number {
  if (typeof code !== 'number' || !Number.isInteger(code) || code < 0 || code > 255) {
    throw new DdcError('INVALID_INPUT', 'VCP 输入源取值必须是 0-255 的整数')
  }
}
