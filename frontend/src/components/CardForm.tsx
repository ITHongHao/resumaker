import { useState } from 'react'

import type { CardDraft, CardKind } from '@/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

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
}: {
  initial?: Partial<CardDraft>
  kinds: CardKind[]
  onSave: (d: CardDraft) => void
  onCancel: () => void
  error?: string | null
  saving?: boolean
}) {
  const [kind, setKind] = useState<CardKind>(initial?.kind ?? kinds[0])
  const [title, setTitle] = useState(initial?.title ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [tags, setTags] = useState((initial?.tags ?? []).join(', '))

  return (
    <form
      className="space-y-3 rounded-2xl border border-border bg-card p-4"
      onSubmit={(e) => {
        e.preventDefault()
        onSave({ kind, title: title.trim(), description, tags: parseTags(tags), extra: initial?.extra })
      }}
    >
      {kinds.length > 1 && (
        <div className="space-y-1">
          <Label htmlFor="card-kind">Kind</Label>
          <select id="card-kind" className={selectClass} value={kind} onChange={(e) => setKind(e.target.value as CardKind)}>
            {kinds.map((k) => (
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
      <div className="space-y-1">
        <Label htmlFor="card-tags">Tags (comma separated)</Label>
        <Input id="card-tags" value={tags} onChange={(e) => setTags(e.target.value)} />
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
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
