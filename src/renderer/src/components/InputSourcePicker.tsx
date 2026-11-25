import { useEffect, useState } from 'react'
import { INPUT_OPTIONS, inputLabel } from '../../../main/monitor/types'

interface Props {
  label: string
  /** 该面板代表"这台电脑"还是"另一台电脑"，只影响视觉 */
  variant: 'this' | 'other'
  value: number | null
  detected?: number
  onChange: (value: number | null) => void
  disabled?: boolean
  /** 单设备显示器：只展示实测接口，不提供修改入口 */
  readOnly?: boolean
}

const CUSTOM = 'custom'
const UNSET = 'unset'

function isKnown(value: number | null): boolean {
  if (value === null) return false
  return INPUT_OPTIONS.some((option) => option.code === value)
}

export default function InputSourcePicker({
  label,
  variant,
  value,
  detected,
  onChange,
  disabled,
  readOnly,
}: Props) {
  const [custom, setCustom] = useState(() => value !== null && !isKnown(value))
  const [draft, setDraft] = useState<string>(() => (value !== null ? String(value) : ''))

  // 外部值变化（例如重新枚举后从配置读回）时同步本地输入框
  useEffect(() => {
    if (!custom) return
    if (value === null) return
    if (String(value) !== draft) setDraft(String(value))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  const selectValue = custom ? CUSTOM : value === null ? UNSET : String(value)

  function handleSelect(next: string): void {
    if (next === UNSET) {
      setCustom(false)
      onChange(null)
      return
    }
    if (next === CUSTOM) {
      setCustom(true)
      return
    }
    setCustom(false)
    onChange(Number(next))
  }

  function commitDraft(raw: string): void {
    setDraft(raw)
    const trimmed = raw.trim()
    if (!trimmed) return
    const parsed = Number(trimmed)
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 255) return
    onChange(parsed)
  }

  return (
    <div className={`host-panel${variant === 'other' ? ' host-panel--other' : ''}`}>
      <div className="host-panel__label">
        <span className={`dot ${variant === 'other' ? 'dot--accent' : 'dot--muted'}`} />
        {label}
      </div>

      {readOnly ? (
        <>
          <div className="host-panel__static">
            {detected !== undefined ? inputLabel(detected) : value !== null ? inputLabel(value) : '未读取到'}
          </div>
          <div className="host-panel__raw">
            {detected !== undefined
              ? `实测 VCP 0x${detected.toString(16).padStart(2, '0')}`
              : '显示器未返回读数'}
          </div>
        </>
      ) : (
        <>
          <select
            className="host-panel__select"
            value={selectValue}
            disabled={disabled}
            onChange={(event) => handleSelect(event.target.value)}
          >
            <option value={UNSET}>未设置</option>
            {INPUT_OPTIONS.map((option) => (
              <option key={option.code} value={String(option.code)}>
                {option.label}（{option.code}）
              </option>
            ))}
            <option value={CUSTOM}>自定义 VCP 值…</option>
          </select>

          {custom ? (
            <div className="host-panel__custom">
              <input
                type="number"
                min={0}
                max={255}
                inputMode="numeric"
                value={draft}
                disabled={disabled}
                placeholder="0-255"
                onChange={(event) => commitDraft(event.target.value)}
              />
              <span className="host-panel__raw">
                {value !== null ? `0x${value.toString(16).padStart(2, '0')} · ${inputLabel(value)}` : '输入十进制值'}
              </span>
            </div>
          ) : (
            <div className="host-panel__raw">
              {value !== null ? `VCP 0x${value.toString(16).padStart(2, '0')}` : '尚未选择接口'}
              {variant === 'this' && detected !== undefined ? ` · 实测当前 ${inputLabel(detected)}` : ''}
            </div>
          )}
        </>
      )}
    </div>
  )
}
