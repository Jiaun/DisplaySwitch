import type { MonitorConfig, MonitorInfo } from '../../../shared/types'
import { inputLabel } from '../../../main/monitor/types'

interface Props {
  monitors: MonitorInfo[]
  configs: Record<string, MonitorConfig>
  activeMonitorId: string | null
  onSelect: (monitorId: string) => void
}

export default function MonitorPicker({ monitors, configs, activeMonitorId, onSelect }: Props) {
  if (monitors.length === 0) {
    return (
      <div className="empty">
        <div className="empty__title">没有检测到可控制的显示器</div>
        请确认显示器已连接、DDC/CI 已在显示器 OSD 中开启，
        <br />
        然后点击右上角「刷新」重试。
      </div>
    )
  }

  return (
    <div className="monitor-grid">
      {monitors.map((monitor) => {
        const config = configs[monitor.id]
        const selected = monitor.id === activeMonitorId
        const readFailed = monitor.currentInput === undefined

        return (
          <button
            key={monitor.id}
            type="button"
            className={`monitor-card${selected ? ' is-selected' : ''}`}
            onClick={() => onSelect(monitor.id)}
            aria-pressed={selected}
          >
            <div className="monitor-card__top">
              <span className="monitor-card__name">{monitor.name}</span>
              <span className={`dot ${readFailed ? 'dot--warn' : 'dot--ok'}`} />
            </div>

            <div className="monitor-card__meta">
              <span>{[monitor.manufacturer, monitor.model].filter(Boolean).join(' · ') || '外接显示器'}</span>
            </div>

            <div className="monitor-card__foot">
              <span className="chip">
                当前 {monitor.currentInput !== undefined ? inputLabel(monitor.currentInput) : '无法回读'}
              </span>
              {config?.otherHostInput !== null && config?.otherHostInput !== undefined ? (
                <span className="chip chip--accent">目标 {inputLabel(config.otherHostInput)}</span>
              ) : (
                <span className="chip">单设备</span>
              )}
            </div>

            {readFailed && monitor.error ? (
              <div className="monitor-card__error">{monitor.error}</div>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}
