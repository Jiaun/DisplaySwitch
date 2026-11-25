import { useEffect, useRef, useState } from 'react'
import { acceleratorTokens, eventToAccelerator } from '../lib/accelerator'

interface Props {
  accelerator: string
  platform: string
  registered: boolean
  error?: string
  onApply: (accelerator: string) => Promise<{ ok: boolean; error?: string }>
}

export default function ShortcutSettings({ accelerator, platform, registered, error, onApply }: Props) {
  const [recording, setRecording] = useState(false)
  const [pending, setPending] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!recording) return

    function handleKey(event: KeyboardEvent): void {
      event.preventDefault()
      event.stopPropagation()

      if (event.key === 'Escape') {
        setRecording(false)
        setPending(null)
        return
      }

      const next = eventToAccelerator(event, platform)
      if (!next) {
        setMessage('请按住 ⌘ / Ctrl / Alt 再按一个字母或数字键')
        return
      }
      setMessage(null)
      setPending(next)
    }

    window.addEventListener('keydown', handleKey, true)
    return () => window.removeEventListener('keydown', handleKey, true)
  }, [recording, platform])

  async function confirm(): Promise<void> {
    if (!pending) return
    setSaving(true)
    const result = await onApply(pending)
    setSaving(false)
    if (result.ok) {
      setRecording(false)
      setPending(null)
      setMessage(null)
    } else {
      setMessage(result.error ?? '快捷键保存失败')
    }
  }

  const display = pending ?? accelerator
  const tokens = acceleratorTokens(display, platform)

  return (
    <div className="setting-row" ref={containerRef}>
      <div className="setting-row__main">
        <div className="setting-row__label">全局快捷键</div>
        <div className="setting-row__desc">
          {recording
            ? message ?? '按下新的组合键，Esc 取消'
            : error
              ? error
              : !registered
                ? '当前快捷键未能注册'
                : '在任何应用中按下即可切换显示器输入源'}
        </div>
      </div>

      <div className="setting-row__control">
        <span className={`shortcut-key${recording ? ' shortcut-capture' : ''}`}>
          {recording && !pending ? '按下组合键…' : tokens.join(platform === 'darwin' ? '' : ' + ')}
        </span>

        {recording ? (
          <>
            <button type="button" className="btn btn--sm btn--primary" disabled={!pending || saving} onClick={confirm}>
              {saving ? '保存中' : '保存'}
            </button>
            <button
              type="button"
              className="btn btn--sm"
              onClick={() => {
                setRecording(false)
                setPending(null)
                setMessage(null)
              }}
            >
              取消
            </button>
          </>
        ) : (
          <button type="button" className="btn btn--sm" onClick={() => setRecording(true)}>
            修改
          </button>
        )}
      </div>
    </div>
  )
}
