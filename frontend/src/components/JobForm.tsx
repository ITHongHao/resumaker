import { useEffect, useState } from 'react'

import type { Job, JobInput } from '@/api'
import AddFieldMenu from '@/components/AddFieldMenu'
import FieldInput from '@/components/FieldInput'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { FIELDS, formValue, MAX_EXTRA_CHARS, visibleKeys } from '@/lib/recordFields'

const DEFS = FIELDS.job
const COLUMNS = DEFS.filter((f) => f.column).map((f) => f.key)

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
  // Fields picked from the Add field menu, and selects whose "Other" box is open.
  const [added, setAdded] = useState<string[]>([])
  const [otherPicked, setOtherPicked] = useState<string[]>([])
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
            <FieldInput
              id={`job-${f.key}`}
              def={f}
              value={v[f.key]}
              // Job columns (company, title and so on) are not capped like stored-only fields.
              maxLength={f.column ? undefined : MAX_EXTRA_CHARS}
              otherPicked={otherPicked.includes(f.key)}
              onChange={(x) => setV((s) => ({ ...s, [f.key]: x }))}
              onOtherPicked={(p) => setOtherPicked((o) => (p ? [...o, f.key] : o.filter((k) => k !== f.key)))}
            />
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
