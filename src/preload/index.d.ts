import type { DisplaySwitchApi } from './index'

declare global {
  interface Window {
    displaySwitch: DisplaySwitchApi
  }
}

export {}
