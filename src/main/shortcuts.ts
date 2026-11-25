import { app, globalShortcut } from 'electron'
import { log } from './logging'

export interface ShortcutResult {
  ok: boolean
  accelerator: string
  error?: string
}

let activeAccelerator: string | null = null
let activeHandler: (() => void) | null = null

const ACCELERATOR_PATTERN = /^(?:(?:Command|Cmd|Control|Ctrl|CommandOrControl|CmdOrCtrl|Alt|Option|Shift|Super)\+)*[A-Za-z0-9]$|^(?:(?:Command|Cmd|Control|Ctrl|CommandOrControl|CmdOrCtrl|Alt|Option|Shift|Super)\+)*(?:F[1-9]|F1[0-9]|F2[0-4]|[0-9A-Z]|Space|Tab|Backspace|Delete|Insert|Return|Enter|Up|Down|Left|Right|Home|End|PageUp|PageDown|Escape|Plus|Numlock|Capslock|Scrolllock|PrintScreen|VolumeUp|VolumeDown|VolumeMute|MediaNextTrack|MediaPrevTrack|MediaStop|MediaPlayPause)$/

/**
 * 注册全局快捷键。必须在 app.whenReady() 之后调用。
 * 注册失败（被其他应用占用）时保留原有快捷键，并把原因回传给 UI，
 * 而不是让用户以为设置成功了。
 */
export function registerSwitchShortcut(
  accelerator: string,
  handler: () => void
): ShortcutResult {
  const trimmed = accelerator.trim()
  if (!ACCELERATOR_PATTERN.test(trimmed)) {
    return { ok: false, accelerator: trimmed, error: '快捷键格式不正确' }
  }

  if (activeAccelerator === trimmed && activeHandler) {
    activeHandler = handler
    return { ok: true, accelerator: trimmed }
  }

  const previous = activeAccelerator
  const previousHandler = activeHandler

  if (previous) {
    globalShortcut.unregister(previous)
    activeAccelerator = null
  }

  let ok = false
  try {
    ok = globalShortcut.register(trimmed, () => {
      try {
        handler()
      } catch (error) {
        log('error', '快捷键处理函数异常', error)
      }
    })
  } catch (error) {
    log('error', `注册快捷键抛错: ${trimmed}`, error)
    ok = false
  }

  if (!ok) {
    // 回滚到上一个可用快捷键，避免用户失去唯一的切换入口
    if (previous && previousHandler) {
      try {
        const restored = globalShortcut.register(previous, previousHandler)
        if (restored) activeAccelerator = previous
      } catch {
        /* 回滚失败则保持未注册状态 */
      }
    }
    log('warn', `快捷键注册失败（可能已被占用）: ${trimmed}`)
    return { ok: false, accelerator: trimmed, error: '该快捷键已被其他应用占用，请换一个组合键' }
  }

  activeAccelerator = trimmed
  activeHandler = handler
  log('info', `快捷键已注册: ${trimmed}`)
  return { ok: true, accelerator: trimmed }
}

export function unregisterAllShortcuts(): void {
  globalShortcut.unregisterAll()
  activeAccelerator = null
  activeHandler = null
}

export function currentShortcut(): string | null {
  return activeAccelerator
}

export function setupQuitCleanup(): void {
  app.on('will-quit', () => {
    unregisterAllShortcuts()
  })
}
