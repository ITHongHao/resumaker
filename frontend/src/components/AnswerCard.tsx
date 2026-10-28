import { useRef, useState } from 'react'

import type { InterviewAnswer, Job, StarParts } from '@/api'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'

export const STAR: { key: keyof StarParts; label: string }[] = [
  { key: 'situation', label: 'Situation' },
  { key: 'task', label: 'Task' },
  { key: 'action', label: 'Action' },
  { key: 'result', label: 'Result' },
]

export const emptyStar: StarParts = { situation: '', task: '', action: '', result: '' }

export function StarForm({
  initial,
  onSave,
  onCancel,
}: {
  initial: StarParts
  onSave: (v: StarParts) => Promise<void> | void
  onCancel: () => void
}) {
  const [v, setV] = useState<StarParts>(initial)
  const [id] = useState(() => Math.random().toString(36).slice(2))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const busy = useRef(false)
  async function submit() {
    if (busy.current) return
    busy.current = true
    setSaving(true)
    setError(null)
    try {
      await onSave(v)
    } catch (e) {
      // Stay open with the user's text; the parent only closes the form on success.
      setError((e as Error).message)
    } finally {
      busy.current = false
      setSaving(false)
    }
  }
  return (
    <form
      className="space-y-3 rounded-2xl border border-border p-4"
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      {STAR.map(({ key, label }) => (
        <div key={key} className="space-y-1">
          <Label htmlFor={`${id}-${key}`}>{label}</Label>
          <textarea
            id={`${id}-${key}`}
            className="min-h-16 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm"
            value={v[key]}
            onChange={(e) => setV({ ...v, [key]: e.target.value })}
          />
        </div>
      ))}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={saving}>Save answer</Button>
        <Button type="button" size="sm" variant="outline" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  )
}

export function StarBody({ a }: { a: StarParts }) {
  return (
    <dl className="space-y-2 text-sm">
      {STAR.map(({ key, label }) => (
        <div key={key}>
          <dt data-testid="star-label" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</dt>
          <dd className="whitespace-pre-wrap">{a[key]}</dd>
        </div>
      ))}
    </dl>
  )
}

export default function AnswerCard({
  answer,
  index,
  job,
  onUpdate,
  onDelete,
}: {
  answer: InterviewAnswer
  index: number
  /** The answer's job (answer.job_id), when it has one. */
  job?: Job
  onUpdate: (id: number, v: StarParts) => Promise<void>
  onDelete: (id: number) => void
}) {
  const [editing, setEditing] = useState(false)
  if (editing)
    return (
      <StarForm
        initial={answer}
        onCancel={() => setEditing(false)}
        onSave={async (v) => {
          await onUpdate(answer.id, v)
          setEditing(false)
        }}
      />
    )
  return (
    <article className="space-y-3 rounded-2xl border border-border p-4">
      {job && <p className="text-xs text-muted-foreground">Job: {[job.title, job.company].filter(Boolean).join(', ')}</p>}
      <StarBody a={answer} />
      {answer.source_cards.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Built from:{' '}
          {answer.source_cards.map((s, i) => (
            <span key={s.id}>
              {i > 0 && ', '}
              {'removed' in s ? 'source removed' : s.title}
            </span>
          ))}
        </p>
      )}
      <div className="flex gap-2">
        <Button size="sm" variant="outline" aria-label={`Edit answer ${index}`} onClick={() => setEditing(true)}>Edit answer</Button>
        <Button size="sm" variant="destructive" aria-label={`Delete answer ${index}`} onClick={() => onDelete(answer.id)}>Delete answer</Button>
      </div>
    </article>
  )
}
