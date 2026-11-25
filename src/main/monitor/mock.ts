import { DdcError, assertValidInputCode, type DisplayController, type MonitorInfo } from './types'

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

interface FakeMonitor extends MonitorInfo {
  supported: number[]
}

/**
 * 模拟 Adapter：在没有接显示器、或需要在非目标平台上调试 UI 时使用。
 * 启动方式：DISPLAY_SWITCH_MOCK=1 npm run dev
 * 它让我们可以在不切走真实画面的前提下，把交互、状态机、错误提示全部跑通。
 */
export class MockDisplayController implements DisplayController {
  readonly platform = process.platform

  private monitors: FakeMonitor[] = [
    {
      id: 'MOCK-VG2781-4K',
      name: 'VG2781-4K',
      manufacturer: 'VSC',
      model: 'VG2781-4K',
      ddcAvailable: true,
      currentInput: 15,
      supported: [15, 16, 17, 18, 27],
    },
    {
      id: 'MOCK-G41',
      name: 'G41',
      manufacturer: 'SAC',
      model: 'G41',
      ddcAvailable: true,
      currentInput: 17,
      supported: [15, 17],
    },
  ]

  async listMonitors(): Promise<MonitorInfo[]> {
    await delay(120)
    return this.monitors.map(({ supported: _supported, ...info }) => ({ ...info }))
  }

  private find(monitorId: string): FakeMonitor {
    const monitor = this.monitors.find((item) => item.id === monitorId)
    if (!monitor) throw new DdcError('MONITOR_NOT_FOUND', '模拟显示器不存在', monitorId)
    return monitor
  }

  async getInput(monitorId: string): Promise<number> {
    await delay(90)
    const monitor = this.find(monitorId)
    if (typeof monitor.currentInput !== 'number') {
      throw new DdcError('READ_FAILED', '模拟：显示器未返回读数')
    }
    return monitor.currentInput
  }

  async setInput(monitorId: string, inputCode: number): Promise<void> {
    assertValidInputCode(inputCode)
    await delay(260)
    const monitor = this.find(monitorId)
    if (!monitor.supported.includes(inputCode)) {
      throw new DdcError(
        'WRITE_FAILED',
        `模拟：${monitor.name} 拒绝输入源 0x${inputCode.toString(16)}`,
        '该显示器未在支持列表中声明此取值。'
      )
    }
    monitor.currentInput = inputCode
  }
}
