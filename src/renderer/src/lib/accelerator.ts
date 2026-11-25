/**
 * Electron accelerator 与用户可见按键标签之间的转换。
 * 只用于本地配置读写，不参与任何命令拼接。
 */

const MODIFIER_KEYS = new Set([
  'Meta',
  'Control',
  'Alt',
  'Shift',
  'CapsLock',
  'AltGraph',
  'OS',
  'Super',
])

const SPECIAL_KEYS: Record<string, string> = {
  ' ': 'Space',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Escape: 'Esc',
  Enter: 'Return',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Tab: 'Tab',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  '+': 'Plus',
}

/**
 * 把键盘事件转成 accelerator。
 * 至少需要一个功能修饰键（⌘/Ctrl/Alt），避免把裸字母注册成全局快捷键，
 * 那会让用户在别的应用里打字时也被触发。
 */
export function eventToAccelerator(event: KeyboardEvent, platform: string): string | null {
  if (MODIFIER_KEYS.has(event.key)) return null
  if (event.key === 'Escape') return null

  const parts: string[] = []
  const isMac = platform === 'darwin'

  if (isMac && event.metaKey) parts.push('CommandOrControl')
  else if (!isMac && event.ctrlKey) parts.push('CommandOrControl')
  else if (isMac && event.ctrlKey) parts.push('Control')

  if (event.altKey) parts.push('Alt')
  if (event.shiftKey) parts.push('Shift')

  if (parts.length === 0) return null

  let key: string
  if (/^[a-zA-Z0-9]$/.test(event.key)) {
    key = event.key.toUpperCase()
  } else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(event.key)) {
    key = event.key
  } else if (SPECIAL_KEYS[event.key]) {
    key = SPECIAL_KEYS[event.key]
  } else if (event.key.length === 1 && /[!@#$%^&*()_\-=,./;'[\]\\`]/.test(event.key)) {
    // 标点符号暂不支持，避免与键盘布局耦合
    return null
  } else {
    return null
  }

  if (key === 'Esc') return null

  return [...parts, key].join('+')
}

const MAC_SYMBOLS: Record<string, string> = {
  CommandOrControl: '⌘',
  Command: '⌘',
  Cmd: '⌘',
  Control: '⌃',
  Ctrl: '⌃',
  Alt: '⌥',
  Option: '⌥',
  Shift: '⇧',
}

const WIN_LABELS: Record<string, string> = {
  CommandOrControl: 'Ctrl',
  Command: 'Win',
  Cmd: 'Win',
  Control: 'Ctrl',
  Ctrl: 'Ctrl',
  Alt: 'Alt',
  Option: 'Alt',
  Shift: 'Shift',
}

/** 拆成便于逐个渲染成键帽的 token */
export function acceleratorTokens(accelerator: string, platform: string): string[] {
  return accelerator
    .split('+')
    .filter(Boolean)
    .map((token) => {
      const map = platform === 'darwin' ? MAC_SYMBOLS : WIN_LABELS
      return map[token] ?? token
    })
}
