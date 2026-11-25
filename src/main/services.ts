import { getController, isMockMode } from './monitor/controller'
import { DdcError, toSerializedError, type MonitorInfo } from './monitor/types'
import { ensureMonitorConfigured, getConfig, saveConfig, type AppConfig, type MonitorConfig } from './config/store'
import type { SwitchAttempt, SwitchResult } from '../shared/types'
import { moveWindowsOffDisplay } from './window-mover'
import { log } from './logging'

export type { SwitchAttempt, SwitchResult }

/**
 * 枚举显示器，并把新发现的显示器登记进配置。
 * 新显示器默认「未启用切换」——DDC/CI 读不到"这台屏接了几台设备"，
 * 与其瞎猜一个对端接口，不如让用户明确启用，避免单设备显示器出现无意义的切换项。
 */
export async function refreshMonitors(): Promise<{ monitors: MonitorInfo[]; config: AppConfig }> {
  const controller = getController()
  const monitors = await controller.listMonitors()

  for (const monitor of monitors) {
    const existing = getConfig().monitors[monitor.id]
    if (existing) {
      ensureMonitorConfigured(monitor.id, monitor.name)
      continue
    }
    const created: MonitorConfig = {
      id: monitor.id,
      name: monitor.name,
      thisHostInput: monitor.currentInput ?? null,
      otherHostInput: null,
    }
    const config = getConfig()
    saveConfig({ monitors: { ...config.monitors, [monitor.id]: created } })
  }

  const config = getConfig()
  if (!config.activeMonitorId || !monitors.some((m) => m.id === config.activeMonitorId)) {
    const fallback = monitors[0]?.id ?? null
    if (fallback) saveConfig({ activeMonitorId: fallback })
  }

  log('info', `枚举到 ${monitors.length} 台显示器`, monitors.map((m) => `${m.name}:${m.currentInput ?? '-'}`))
  return { monitors, config: getConfig() }
}

/** 一次只操作一台显示器：V0.1 明确不做多屏联动 */
function resolveTarget(monitorId?: string): { id: string; config: MonitorConfig } | null {
  const config = getConfig()
  const explicit = monitorId !== undefined
  const targetId = monitorId ?? config.activeMonitorId ?? Object.keys(config.monitors)[0]
  if (!targetId) return null

  const target = config.monitors[targetId]
  if (!target) return null

  // 来自快捷键/托盘的调用没有指定目标：若当前选中这台是单设备，
  // 自动落到唯一那台「已启用切换」的显示器上，避免快捷键看起来失灵。
  if (!explicit && target.otherHostInput === null) {
    const alternative = Object.values(config.monitors).find((item) => item.otherHostInput !== null)
    if (alternative) return { id: alternative.id, config: alternative }
  }

  return { id: targetId, config: target }
}

/**
 * 执行"切换到另一台电脑"。
 * 不做自动重试：写失败通常意味着硬件不支持，无限重试只会让用户更难判断。
 */
export async function switchToOther(monitorId?: string, source = 'manual'): Promise<SwitchResult> {
  const controller = getController()
  const target = resolveTarget(monitorId)
  const timestamp = Date.now()

  if (!target) {
    const message = '还没有选择显示器'
    log('warn', `切换中止：${message}`)
    return { ok: false, attempts: [], message, timestamp }
  }

  const label = target.config.name || target.id

  // 未启用切换 = 该显示器只接了一台设备，或还没指定第二台设备的接口。
  // 这种情况直接拒绝，不要发出任何 DDC 指令。
  if (target.config.otherHostInput === null) {
    const message = `「${label}」未启用切换：它只接了一台设备，或还没有指定第二台电脑的接口`
    log('warn', `切换中止 (${source}): ${message}`)
    return {
      ok: false,
      attempts: [
        {
          monitorId: target.id,
          monitorName: label,
          targetInput: null,
          ok: false,
          error: { code: 'NOT_CONFIGURED', message },
        },
      ],
      message,
      timestamp,
    }
  }

  const value = target.config.otherHostInput

  // macOS：先把手上的窗口从这块屏搬走。
  // DDC 切走输入后，macOS 仍认为该屏在线，不会自动迁移窗口，窗口会留在看不见的屏上。
  let windowNote = ''
  if (process.platform === 'darwin' && getConfig().moveWindowsOnSwitch) {
    const moveResult = await moveWindowsOffDisplay(label)
    if (moveResult.ok && moveResult.moved > 0) {
      windowNote = `，${moveResult.message}`
    } else if (!moveResult.ok && !moveResult.skipped) {
      log('warn', `窗口搬移未完成：${moveResult.message}`)
    }
  }

  try {
    await controller.setInput(target.id, value)
    log('info', `切换指令已发送 (${source}): ${label} -> ${value}`)

    let message = `已向 ${label} 发送切换指令${windowNote}`
    if (!isMockMode()) message += '，请确认画面是否已切换'

    return {
      ok: true,
      attempts: [{ monitorId: target.id, monitorName: label, targetInput: value, ok: true }],
      message,
      timestamp,
    }
  } catch (error) {
    const serialized = toSerializedError(error)
    log('error', `切换失败 (${source}): ${label} -> ${value}`, serialized)
    return {
      ok: false,
      attempts: [
        {
          monitorId: target.id,
          monitorName: label,
          targetInput: value,
          ok: false,
          error: serialized,
        },
      ],
      message: serialized.message,
      timestamp,
    }
  }
}

/** 测试当前配置：只读校验，不会真的切走画面 */
export async function testConfiguration(monitorId?: string): Promise<SwitchResult> {
  const controller = getController()
  const config = getConfig()
  const targetId = monitorId ?? config.activeMonitorId ?? Object.keys(config.monitors)[0]
  const monitorConfig = targetId ? config.monitors[targetId] : undefined

  if (!monitorConfig) {
    return {
      ok: false,
      attempts: [],
      message: '还没有选择显示器',
      timestamp: Date.now(),
    }
  }

  try {
    const current = await controller.getInput(monitorConfig.id)

    if (monitorConfig.otherHostInput === null) {
      const message = `「${monitorConfig.name}」未启用切换（只接了一台设备），当前接口 ${current}`
      log('info', `配置自检: ${message}`)
      return {
        ok: false,
        attempts: [
          {
            monitorId: monitorConfig.id,
            monitorName: monitorConfig.name,
            targetInput: null,
            ok: false,
            error: { code: 'NOT_CONFIGURED', message },
          },
        ],
        message,
        timestamp: Date.now(),
      }
    }

    const ok = monitorConfig.otherHostInput !== current
    const message = ok
      ? `可切换：当前 ${current} → 目标 ${monitorConfig.otherHostInput}`
      : '目标接口与当前接口相同，切换不会产生效果'

    log('info', `配置自检: ${monitorConfig.name} ${message}`)

    return {
      ok,
      attempts: [
        {
          monitorId: monitorConfig.id,
          monitorName: monitorConfig.name,
          targetInput: monitorConfig.otherHostInput,
          ok,
          error: ok ? undefined : { code: 'NOT_CONFIGURED', message },
        },
      ],
      message,
      timestamp: Date.now(),
    }
  } catch (error) {
    const serialized = toSerializedError(error)
    return {
      ok: false,
      attempts: [
        {
          monitorId: monitorConfig.id,
          monitorName: monitorConfig.name,
          targetInput: monitorConfig.otherHostInput,
          ok: false,
          error: serialized,
        },
      ],
      message: serialized.message,
      timestamp: Date.now(),
    }
  }
}

export { DdcError }
