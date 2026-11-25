import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppConfig,
  AppEvent,
  AppStatePayload,
  SaveShortcutResult,
  SwitchResponse,
} from '../shared/types'

/**
 * 渲染进程唯一的硬件访问入口。
 * 这里只暴露固定的动作白名单，不暴露 ipcRenderer、不暴露 shell、不暴露任意命令执行。
 */
const api = {
  platform: process.platform,

  getState: (): Promise<AppStatePayload> => ipcRenderer.invoke('app:state'),

  refresh: (): Promise<AppStatePayload> => ipcRenderer.invoke('app:refresh'),

  getInput: (monitorId: string): Promise<number> => ipcRenderer.invoke('monitor:get-input', monitorId),

  setInput: (monitorId: string, inputCode: number): Promise<AppStatePayload> =>
    ipcRenderer.invoke('monitor:set-input', monitorId, inputCode),

  switchToOther: (monitorId?: string): Promise<SwitchResponse> =>
    ipcRenderer.invoke('app:switch', monitorId),

  test: (monitorId?: string): Promise<SwitchResponse> => ipcRenderer.invoke('app:test', monitorId),

  saveConfig: (patch: Partial<AppConfig>): Promise<AppStatePayload> =>
    ipcRenderer.invoke('app:save-config', patch),

  setShortcut: (accelerator: string): Promise<SaveShortcutResult> =>
    ipcRenderer.invoke('app:set-shortcut', accelerator),

  setAutoLaunch: (enabled: boolean): Promise<AppStatePayload> =>
    ipcRenderer.invoke('app:set-autolaunch', enabled),

  exportLog: (): Promise<{ ok: boolean; path: string | null; error?: string }> =>
    ipcRenderer.invoke('app:export-log'),

  getLogs: (): Promise<string[]> => ipcRenderer.invoke('diag:logs'),

  openLogFolder: (): Promise<{ ok: boolean; path: string; error?: string }> =>
    ipcRenderer.invoke('diag:open-log-folder'),

  requestAccessibility: (): Promise<{ granted: boolean; state: AppStatePayload }> =>
    ipcRenderer.invoke('system:request-accessibility'),

  openAccessibilitySettings: (): Promise<boolean> =>
    ipcRenderer.invoke('system:open-accessibility-settings'),

  previewWindowMove: (
    monitorId?: string
  ): Promise<{ ok: boolean; moved: number; failed: number; skipped: boolean; message: string }> =>
    ipcRenderer.invoke('system:preview-window-move', monitorId),

  onEvent: (callback: (event: AppEvent) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: AppEvent): void => callback(payload)
    ipcRenderer.on('app:event', listener)
    return () => {
      ipcRenderer.removeListener('app:event', listener)
    }
  },
}

export type DisplaySwitchApi = typeof api

contextBridge.exposeInMainWorld('displaySwitch', api)
