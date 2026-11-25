/**
 * 主进程 / preload / 渲染进程三方共享的纯类型定义。
 * 该文件不得导入 electron 或 node 模块，确保渲染进程可以安全引用。
 */
import type { MonitorInfo, SerializedDdcError } from '../main/monitor/types'

export type { MonitorInfo, SerializedDdcError }

export interface MonitorConfig {
  id: string
  name: string
  /** 这台电脑连接的接口（VCP 值） */
  thisHostInput: number | null
  /**
   * 另一台电脑连接的接口（VCP 值）。
   * null = 该显示器只接了一台设备，不启用输入源切换。
   * 这是唯一可靠的"是否单设备"判据：DDC/CI 无法探测其它端口有没有插线。
   */
  otherHostInput: number | null
}

export interface AppConfig {
  schemaVersion: number
  monitors: Record<string, MonitorConfig>
  activeMonitorId: string | null
  shortcut: string
  autoLaunch: boolean
  closeToTray: boolean
  /** 切换前把该屏上的窗口搬到另一块屏（需要辅助功能权限，仅 macOS） */
  moveWindowsOnSwitch: boolean
}

export interface SwitchAttempt {
  monitorId: string
  monitorName: string
  targetInput: number | null
  ok: boolean
  error?: SerializedDdcError
}

export interface SwitchResult {
  ok: boolean
  attempts: SwitchAttempt[]
  /** 面向用户的说明：只承诺"指令已发送"，不承诺"画面已切换" */
  message: string
  timestamp: number
}

export interface AppStatePayload {
  platform: string
  arch: string
  isPackaged: boolean
  mock: boolean
  monitors: MonitorInfo[]
  config: AppConfig
  shortcut: { accelerator: string; registered: boolean; error?: string }
  diagnostics: {
    logPath: string
    binaryPath: string
    binaryExists: boolean
    versions: Record<string, string>
  }
  lastResult: SwitchResult | null
  scanning: boolean
  permissions: {
    /** 辅助功能（搬移窗口需要） */
    accessibility: boolean
    /** 是否支持窗口搬移（仅 macOS） */
    windowMoveSupported: boolean
  }
}

export interface AppEvent {
  type: 'busy' | 'scanning' | 'switch-result' | 'state'
  busy?: boolean
  scanning?: boolean
  result?: SwitchResult
  /** 扫描/切换完成后主动推送的完整状态，避免渲染进程停在初始的旧快照上 */
  state?: AppStatePayload
}

export interface SaveShortcutResult {
  state: AppStatePayload
  ok: boolean
  error?: string
}

export interface SwitchResponse {
  state: AppStatePayload
  result: SwitchResult
}
