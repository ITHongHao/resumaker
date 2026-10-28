import { useEffect, useState } from 'react'

import type { Job, JobInput } from '@/api'
import AddFieldMenu from '@/components/AddFieldMenu'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { type FieldDef, FIELDS, formValue, MAX_EXTRA_CHARS, visibleKeys, YESNO_OPTIONS } from '@/lib/recordFields'

const DEFS = FIELDS.job
const COLUMNS = DEFS.filter((f) => f.column).map((f) => f.key)
const selectClass =
  'h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50'

function JobField({ def, value, onChange }: { def: FieldDef; value: string; onChange: (v: string) => void }) {
  const id = `job-${def.key}`
  if (def.type === 'text')
    return <Input id={id} placeholder={def.placeholder} maxLength={def.column ? undefined : MAX_EXTRA_CHARS} value={value} onChange={(e) => onChange(e.target.value)} />
  const options = def.type === 'yesno' ? YESNO_OPTIONS : (def.options ?? []).map((o) => ({ value: o, label: o }))
  const stray = value !== '' && !options.some((o) => o.value === value)
  return (
    <select id={id} className={selectClass} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="" />
      {stray && <option value={value}>{value}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

export default function JobForm({
  initial,
  onSave,
  onCancel,
  error,
}: {
  initial?: Job
  onSave: (j: JobInput) => void
  onCancel: () => void
  error?: string | null
}) {
  // Every field's value: the job's own columns and the stored-only ones from `extra`.
  const [v, setV] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {}
    for (const f of DEFS) {
      const raw = f.column ? (initial as unknown as Record<string, unknown> | undefined)?.[f.key] : initial?.extra?.[f.key]
      out[f.key] = typeof raw === 'string' ? formValue(f, raw) : ''
    }
    return out
  })
  const [added, setAdded] = useState<string[]>([])
  const [focusKey, setFocusKey] = useState<string | null>(null)
  useEffect(() => {
    if (focusKey) document.getElementById(`job-${focusKey}`)?.focus()
  }, [focusKey])

  const [initialValues] = useState(v)
  const shownKeys = new Set([...visibleKeys(DEFS, initialValues), ...added])
  const shownDefs = DEFS.filter((f) => shownKeys.has(f.key))
  const menuDefs = DEFS.filter((f) => !shownKeys.has(f.key))

  return (
    <form
      className="space-y-3 rounded-2xl border border-border bg-card p-4"
      onSubmit={(e) => {
        e.preventDefault()
        const known = new Set(DEFS.map((f) => f.key))
        const extra: Record<string, unknown> = Object.fromEntries(
          Object.entries(initial?.extra ?? {}).filter(([k]) => !known.has(k)),
        )
        for (const f of DEFS)
          if (!f.column && shownKeys.has(f.key) && v[f.key].trim()) extra[f.key] = v[f.key].trim().slice(0, MAX_EXTRA_CHARS)
        const columns = Object.fromEntries(COLUMNS.map((k) => [k, v[k]]))
        onSave({ ...columns, extra } as unknown as JobInput)
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {shownDefs.map((f) => (
          <div key={f.key} className="space-y-1">
            <Label htmlFor={`job-${f.key}`}>{f.label}</Label>
            <JobField def={f} value={v[f.key]} onChange={(x) => setV((s) => ({ ...s, [f.key]: x }))} />
          </div>
        ))}
      </div>
      <AddFieldMenu
        available={menuDefs}
        onPick={(key) => {
          setAdded((a) => [...a, key])
          setFocusKey(key)
        }}
      />
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" size="sm">
          Save job
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
