import { useState } from 'react'

import type { Job, JobInput } from '@/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const FIELDS: [Exclude<keyof JobInput, 'extra'>, string][] = [
  ['company', 'Company'],
  ['title', 'Job title'],
  ['location', 'Location'],
  ['employment_type', 'Employment type'],
  ['start_date', 'Start date'],
  ['end_date', 'End date'],
  ['manager_contact', 'Manager contact'],
  ['reason_for_leaving', 'Reason for leaving'],
]

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
  const [v, setV] = useState<JobInput>({
    company: initial?.company ?? '',
    title: initial?.title ?? '',
    location: initial?.location ?? '',
    employment_type: initial?.employment_type ?? '',
    start_date: initial?.start_date ?? '',
    end_date: initial?.end_date ?? '',
    manager_contact: initial?.manager_contact ?? '',
    reason_for_leaving: initial?.reason_for_leaving ?? '',
  })
  return (
    <form
      className="space-y-3 rounded-2xl border border-border bg-card p-4"
      onSubmit={(e) => {
        e.preventDefault()
        onSave(v)
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {FIELDS.map(([k, label]) => (
          <div key={k} className="space-y-1">
            <Label htmlFor={`job-${k}`}>{label}</Label>
            <Input id={`job-${k}`} value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} />
          </div>
        ))}
      </div>
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
