import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AppConfig, AppStatePayload } from '../../../shared/types'
import { guessOtherInput, inputLabel } from '../../../main/monitor/types'
import MonitorPicker from '../components/MonitorPicker'
import InputSourcePicker from '../components/InputSourcePicker'
import ShortcutSettings from '../components/ShortcutSettings'
import DiagnosticsDrawer from '../components/DiagnosticsDrawer'
import Toggle from '../components/Toggle'
import { acceleratorTokens } from '../lib/accelerator'

const api = window.displaySwitch

type Toast = { kind: 'ok' | 'error'; text: string } | null

export default function Home() {
  const [state, setState] = useState<AppStatePayload | null>(null)
  const [busy, setBusy] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [toast, setToast] = useState<Toast>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [logs, setLogs] = useState<string[]>([])
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    // 先订阅再取初始状态，避免错过扫描完成事件；
    // 同时防止"晚到的空快照"把已经拿到的好结果覆盖掉。
    const off = api.onEvent((event) => {
      if (event.type === 'busy') setBusy(Boolean(event.busy))
      if (event.type === 'scanning') setScanning(Boolean(event.scanning))
      if (event.type === 'state' && event.state) setState(event.state)
    })

    void api.getState().then((next) => {
      setState((prev) => (prev && prev.monitors.length > 0 && next.monitors.length === 0 ? prev : next))
    })

    return off
  }, [])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 4200)
    return () => clearTimeout(timer)
  }, [toast])

  const config = state?.config
  const monitors = state?.monitors ?? []
  const activeMonitorId = config?.activeMonitorId ?? null
  const activeMonitor = useMemo(
    () => monitors.find((monitor) => monitor.id === activeMonitorId) ?? monitors[0],
    [monitors, activeMonitorId]
  )
  const activeConfig = activeMonitor ? config?.monitors[activeMonitor.id] : undefined

  const applyConfig = useCallback((patch: Partial<AppConfig>) => {
    return api.saveConfig(patch).then((next) => {
      setState(next)
      return next
    })
  }, [])

  const refresh = useCallback(async () => {
    setScanning(true)
    try {
      const next = await api.refresh()
      setState(next)
      setToast({
        kind: next.monitors.length > 0 ? 'ok' : 'error',
        text:
          next.monitors.length > 0
            ? `已检测到 ${next.monitors.length} 台显示器`
            : next.lastResult?.message ?? '没有检测到可控制的显示器',
      })
    } catch (error) {
      setToast({ kind: 'error', text: error instanceof Error ? error.message : String(error) })
    } finally {
      setScanning(false)
    }
  }, [])

  const selectMonitor = useCallback(
    (monitorId: string) => {
      applyConfig({ activeMonitorId: monitorId })
    },
    [applyConfig]
  )

  const patchMonitor = useCallback(
    (patch: { thisHostInput?: number | null; otherHostInput?: number | null }) => {
      if (!activeMonitor || !config) return
      const existing = config.monitors[activeMonitor.id] ?? {
        id: activeMonitor.id,
        name: activeMonitor.name,
        thisHostInput: null,
        otherHostInput: null,
      }
      applyConfig({
        monitors: { ...config.monitors, [activeMonitor.id]: { ...existing, ...patch } },
      })
    },
    [activeMonitor, config, applyConfig]
  )

  const updateInput = useCallback(
    (field: 'thisHostInput' | 'otherHostInput', value: number | null) => {
      patchMonitor({ [field]: value })
    },
    [patchMonitor]
  )

  /** 启用切换：补上本机接口，并按当前接口猜一个对端接口作为起点 */
  const enableSwitching = useCallback(() => {
    if (!activeMonitor) return
    const thisHost = activeConfig?.thisHostInput ?? activeMonitor.currentInput ?? null
    const other = guessOtherInput(thisHost ?? undefined)
    patchMonitor({ thisHostInput: thisHost, otherHostInput: other })
    setToast({ kind: 'ok', text: '已启用切换，请确认右侧是第二台电脑实际接入的接口' })
  }, [activeMonitor, activeConfig, patchMonitor])

  const disableSwitching = useCallback(() => {
    patchMonitor({ otherHostInput: null })
    setToast({ kind: 'ok', text: '已按单设备处理，不再显示输入源切换' })
  }, [patchMonitor])

  const switchNow = useCallback(async () => {
    if (busy) return
    setBusy(true)
    try {
      const response = await api.switchToOther(activeMonitor?.id)
      setState(response.state)
      setToast({ kind: response.result.ok ? 'ok' : 'error', text: response.result.message })
    } catch (error) {
      setToast({ kind: 'error', text: error instanceof Error ? error.message : String(error) })
    } finally {
      setBusy(false)
    }
  }, [activeMonitor, busy])

  const runTest = useCallback(async () => {
    const response = await api.test(activeMonitor?.id)
    setState(response.state)
    setToast({ kind: response.result.ok ? 'ok' : 'error', text: response.result.message })
  }, [activeMonitor])

  const applyShortcut = useCallback(async (accelerator: string) => {
    const result = await api.setShortcut(accelerator)
    setState(result.state)
    if (result.ok) {
      setToast({ kind: 'ok', text: '快捷键已更新' })
      return { ok: true }
    }
    return { ok: false, error: result.error }
  }, [])

  const toggleAutoLaunch = useCallback(
    (enabled: boolean) => {
      void api.setAutoLaunch(enabled).then((next) => {
        setState(next)
        setToast({ kind: 'ok', text: enabled ? '已开启开机自启' : '已关闭开机自启' })
      })
    },
    []
  )

  /** 开启窗口搬移时，若还没拿到辅助功能权限就立刻申请 */
  const toggleMoveWindows = useCallback(
    async (enabled: boolean) => {
      const next = await applyConfig({ moveWindowsOnSwitch: enabled })

      if (!enabled) {
        setToast({ kind: 'ok', text: '已关闭窗口搬移' })
        return
      }

      if (next.permissions.accessibility) {
        setToast({ kind: 'ok', text: '已开启，切换前会先把该屏窗口移到另一块屏' })
        return
      }

      const result = await api.requestAccessibility()
      setState(result.state)
      setToast({
        kind: result.granted ? 'ok' : 'error',
        text: result.granted
          ? '已获得辅助功能权限'
          : '已提交申请，请在「隐私与安全性 → 辅助功能」中勾选 DisplaySwitch',
      })
    },
    [applyConfig]
  )

  const openAccessibilityPane = useCallback(() => {
    void api.openAccessibilitySettings()
  }, [])

  /** 不切换显示器，单独试一次窗口搬移，方便确认权限与效果 */
  const tryMoveWindows = useCallback(async () => {
    const result = await api.previewWindowMove(activeMonitor?.id)
    setToast({ kind: result.ok ? 'ok' : 'error', text: result.message })
  }, [activeMonitor])

  const openDrawer = useCallback(async () => {
    setLogs(await api.getLogs())
    setDrawerOpen(true)
  }, [])

  const exportLog = useCallback(async () => {
    setExporting(true)
    try {
      const result = await api.exportLog()
      if (result.ok && result.path) {
        setToast({ kind: 'ok', text: `日志已导出：${result.path}` })
      } else if (result.error) {
        setToast({ kind: 'error', text: result.error })
      }
    } finally {
      setExporting(false)
    }
  }, [])

  if (!state || !config) {
    return (
      <div className="app">
        <div className="titlebar">
          <div className="titlebar__left">
            <span className="titlebar__name">DisplaySwitch</span>
          </div>
        </div>
        <div className="content">
          <div className="skeleton">正在读取配置…</div>
        </div>
      </div>
    )
  }

  const shortcutTokens = acceleratorTokens(config.shortcut, state.platform)

  /**
   * 是否启用切换，唯一判据是「有没有指定第二台电脑的接口」。
   * DDC/CI 读不到显示器上插了几根线，所以单设备只能靠用户标记；
   * 默认不指定，就等于按单设备处理，界面不会出现输入源切换。
   */
  const switchingEnabled = activeConfig?.otherHostInput !== null && activeConfig?.otherHostInput !== undefined

  const sameAsDetected =
    switchingEnabled &&
    activeMonitor?.currentInput !== undefined &&
    activeConfig?.otherHostInput === activeMonitor.currentInput

  const statusText = scanning
    ? '正在检测显示器…'
    : busy
      ? '正在发送切换指令…'
      : state.lastResult
        ? state.lastResult.message
        : monitors.length === 0
          ? '未检测到显示器'
          : '就绪'

  const statusKind = scanning || busy ? 'idle' : state.lastResult ? (state.lastResult.ok ? 'ok' : 'error') : monitors.length ? 'ok' : 'error'

  return (
    <div className="app">
      <div className="titlebar">
        <div className="titlebar__left">
          <span className="titlebar__name">DisplaySwitch</span>
          {state.mock ? <span className="titlebar__platform">模拟模式</span> : null}
          <span className="titlebar__platform">
            {state.platform === 'darwin' ? 'macOS' : state.platform === 'win32' ? 'Windows' : state.platform} ·{' '}
            {state.arch}
          </span>
        </div>
        <div className="titlebar__actions">
          <button type="button" className="btn btn--sm" onClick={openDrawer}>
            诊断
          </button>
          <button type="button" className="btn btn--sm" onClick={refresh} disabled={scanning}>
            {scanning ? <span className="spinner spinner--ink" /> : null}
            {scanning ? '检测中' : '刷新'}
          </button>
        </div>
      </div>

      <div className="content">
        <section className="section">
          <div className="section__head">
            <span className="section__title">显示器</span>
            <span className="section__hint">点选要切换的显示器（DDC/CI 状态见右侧圆点）</span>
          </div>
          <MonitorPicker
            monitors={monitors}
            configs={config.monitors}
            activeMonitorId={activeMonitor?.id ?? null}
            onSelect={selectMonitor}
          />
        </section>

        {activeMonitor ? (
          <section className="section">
            <div className="section__head">
              <span className="section__title">输入源</span>
              {switchingEnabled ? (
                <button type="button" className="link-btn" onClick={disableSwitching}>
                  这台显示器其实只接了一台设备？停用切换
                </button>
              ) : (
                <span className="section__hint">已按单设备处理</span>
              )}
            </div>

            <div className="switch-stage">
              <InputSourcePicker
                label={state.platform === 'darwin' ? '这台电脑 · Mac' : '这台电脑'}
                variant="this"
                value={activeConfig?.thisHostInput ?? null}
                detected={activeMonitor.currentInput}
                onChange={(value) => updateInput('thisHostInput', value)}
                disabled={busy}
                readOnly={!switchingEnabled}
              />

              <div className="switch-center">
                <button
                  type="button"
                  className={`switch-btn${switchingEnabled ? '' : ' switch-btn--inert'}`}
                  onClick={switchNow}
                  disabled={busy || !switchingEnabled}
                  title={switchingEnabled ? '切换到另一台电脑' : '该显示器只接了一台设备'}
                >
                  {busy ? (
                    <span className="spinner" />
                  ) : (
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path
                        d="M4 12h15M13.5 6.5 20 12l-6.5 5.5"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                </button>
                <div className="switch-btn__hint">
                  {switchingEnabled ? shortcutTokens.join(state.platform === 'darwin' ? '' : '+') : '未启用'}
                </div>
              </div>

              {switchingEnabled ? (
                <InputSourcePicker
                  label={state.platform === 'darwin' ? '另一台电脑 · PC' : '另一台电脑'}
                  variant="other"
                  value={activeConfig?.otherHostInput ?? null}
                  onChange={(value) => updateInput('otherHostInput', value)}
                  disabled={busy}
                />
              ) : (
                <div className="host-panel host-panel--single">
                  <div className="host-panel__label">
                    <span className="dot dot--muted" />
                    仅一台设备
                  </div>
                  <p className="host-panel__single-text">
                    「{activeMonitor.name}」没有接入第二台电脑，因此不提供输入源切换。
                    如果它同时连着 Mac 和 PC，可以在这里启用。
                  </p>
                  <button type="button" className="btn btn--sm" onClick={enableSwitching}>
                    接入第二台电脑 · 启用切换
                  </button>
                </div>
              )}
            </div>

            {sameAsDetected ? (
              <div className="notice" style={{ marginTop: 10 }}>
                <span className="notice__icon">!</span>
                目标接口与当前接口相同（{inputLabel(activeMonitor.currentInput)}），点击切换不会有任何变化。
              </div>
            ) : null}
          </section>
        ) : null}

        <section className="section">
          <div className="section__head">
            <span className="section__title">设置</span>
          </div>

          <div className="settings">
            <ShortcutSettings
              accelerator={config.shortcut}
              platform={state.platform}
              registered={state.shortcut.registered}
              error={state.shortcut.error}
              onApply={applyShortcut}
            />

            <div className="setting-row">
              <div className="setting-row__main">
                <div className="setting-row__label">开机自启</div>
                <div className="setting-row__desc">登录系统后自动在托盘运行</div>
              </div>
              <div className="setting-row__control">
                <Toggle checked={config.autoLaunch} label="开机自启" onChange={toggleAutoLaunch} />
              </div>
            </div>

            {state.permissions.windowMoveSupported ? (
              <div className="setting-row">
                <div className="setting-row__main">
                  <div className="setting-row__label">切换前把该屏的窗口移到另一块屏</div>
                  <div className="setting-row__desc">
                    切走后 macOS 不会自动迁移窗口，窗口会留在看不见的屏上。开启后会在发送切换指令前先搬走。
                    需要辅助功能权限；全屏窗口无法移动，且不会自动搬回原位。
                  </div>
                  {config.moveWindowsOnSwitch ? (
                    <div style={{ display: 'flex', gap: 12, marginTop: 6 }}>
                      {!state.permissions.accessibility ? (
                        <button type="button" className="link-btn" onClick={openAccessibilityPane}>
                          去授予辅助功能权限
                        </button>
                      ) : (
                        <button type="button" className="link-btn" onClick={tryMoveWindows}>
                          试一下搬移效果
                        </button>
                      )}
                    </div>
                  ) : null}
                </div>
                <div className="setting-row__control">
                  <Toggle
                    checked={config.moveWindowsOnSwitch}
                    label="切换前搬移窗口"
                    onChange={toggleMoveWindows}
                  />
                </div>
              </div>
            ) : null}

            <div className="setting-row">
              <div className="setting-row__main">
                <div className="setting-row__label">关闭窗口时最小化到托盘</div>
                <div className="setting-row__desc">关闭主窗口不退出应用，快捷键继续可用</div>
              </div>
              <div className="setting-row__control">
                <Toggle
                  checked={config.closeToTray}
                  label="关闭窗口时最小化到托盘"
                  onChange={(checked) => applyConfig({ closeToTray: checked })}
                />
              </div>
            </div>
          </div>
        </section>

        <div className="footer-bar">
          <div
            className={`status-line${statusKind === 'ok' ? ' is-ok' : statusKind === 'error' ? ' is-error' : ''}`}
          >
            <span
              className={`dot ${statusKind === 'ok' ? 'dot--ok' : statusKind === 'error' ? 'dot--bad' : 'dot--warn'}`}
            />
            <span className="status-line__text">{statusText}</span>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn btn--sm" onClick={runTest}>
              测试配置
            </button>
            <button type="button" className="btn btn--sm" onClick={exportLog} disabled={exporting}>
              {exporting ? '导出中…' : '导出诊断日志'}
            </button>
          </div>
        </div>
      </div>

      <DiagnosticsDrawer
        open={drawerOpen}
        state={state}
        logs={logs}
        exporting={exporting}
        onClose={() => setDrawerOpen(false)}
        onExport={exportLog}
        onOpenFolder={() => void api.openLogFolder()}
        onReload={async () => setLogs(await api.getLogs())}
      />

      {toast ? <div className={`toast toast--${toast.kind}`}>{toast.text}</div> : null}
    </div>
  )
}
