import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { getController, isMockMode } from './monitor/controller'
import { DdcError, assertValidInputCode, toSerializedError, type MonitorInfo } from './monitor/types'
import { getConfig, saveConfig } from './config/store'
import { refreshMonitors, switchToOther, testConfiguration, type SwitchResult } from './services'
import type { AppStatePayload } from '../shared/types'
import {
  hasAccessibilityPermission,
  isWindowMoveSupported,
  moveWindowsOffDisplay,
  openAccessibilitySettings,
  requestAccessibilityPermission,
} from './window-mover'
import { exportLog, getLogPath, getRecentLines, log } from './logging'

export type { AppStatePayload }

export interface IpcHooks {
  /** 配置变化后重建托盘菜单 */
  onConfigChanged: () => void
  /** 应用新的全局快捷键，返回是否成功 */
  applyShortcut: (accelerator: string) => { ok: boolean; error?: string }
  /** 同步开机自启到系统 */
  applyAutoLaunch: (enabled: boolean) => void
}

interface RuntimeState {
  monitors: MonitorInfo[]
  lastResult: SwitchResult | null
  scanning: boolean
  shortcutError?: string
}

const runtime: RuntimeState = {
  monitors: [],
  lastResult: null,
  scanning: false,
}

let hooks: IpcHooks | null = null

function binaryPathForDiagnostics(): string {
  const name = process.platform === 'win32' ? 'display-ddc.exe' : 'm1ddc'
  if (app.isPackaged) return path.join(process.resourcesPath, 'bin', name)
  const sub = process.platform === 'win32' ? 'win32-x64' : 'darwin-arm64'
  return path.join(app.getAppPath(), 'resources', 'bin', sub, name)
}

export function buildState(): AppStatePayload {
  const config = getConfig()
  const binaryPath = binaryPathForDiagnostics()
  let binaryExists = false
  try {
    binaryExists = fs.existsSync(binaryPath)
  } catch {
    binaryExists = false
  }

  return {
    platform: process.platform,
    arch: process.arch,
    isPackaged: app.isPackaged,
    mock: isMockMode(),
    monitors: runtime.monitors,
    config,
    shortcut: {
      accelerator: config.shortcut,
      registered: !runtime.shortcutError,
      error: runtime.shortcutError,
    },
    diagnostics: {
      logPath: getLogPath(),
      binaryPath,
      binaryExists,
      versions: {
        app: app.getVersion(),
        electron: process.versions.electron ?? '',
        node: process.versions.node ?? '',
        chrome: process.versions.chrome ?? '',
      },
    },
    lastResult: runtime.lastResult,
    scanning: runtime.scanning,
    permissions: {
      accessibility: hasAccessibilityPermission(),
      windowMoveSupported: isWindowMoveSupported(),
    },
  }
}

export function setShortcutError(error?: string): void {
  runtime.shortcutError = error
}

export function setLastResult(result: SwitchResult | null): void {
  runtime.lastResult = result
}

/**
 * 把成功的切换结果同步进显示器缓存。
 * VCP 0x60 写入成功意味着显示器的输入源寄存器确实变了，
 * 若不更新，「当前」会一直停在切换前的旧值，和「目标」自相矛盾。
 * 注意：这只代表输入源已切换，不代表另一台主机有信号——文案里仍然要求用户确认画面。
 */
export function applySwitchResultToCache(result: SwitchResult): void {
  for (const attempt of result.attempts) {
    if (!attempt.ok || attempt.targetInput === null) continue
    const index = runtime.monitors.findIndex((monitor) => monitor.id === attempt.monitorId)
    if (index < 0) continue
    runtime.monitors[index] = {
      ...runtime.monitors[index],
      currentInput: attempt.targetInput,
      error: undefined,
    }
  }
}

export async function scan(): Promise<AppStatePayload> {
  runtime.scanning = true
  broadcast({ type: 'scanning', scanning: true })
  try {
    const { monitors } = await refreshMonitors()
    runtime.monitors = monitors
  } catch (error) {
    log('error', '枚举显示器失败', toSerializedError(error))
    runtime.monitors = []
    runtime.lastResult = {
      ok: false,
      attempts: [],
      message: toSerializedError(error).message,
      timestamp: Date.now(),
    }
  } finally {
    runtime.scanning = false
    broadcast({ type: 'scanning', scanning: false })
  }
  hooks?.onConfigChanged()

  const state = buildState()
  // 主动推送：窗口可能在扫描完成前就已经渲染完毕，只靠返回值会让 UI 停在空列表上
  broadcast({ type: 'state', state })
  return state
}

function broadcast(payload: Record<string, unknown>): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send('app:event', payload)
  }
}

/** 托盘/快捷键触发的操作也要让已打开的窗口同步到最新状态 */
export function broadcastState(): void {
  broadcast({ type: 'state', state: buildState() })
}

/** 只接受来自本应用窗口的调用，拒绝任何外部 frame */
function assertTrustedSender(event: Electron.IpcMainInvokeEvent): void {
  const frameUrl = event.senderFrame?.url ?? ''
  const allowed =
    frameUrl.startsWith('file://') ||
    frameUrl.startsWith('http://localhost:5173') ||
    frameUrl.startsWith('http://127.0.0.1:5173')
  if (!allowed) {
    throw new DdcError('UNKNOWN', '拒绝来自未知来源的调用')
  }
}

function asMonitorId(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string' || value.length > 200) {
    throw new DdcError('MONITOR_NOT_FOUND', '显示器标识无效')
  }
  return value
}

