import { MockDisplayController } from './mock'
import { MacDisplayController } from './macos'
import { WindowsDisplayController } from './windows'
import { DdcError, type DisplayController } from './types'

let instance: DisplayController | null = null

export function isMockMode(): boolean {
  return process.env.DISPLAY_SWITCH_MOCK === '1'
}

/**
 * 平台分发。V0.1 只承诺 macOS arm64 与 Windows x64；
 * 其他平台直接报明确错误，而不是静默失败。
 */
export function getController(): DisplayController {
  if (instance) return instance

  if (isMockMode()) {
    instance = new MockDisplayController()
    return instance
  }

  if (process.platform === 'darwin') {
    instance = new MacDisplayController()
    return instance
  }

  if (process.platform === 'win32') {
    instance = new WindowsDisplayController()
    return instance
  }

  throw new DdcError(
    'UNSUPPORTED_PLATFORM',
    `暂不支持当前系统：${process.platform}`,
    'V0.1 仅支持 macOS (Apple Silicon) 与 Windows 10/11 x64。'
  )
}

export function resetController(): void {
  instance = null
}

export { DdcError }
