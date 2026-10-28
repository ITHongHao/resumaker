import { useState } from 'react'

import type { CardDraft, CardKind } from '@/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { EXTRA_FIELDS, JOBLESS_ACCOMPLISHMENT, knownExtra, MAX_EXTRA_CHARS } from '@/lib/cardFields'

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

const ALL_EXTRA_KEYS = new Set(Object.values(EXTRA_FIELDS).flatMap((fs) => fs.map((f) => f.key)))

/** `extra` keys no form field edits (from an import); they are kept as they are. */
function otherExtra(extra: Record<string, unknown> | undefined): Record<string, unknown> {
  return Object.fromEntries(Object.entries(extra ?? {}).filter(([k]) => !ALL_EXTRA_KEYS.has(k)))
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
      Object.entries(initial?.extra ?? {}).flatMap(([k, v]) => (ALL_EXTRA_KEYS.has(k) && typeof v === 'string' ? [[k, v]] : [])),
    ),
  )

  // A project under a job prints as that job's bullets, without its own dates, so its date
  // fields are only offered for a standalone project.
  const shownFields = kind === 'project' && !jobless ? [] : (EXTRA_FIELDS[kind] ?? [])

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
              Object.entries(knownExtra(kind, fields)).filter(([k]) => shownFields.some((f) => f.key === k)),
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
        <Label htmlFor="card-title">Title</Label>
        <Input id="card-title" value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="card-description">Description</Label>
        <Textarea id="card-description" value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      {shownFields.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-3">
          {shownFields.map((f) => (
            <div key={f.key} className="space-y-1">
              <Label htmlFor={`card-${f.key}`}>{f.label}</Label>
              <Input
                id={`card-${f.key}`}
                placeholder={f.placeholder}
                maxLength={MAX_EXTRA_CHARS}
                value={fields[f.key] ?? ''}
                onChange={(e) => setFields((x) => ({ ...x, [f.key]: e.target.value }))}
              />
            </div>
          ))}
        </div>
      )}
      <div className="space-y-1">
        <Label htmlFor="card-details">Details</Label>
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
