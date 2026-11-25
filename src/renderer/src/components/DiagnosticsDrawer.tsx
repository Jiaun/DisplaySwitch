import type { AppStatePayload } from '../../../shared/types'

interface Props {
  open: boolean
  state: AppStatePayload | null
  logs: string[]
  exporting: boolean
  onClose: () => void
  onExport: () => void
  onOpenFolder: () => void
  onReload: () => void
}

export default function DiagnosticsDrawer({
  open,
  state,
  logs,
  exporting,
  onClose,
  onExport,
  onOpenFolder,
  onReload,
}: Props) {
  if (!open || !state) return null

  return (
    <div className="drawer" onClick={onClose}>
      <div className="drawer__panel" onClick={(event) => event.stopPropagation()}>
        <div className="drawer__head">
          <div className="drawer__title">诊断信息</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn btn--sm" onClick={onReload}>
              刷新日志
            </button>
            <button type="button" className="btn btn--sm" onClick={onOpenFolder}>
              打开日志目录
            </button>
            <button type="button" className="btn btn--sm btn--primary" disabled={exporting} onClick={onExport}>
              {exporting ? '导出中…' : '导出日志'}
            </button>
            <button type="button" className="btn btn--sm btn--ghost" onClick={onClose}>
              关闭
            </button>
          </div>
        </div>

        <div className="drawer__body">
          <div className="kv">
            <span className="kv__k">平台</span>
            <span className="kv__v">
              {state.platform} · {state.arch}
              {state.mock ? ' · 模拟模式' : ''}
            </span>

            <span className="kv__k">应用版本</span>
            <span className="kv__v">
              {state.diagnostics.versions.app}（Electron {state.diagnostics.versions.electron}）
            </span>

            <span className="kv__k">原生组件</span>
            <span className="kv__v">
              {state.diagnostics.binaryPath}
              {state.diagnostics.binaryExists ? '' : '（未找到）'}
            </span>

            <span className="kv__k">配置文件</span>
            <span className="kv__v">{state.diagnostics.logPath.replace(/logs[\\/].*$/, 'config.json')}</span>

            <span className="kv__k">日志文件</span>
            <span className="kv__v">{state.diagnostics.logPath}</span>

            <span className="kv__k">显示器</span>
            <span className="kv__v">
              {state.monitors.length === 0
                ? '未检测到'
                : state.monitors
                    .map((monitor) => `${monitor.name}${monitor.currentInput !== undefined ? ` (${monitor.currentInput})` : ''}`)
                    .join('、')}
            </span>
          </div>

          <div className="log-view">
            {logs.length === 0 ? '暂无日志' : logs.join('\n')}
          </div>
        </div>
      </div>
    </div>
  )
}