export function registerIpc(ipcHooks: IpcHooks): void {
  hooks = ipcHooks

  ipcMain.handle('app:state', (event) => {
    assertTrustedSender(event)
    return buildState()
  })

  ipcMain.handle('app:refresh', async (event) => {
    assertTrustedSender(event)
    return scan()
  })

  ipcMain.handle('monitor:get-input', async (event, monitorId: unknown) => {
    assertTrustedSender(event)
    const id = asMonitorId(monitorId)
    if (!id) throw new DdcError('MONITOR_NOT_FOUND', '缺少显示器标识')
    return getController().getInput(id)
  })

  ipcMain.handle('monitor:set-input', async (event, monitorId: unknown, code: unknown) => {
    assertTrustedSender(event)
    const id = asMonitorId(monitorId)
    if (!id) throw new DdcError('MONITOR_NOT_FOUND', '缺少显示器标识')
    assertValidInputCode(code)
    await getController().setInput(id, code)
    log('info', `手动切换: ${id} -> ${code}`)
    return scan()
  })

  ipcMain.handle('app:switch', async (event, monitorId: unknown) => {
    assertTrustedSender(event)
    const id = asMonitorId(monitorId)
    broadcast({ type: 'busy', busy: true })
    try {
      const result = await switchToOther(id, 'ui')
      runtime.lastResult = result
      applySwitchResultToCache(result)
      const state = buildState()
      broadcast({ type: 'state', state })
      return { state, result }
    } finally {
      broadcast({ type: 'busy', busy: false })
    }
  })

  ipcMain.handle('app:test', async (event, monitorId: unknown) => {
    assertTrustedSender(event)
    const id = asMonitorId(monitorId)
    const result = await testConfiguration(id)
    runtime.lastResult = result
    return { state: buildState(), result }
  })

  ipcMain.handle('app:save-config', (event, patch: unknown) => {
    assertTrustedSender(event)
    const next = saveConfig(patch)
    const touchesAutoLaunch =
      !!patch && typeof patch === 'object' && Object.hasOwn(patch as Record<string, unknown>, 'autoLaunch')
    if (touchesAutoLaunch) {
      hooks?.applyAutoLaunch(next.autoLaunch)
    }
    hooks?.onConfigChanged()
    return buildState()
  })

  ipcMain.handle('app:set-shortcut', (event, accelerator: unknown) => {
    assertTrustedSender(event)
    if (typeof accelerator !== 'string') {
      return { state: buildState(), ok: false, error: '快捷键格式不正确' }
    }
    const result = hooks?.applyShortcut(accelerator) ?? { ok: false, error: '应用尚未就绪' }
    if (!result.ok) {
      return { state: buildState(), ok: false, error: result.error }
    }
    saveConfig({ shortcut: accelerator })
    runtime.shortcutError = undefined
    hooks?.onConfigChanged()
    return { state: buildState(), ok: true }
  })

  ipcMain.handle('app:set-autolaunch', (event, enabled: unknown) => {
    assertTrustedSender(event)
    const value = Boolean(enabled)
    saveConfig({ autoLaunch: value })
    hooks?.applyAutoLaunch(value)
    hooks?.onConfigChanged()
    return buildState()
  })

  ipcMain.handle('app:export-log', async (event) => {
    assertTrustedSender(event)
    const window = BrowserWindow.fromWebContents(event.sender)
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
    const options: Electron.SaveDialogOptions = {
      title: '导出诊断日志',
      defaultPath: path.join(app.getPath('downloads'), `display-switch-${stamp}.log`),
      filters: [{ name: '日志文件', extensions: ['log', 'txt'] }],
    }
    const result = window
      ? await dialog.showSaveDialog(window, options)
      : await dialog.showSaveDialog(options)

    if (result.canceled || !result.filePath) return { ok: false, path: null }
    try {
      const saved = exportLog(result.filePath)
      return { ok: true, path: saved }
    } catch (error) {
      return { ok: false, path: null, error: toSerializedError(error).message }
    }
  })

  ipcMain.handle('diag:logs', (event) => {
    assertTrustedSender(event)
    return getRecentLines(200)
  })

  ipcMain.handle('system:request-accessibility', (event) => {
    assertTrustedSender(event)
    const granted = requestAccessibilityPermission()
    log('info', `申请辅助功能权限，当前状态: ${granted ? '已授权' : '未授权'}`)
    return { granted, state: buildState() }
  })

  ipcMain.handle('system:open-accessibility-settings', (event) => {
    assertTrustedSender(event)
    openAccessibilitySettings()
    return true
  })

  ipcMain.handle('system:preview-window-move', async (event, monitorId: unknown) => {
    assertTrustedSender(event)
    const id = asMonitorId(monitorId)
    const config = getConfig()
    const monitor = runtime.monitors.find((item) => item.id === id) ?? runtime.monitors[0]
    if (!monitor) return { ok: false, moved: 0, skipped: true, message: '没有可用的显示器' }
    const name = config.monitors[monitor.id]?.name ?? monitor.name
    return moveWindowsOffDisplay(name)
  })

  ipcMain.handle('diag:open-log-folder', async (event) => {
    assertTrustedSender(event)
    const dir = path.dirname(getLogPath())
    try {
      fs.mkdirSync(dir, { recursive: true })
      await shell.openPath(dir)
      return { ok: true, path: dir }
    } catch (error) {
      return { ok: false, path: dir, error: toSerializedError(error).message }
    }
  })
}
