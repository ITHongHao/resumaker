import { useEffect, useState } from 'react'

import type { CardDraft, CardKind } from '@/api'
import AddFieldMenu from '@/components/AddFieldMenu'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  type FieldDef,
  fieldsFor,
  JOBLESS_ACCOMPLISHMENT,
  KNOWN_KEYS,
  knownExtra,
  MAX_EXTRA_CHARS,
  TITLE_LABELS,
  visibleKeys,
  YESNO_OPTIONS,
} from '@/lib/recordFields'

export const KIND_LABELS: Record<CardKind, string> = {
  project: 'Project',
  accomplishment: 'Accomplishment',
  education: 'Education',
  skill: 'Skill',
  certificate: 'Certificate',
  behavioral: 'Behavioral answer',
}

const selectClass =
  'h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50'

/** `extra` keys no section has a field for (from an import); they are kept as they are. */
function otherExtra(extra: Record<string, unknown> | undefined): Record<string, unknown> {
  return Object.fromEntries(Object.entries(extra ?? {}).filter(([k]) => !KNOWN_KEYS.has(k)))
}

const OTHER = 'Other'

function FieldInput({
  def,
  value,
  otherPicked,
  onChange,
  onOtherPicked,
}: {
  def: FieldDef
  value: string
  otherPicked: boolean
  onChange: (v: string) => void
  onOtherPicked: (picked: boolean) => void
}) {
  const id = `card-${def.key}`
  if (def.type === 'text') {
    return <Input id={id} placeholder={def.placeholder} maxLength={MAX_EXTRA_CHARS} value={value} onChange={(e) => onChange(e.target.value)} />
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
          maxLength={MAX_EXTRA_CHARS}
          value={options.includes(value) ? '' : value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  )
}

export function parseTags(s: string): string[] {
  return s
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
}

export default function CardForm({
  initial,
  kinds,
  onSave,
  onCancel,
  error,
  saving,
  jobless = false,
}: {
  initial?: Partial<CardDraft>
  kinds: CardKind[]
  /** The card belongs to no job, so it may not be an accomplishment. */
  jobless?: boolean
  onSave: (d: CardDraft) => void
  onCancel: () => void
  error?: string | null
  saving?: boolean
}) {
  const [kind, setKind] = useState<CardKind>(initial?.kind ?? kinds[0])
  const [problem, setProblem] = useState<string | null>(null)
  // A card whose kind is not offered here (an old import, a model proposal) still shows it.
  const options = initial?.kind && !kinds.includes(initial.kind) ? [initial.kind, ...kinds] : kinds
  const [title, setTitle] = useState(initial?.title ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [tags, setTags] = useState((initial?.tags ?? []).join(', '))
  const [details, setDetails] = useState(initial?.details ?? '')
  // Every known field's value, kept across kind switches; only the current kind's are saved.
  const [fields, setFields] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      Object.entries(initial?.extra ?? {}).flatMap(([k, v]) => (KNOWN_KEYS.has(k) && typeof v === 'string' ? [[k, v]] : [])),
    ),
  )
  // Fields picked from the Add field menu, and selects whose "Other" box is open.
  const [added, setAdded] = useState<string[]>([])
  const [otherPicked, setOtherPicked] = useState<string[]>([])
  const [focusKey, setFocusKey] = useState<string | null>(null)
  useEffect(() => {
    if (focusKey) document.getElementById(`card-${focusKey}`)?.focus()
  }, [focusKey])

  // A project under a job prints as that job's bullets, without its own dates, so its date
  // fields are only offered for a standalone project.
  const defs = fieldsFor(kind).filter((f) => !(kind === 'project' && !jobless && /_date$/.test(f.key)))
  const shownKeys = new Set([...visibleKeys(defs, fields), ...added])
  const shownDefs = defs.filter((f) => shownKeys.has(f.key))
  const menuDefs = defs.filter((f) => !shownKeys.has(f.key))
  const story = kind === 'project' || kind === 'accomplishment'

  return (
    <form
      className="space-y-3 rounded-2xl border border-border bg-card p-4"
      onSubmit={(e) => {
        e.preventDefault()
        if (jobless && kind === 'accomplishment') {
          setProblem(JOBLESS_ACCOMPLISHMENT)
          return
        }
        setProblem(null)
        onSave({
          kind,
          title: title.trim(),
          description,
          details,
          tags: parseTags(tags),
          // Only the fields this form shows (plus untouched imported keys); nothing hidden.
          extra: {
            ...otherExtra(initial?.extra),
            ...Object.fromEntries(
              Object.entries(knownExtra(kind, fields)).filter(([k]) => shownKeys.has(k) && defs.some((f) => f.key === k)),
            ),
          },
        })
      }}
    >
      {options.length > 1 && (
        <div className="space-y-1">
          <Label htmlFor="card-kind">Kind</Label>
          <select id="card-kind" className={selectClass} value={kind} onChange={(e) => setKind(e.target.value as CardKind)}>
            {options.map((k) => (
              <option key={k} value={k}>
                {KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="space-y-1">
        <Label htmlFor="card-title">{TITLE_LABELS[kind] ?? 'Title'}</Label>
        <Input id="card-title" value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="card-description">{story ? 'What it did' : 'Description'}</Label>
        <Textarea id="card-description" value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      {shownDefs.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-3">
          {shownDefs.map((f) => (
            <div key={f.key} className="space-y-1">
              <Label htmlFor={`card-${f.key}`}>{f.label}</Label>
              <FieldInput
                def={f}
                value={fields[f.key] ?? ''}
                otherPicked={otherPicked.includes(f.key)}
                onChange={(v) => setFields((x) => ({ ...x, [f.key]: v }))}
                onOtherPicked={(p) => setOtherPicked((o) => (p ? [...o, f.key] : o.filter((k) => k !== f.key)))}
              />
            </div>
          ))}
        </div>
      )}
      <AddFieldMenu
        available={menuDefs}
        onPick={(key) => {
          setAdded((a) => [...a, key])
          setFocusKey(key)
        }}
      />
      <div className="space-y-1">
        <Label htmlFor="card-details">{story ? 'Results and numbers' : 'Details'}</Label>
        <Textarea
          id="card-details"
          aria-describedby="card-details-hint"
          value={details}
          onChange={(e) => setDetails(e.target.value)}
        />
        <p id="card-details-hint" className="text-xs text-muted-foreground">
          More detail than ever appears on the resume: context, numbers, tools. Auto cater may draw on it.
        </p>
      </div>
      <div className="space-y-1">
        <Label htmlFor="card-tags">Tags (comma separated)</Label>
        <Input id="card-tags" value={tags} onChange={(e) => setTags(e.target.value)} />
      </div>
      {(problem ?? error) && (
        <p role="alert" className="text-sm text-destructive">
          {problem ?? error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={saving}>
          Save
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
