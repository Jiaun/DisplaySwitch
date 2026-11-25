import { BrowserWindow, Menu, app, shell } from 'electron'
import path from 'node:path'
import { getConfig, configFilePath, saveConfig } from './config/store'
import {
  applySwitchResultToCache,
  broadcastState,
  registerIpc,
  scan,
  setLastResult,
  setShortcutError,
  type IpcHooks,
} from './ipc'
import { createTray, destroyTray, flashTrayStatus, updateTrayState } from './tray'
import { registerSwitchShortcut, setupQuitCleanup } from './shortcuts'
import { switchToOther, testConfiguration } from './services'
import { getLogPath, log } from './logging'
import { isMockMode } from './monitor/controller'

let mainWindow: BrowserWindow | null = null
let quitting = false

const isDev = !app.isPackaged

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1000,
    height: 740,
    minWidth: 880,
    minHeight: 640,
    show: false,
    title: 'DisplaySwitch',
    backgroundColor: '#f4f5f7',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: process.platform === 'darwin' ? { x: 18, y: 20 } : undefined,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
    },
  })

  window.once('ready-to-show', () => {
    window.show()
  })

  // 外链一律交给系统浏览器，应用内不加载任何远程内容
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  // 关闭窗口 = 收到托盘，常驻工具不应该被误关
  window.on('close', (event) => {
    if (quitting) return
    if (getConfig().closeToTray) {
      event.preventDefault()
      window.hide()
    }
  })

  window.on('closed', () => {
    mainWindow = null
  })

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  return window
}

function showWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = createWindow()
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function applyAutoLaunch(enabled: boolean): void {
  if (isDev) {
    log('warn', '开发模式下不写入开机自启项')
    return
  }
  try {
    if (process.platform === 'darwin') {
      app.setLoginItemSettings({ openAtLogin: enabled, openAsHidden: true })
    } else if (process.platform === 'win32') {
      app.setLoginItemSettings({ openAtLogin: enabled, args: ['--hidden'] })
    }
    log('info', `开机自启: ${enabled ? '开启' : '关闭'}`)
  } catch (error) {
    log('error', '设置开机自启失败', error)
  }
}

async function performSwitch(source: 'tray' | 'shortcut'): Promise<void> {
  updateTrayState({ busy: true, status: '正在发送切换指令…' })
  try {
    const result = await switchToOther(undefined, source)
    setLastResult(result)
    applySwitchResultToCache(result)
    broadcastState()
    flashTrayStatus(result.ok ? '切换指令已发送' : result.message, 8000)
  } catch (error) {
    log('error', '切换流程异常', error)
    flashTrayStatus('切换失败，请查看日志')
  } finally {
    updateTrayState({ busy: false })
  }
}

function buildAppMenu(): void {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null)
    return
  }

  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: app.getName(),
      submenu: [
        { role: 'about', label: '关于 DisplaySwitch' },
        { type: 'separator' },
        {
          label: '打开主窗口',
          accelerator: 'Command+,',
          click: () => showWindow(),
        },
        { label: '显示配置文件', click: () => shell.showItemInFolder(configFilePath()) },
        { type: 'separator' },
        { role: 'hide', label: '隐藏 DisplaySwitch' },
        { role: 'hideOthers', label: '隐藏其他' },
        { role: 'unhide', label: '显示全部' },
        { type: 'separator' },
        { role: 'quit', label: '退出 DisplaySwitch' },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
      ],
    },
    {
      label: '窗口',
      submenu: [
        { role: 'minimize', label: '最小化' },
        { role: 'zoom', label: '缩放' },
        { type: 'separator' },
        { label: '诊断日志', click: () => shell.openPath(path.dirname(getLogPath())) },
      ],
    },
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

const singleInstance = app.requestSingleInstanceLock()
if (!singleInstance) {
  app.quit()
} else {
  app.on('second-instance', () => {
    showWindow()
  })

  app.whenReady().then(async () => {
    log('info', `DisplaySwitch 启动 | packaged=${app.isPackaged} mock=${isMockMode()}`)

    buildAppMenu()

    mainWindow = createWindow()

    createTray({
      onSelectMonitor: (monitorId) => {
        saveConfig({ activeMonitorId: monitorId })
        updateTrayState({ config: getConfig() })
        broadcastState()
      },
      onSwitch: () => {
        void performSwitch('tray')
      },
      onOpenWindow: () => showWindow(),
      onTest: async () => {
        const result = await testConfiguration()
        setLastResult(result)
        broadcastState()
        flashTrayStatus(result.message, 8000)
      },
      onExportLog: () => shell.openPath(path.dirname(getLogPath())),
      onToggleAutoLaunch: (enabled) => {
        saveConfig({ autoLaunch: enabled })
        applyAutoLaunch(enabled)
        updateTrayState({ config: getConfig() })
        broadcastState()
      },
      onQuit: () => {
        quitting = true
        app.quit()
      },
    })

    const hooks: IpcHooks = {
      onConfigChanged: () => {
        updateTrayState({ config: getConfig() })
      },
      applyShortcut: (accelerator) => {
        const result = registerSwitchShortcut(accelerator, () => {
          void performSwitch('shortcut')
        })
        setShortcutError(result.ok ? undefined : result.error)
        return { ok: result.ok, error: result.error }
      },
      applyAutoLaunch: (enabled) => applyAutoLaunch(enabled),
    }

    registerIpc(hooks)

    setupQuitCleanup()

    // 先扫描显示器，再注册快捷键：扫描失败也不影响用户用快捷键重试
    const state = await scan()

    const shortcutConfig = getConfig().shortcut
    const shortcutResult = hooks.applyShortcut(shortcutConfig)
    if (!shortcutResult.ok) {
      log('warn', `默认快捷键不可用: ${shortcutResult.error}`)
    }

    updateTrayState({
      monitors: state.monitors,
      config: getConfig(),
      shortcut: shortcutConfig,
      busy: false,
      status: '就绪',
    })

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createWindow()
      } else {
        showWindow()
      }
    })
  })

  app.on('window-all-closed', () => {
    // 常驻托盘工具：窗口关闭不退出应用
    if (process.platform !== 'darwin' && !getConfig().closeToTray) {
      app.quit()
    }
  })

  app.on('before-quit', () => {
    quitting = true
  })

  app.on('will-quit', () => {
    destroyTray()
  })
}
