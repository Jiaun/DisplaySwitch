import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { shell, systemPreferences } from 'electron'
import { log } from './logging'

const execFileAsync = promisify(execFile)

/**
 * 切换显示器输入源前，把窗口从「即将失去信号」的那块屏搬到另一块屏。
 *
 * 为什么需要：DDC 切换只改变显示器的输入源，macOS 仍然认为那块屏在线
 * （EDID/DDC 都还在），因此不会触发"显示器断开 → 窗口迁移"的系统行为，
 * 窗口会留在看不见的屏上。
 *
 * 实现：用 JXA 读 NSScreen 拿屏幕坐标（不需要权限），
 * 再经 System Events 读/改各应用窗口位置（需要辅助功能权限）。
 *
 * 局限：全屏窗口无法移动；部分应用（自绘窗口、沙箱应用的某些面板）不响应；
 * 移动后窗口不会自动搬回原位置。
 */

const ACCESSIBILITY_PANE =
  'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'

/**
 * 传给 osascript 的脚本。参数：显示器名称。
 * 输出一行 JSON：{ ok, moved, failed, scanned, target } 或 { ok:false, reason }
 */
const MOVE_SCRIPT = `
function run(argv) {
  ObjC.import('AppKit')

  var wanted = argv[0] || ''
  var screens = $.NSScreen.screens
  var mainHeight = ObjC.unwrap(screens.objectAtIndex(0).frame).size.height

  var displays = []
  for (var i = 0; i < screens.count; i++) {
    var screen = screens.objectAtIndex(i)
    var frame = ObjC.unwrap(screen.frame)
    displays.push({
      name: ObjC.unwrap(screen.localizedName),
      x: frame.origin.x,
      y: mainHeight - (frame.origin.y + frame.size.height),
      w: frame.size.width,
      h: frame.size.height
    })
  }

  var source = null
  for (var a = 0; a < displays.length; a++) {
    if (displays[a].name === wanted) { source = displays[a]; break }
  }
  if (!source && wanted) {
    for (var b = 0; b < displays.length; b++) {
      if (displays[b].name.indexOf(wanted) >= 0) { source = displays[b]; break }
    }
  }
  if (!source) {
    return JSON.stringify({ ok: false, reason: 'source-not-found', displays: displays.map(function (d) { return d.name }) })
  }

  var target = null
  for (var c = 0; c < displays.length; c++) {
    if (displays[c].name !== source.name) { target = displays[c]; break }
  }
  if (!target) {
    return JSON.stringify({ ok: false, reason: 'no-target-display' })
  }

  var systemEvents
  try {
    systemEvents = Application('System Events')
    systemEvents.applicationProcesses.whose({ backgroundOnly: false })()
  } catch (e) {
    return JSON.stringify({ ok: false, reason: 'system-events-denied', message: String(e) })
  }

  var moved = 0
  var failed = 0
  var scanned = 0
  var processes = systemEvents.applicationProcesses.whose({ backgroundOnly: false })()

  for (var p = 0; p < processes.length; p++) {
    var windows = []
    try { windows = processes[p].windows() } catch (e) { continue }

    for (var w = 0; w < windows.length; w++) {
      var win = windows[w]
      scanned++
      var pos, size
      try { pos = win.position(); size = win.size() } catch (e) { continue }

      var cx = pos[0] + size[0] / 2
      var cy = pos[1] + size[1] / 2
      var inside = cx >= source.x && cx <= source.x + source.w && cy >= source.y && cy <= source.y + source.h
      if (!inside) continue

      var nx = target.x + 40 + (moved % 6) * 36
      var ny = target.y + 40 + (moved % 6) * 32
      try {
        win.position = [nx, ny]
        moved++
      } catch (e) {
        failed++
      }
    }
  }

  return JSON.stringify({ ok: true, moved: moved, failed: failed, scanned: scanned, target: target.name })
}
`

export interface WindowMoveResult {
  ok: boolean
  moved: number
  failed: number
  skipped: boolean
  message: string
}

export function isWindowMoveSupported(): boolean {
  return process.platform === 'darwin'
}

/** 不弹窗，只查询当前是否已授权 */
export function hasAccessibilityPermission(): boolean {
  if (process.platform !== 'darwin') return false
  try {
    return systemPreferences.isTrustedAccessibilityClient(false)
  } catch {
    return false
  }
}

/** 弹系统授权对话框（macOS 只会弹一次，之后需要用户自己去设置里开） */
export function requestAccessibilityPermission(): boolean {
  if (process.platform !== 'darwin') return false
  try {
    return systemPreferences.isTrustedAccessibilityClient(true)
  } catch {
    return false
  }
}

export function openAccessibilitySettings(): void {
  void shell.openExternal(ACCESSIBILITY_PANE)
}

interface ScriptOutput {
  ok: boolean
  moved?: number
  failed?: number
  scanned?: number
  target?: string
  reason?: string
  message?: string
  displays?: string[]
}

/** 把窗口从指定显示器搬走。失败一律不阻断切换，只记录日志。 */
export async function moveWindowsOffDisplay(displayName: string): Promise<WindowMoveResult> {
  if (process.platform !== 'darwin') {
    return { ok: false, moved: 0, failed: 0, skipped: true, message: '仅 macOS 支持' }
  }

  if (!hasAccessibilityPermission()) {
    log('warn', '跳过窗口搬移：未获得辅助功能权限')
    return {
      ok: false,
      moved: 0,
      failed: 0,
      skipped: true,
      message: '未获得辅助功能权限，窗口不会自动搬移',
    }
  }

  const started = Date.now()

  try {
    const { stdout } = await execFileAsync(
      '/usr/bin/osascript',
      ['-l', 'JavaScript', '-e', MOVE_SCRIPT, '--', displayName],
      { timeout: 15000, maxBuffer: 1024 * 1024 }
    )

    const raw = stdout.trim().split('\n').pop() ?? ''
    const parsed = JSON.parse(raw) as ScriptOutput
    const duration = Date.now() - started

    if (!parsed.ok) {
      if (parsed.reason === 'system-events-denied') {
        log('warn', '窗口搬移被拒绝：需要在「隐私与安全性 → 辅助功能」里勾选本应用')
        return {
          ok: false,
          moved: 0,
          failed: 0,
          skipped: true,
          message: '辅助功能权限不足，窗口不会自动搬移',
        }
      }
      if (parsed.reason === 'source-not-found') {
        log('warn', '窗口搬移跳过：系统显示器列表里找不到匹配名称', parsed.displays)
        return {
          ok: false,
          moved: 0,
          failed: 0,
          skipped: true,
          message: '系统显示的显示器名称与配置不一致，未搬移窗口',
        }
      }
      log('warn', '窗口搬移跳过', parsed)
      return { ok: false, moved: 0, failed: 0, skipped: true, message: '没有另一块屏可搬移' }
    }

    const moved = parsed.moved ?? 0
    const failed = parsed.failed ?? 0
    log('info', `窗口搬移完成：移动 ${moved} 个，失败 ${failed} 个，扫描 ${parsed.scanned ?? 0} 个（${duration}ms）`)

    return {
      ok: true,
      moved,
      failed,
      skipped: false,
      message: moved > 0 ? `已把 ${moved} 个窗口移到「${parsed.target}」` : '该屏上没有需要移动的窗口',
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log('error', '窗口搬移脚本执行失败', message)
    return { ok: false, moved: 0, failed: 0, skipped: true, message: '窗口搬移失败，已继续执行切换' }
  }
}
