import { Menu, Tray, app } from 'electron'
import { createTrayIcon, createTrayIconActive } from './icons'
import { inputLabel, type MonitorInfo } from './monitor/types'
import type { AppConfig } from './config/store'

export interface TrayState {
  monitors: MonitorInfo[]
  config: AppConfig
  shortcut: string
  busy: boolean
  status: string
}

export interface TrayActions {
  onSelectMonitor: (monitorId: string) => void
  onSwitch: () => void
  onOpenWindow: () => void
  onTest: () => void
  onExportLog: () => void
  onToggleAutoLaunch: (enabled: boolean) => void
  onQuit: () => void
}

let tray: Tray | null = null
let actions: TrayActions | null = null
let state: TrayState = {
  monitors: [],
  config: {
    schemaVersion: 1,
    monitors: {},
    activeMonitorId: null,
    shortcut: '',
    autoLaunch: false,
    closeToTray: true,
    moveWindowsOnSwitch: false,
  },
  shortcut: '',
  busy: false,
  status: '就绪',
}

function acceleratorLabel(accelerator: string): string {
  if (process.platform === 'darwin') {
    return accelerator
      .replace(/CommandOrControl|CmdOrCtrl|Command|Cmd/g, '⌘')
      .replace(/Control|Ctrl/g, '⌃')
      .replace(/Alt|Option/g, '⌥')
      .replace(/Shift/g, '⇧')
      .replace(/\+/g, '')
  }
  return accelerator.replace(/CommandOrControl|CmdOrCtrl/g, 'Ctrl')
}

function buildMenu(): Menu {
  const currentActions = actions

  const monitorItems: Electron.MenuItemConstructorOptions[] = state.monitors.map((monitor) => {
    const monitorConfig = state.config.monitors[monitor.id]
    const detail = !monitorConfig
      ? '未配置'
      : monitorConfig.otherHostInput === null
        ? `${inputLabel(monitorConfig.thisHostInput ?? monitor.currentInput)} · 仅一台设备`
        : `${inputLabel(monitorConfig.thisHostInput ?? monitor.currentInput)} → ${inputLabel(monitorConfig.otherHostInput)}`
    return {
      label: `${monitor.name} — ${detail}`,
      type: 'radio',
      checked: state.config.activeMonitorId === monitor.id,
      enabled: state.monitors.length > 0,
      click: () => currentActions?.onSelectMonitor(monitor.id),
    }
  })

  const activeConfig = state.config.activeMonitorId ? state.config.monitors[state.config.activeMonitorId] : undefined
  // 当前选中那台可能是单设备；此时快捷键/托盘会落到唯一启用了切换的显示器上
  const switchable =
    activeConfig && activeConfig.otherHostInput !== null
      ? activeConfig
      : Object.values(state.config.monitors).find((item) => item.otherHostInput !== null)
  const canSwitch = Boolean(switchable)

  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: state.busy
        ? '正在发送切换指令…'
        : switchable
          ? `切换到另一台电脑（${switchable.name}）`
          : '没有启用切换的显示器',
      enabled: !state.busy && canSwitch,
      click: () => currentActions?.onSwitch(),
    },
    { label: `快捷键 ${acceleratorLabel(state.shortcut)}`, enabled: false },
    { type: 'separator' },
    ...(monitorItems.length > 0 ? monitorItems : [{ label: '未检测到可控制显示器', enabled: false }]),
    { type: 'separator' },
    { label: '打开主窗口…', click: () => currentActions?.onOpenWindow() },
    { label: '测试当前配置', click: () => currentActions?.onTest() },
    { label: '导出诊断日志…', click: () => currentActions?.onExportLog() },
    {
      label: '开机自启',
      type: 'checkbox',
      checked: state.config.autoLaunch,
      click: (item) => currentActions?.onToggleAutoLaunch(item.checked),
    },
    { type: 'separator' },
    { label: `当前：${activeConfig?.name ?? '未选择'}`, enabled: false },
    { label: '退出 DisplaySwitch', click: () => currentActions?.onQuit() },
  ]

  return Menu.buildFromTemplate(template)
}

export function createTray(trayActions: TrayActions): Tray {
  actions = trayActions
  tray = new Tray(createTrayIcon())
  tray.setToolTip('DisplaySwitch — 一键切换显示器输入源')
  tray.setContextMenu(buildMenu())
  return tray
}

export function updateTrayState(patch: Partial<TrayState>): void {
  state = { ...state, ...patch }
  if (!tray) return
  tray.setImage(state.busy ? createTrayIconActive() : createTrayIcon())
  tray.setToolTip(`DisplaySwitch — ${state.status}`)
  tray.setContextMenu(buildMenu())
}

export function getTrayState(): TrayState {
  return state
}

export function flashTrayStatus(status: string, durationMs = 6000): void {
  updateTrayState({ status })
  const timer = setTimeout(() => {
    updateTrayState({ status: '就绪' })
  }, durationMs)
  timer.unref?.()
}

export function destroyTray(): void {
  tray?.destroy()
  tray = null
  actions = null
}

export function quitApp(): void {
  app.quit()
}
