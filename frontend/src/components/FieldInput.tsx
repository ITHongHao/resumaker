import { Input } from '@/components/ui/input'
import { type FieldDef, MAX_EXTRA_CHARS, YESNO_OPTIONS } from '@/lib/recordFields'

export const selectClass =
  'h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50'

const OTHER = 'Other'

/** One Record field: a text box, a yes/no select, or a pick list. A pick list that has "Other"
 * opens a free-text box when Other is chosen; a stored value outside the list shows as Other. */
export default function FieldInput({
  id,
  def,
  value,
  otherPicked,
  onChange,
  onOtherPicked,
  maxLength = MAX_EXTRA_CHARS,
}: {
  id: string
  def: FieldDef
  value: string
  otherPicked: boolean
  onChange: (v: string) => void
  onOtherPicked: (picked: boolean) => void
  maxLength?: number
}) {
  if (def.type === 'text') {
    return <Input id={id} placeholder={def.placeholder} maxLength={maxLength} value={value} onChange={(e) => onChange(e.target.value)} />
  }
  if (def.type === 'yesno') {
    return (
      <select id={id} className={selectClass} value={value.trim().toLowerCase()} onChange={(e) => onChange(e.target.value)}>
        <option value="" />
        {YESNO_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    )
  }
  const options = def.options ?? []
  const hasOther = options.includes(OTHER)
  const typed = hasOther && (otherPicked || (value !== '' && !options.includes(value)))
  // A stored value no longer in the list (a list without "Other") stays selectable.
  const stray = !hasOther && value !== '' && !options.includes(value)
  return (
    <div className="space-y-1.5">
      <select
        id={id}
        className={selectClass}
        value={typed ? OTHER : value}
        onChange={(e) => {
          const v = e.target.value
          if (v === OTHER) {
            onOtherPicked(true)
            onChange('')
          } else {
            onOtherPicked(false)
            onChange(v)
          }
        }}
      >
        <option value="" />
        {stray && <option value={value}>{value}</option>}
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
      {typed && (
        <Input
          aria-label={`${def.label} (other)`}
          maxLength={maxLength}
          value={options.includes(value) ? '' : value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  )
}
