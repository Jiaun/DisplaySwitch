interface Props {
  checked: boolean
  disabled?: boolean
  label: string
  onChange: (checked: boolean) => void
}

export default function Toggle({ checked, disabled, label, onChange }: Props) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`toggle${checked ? ' is-on' : ''}`}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    />
  )
}
