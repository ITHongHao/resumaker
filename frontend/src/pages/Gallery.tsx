import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { api, type ApplicationStatus, type ApplicationSummary } from '@/api'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

const STATUSES: { value: ApplicationStatus; label: string }[] = [
  { value: 'not_applied', label: 'Not applied' },
  { value: 'applied', label: 'Applied' },
  { value: 'interview', label: 'Interview' },
  { value: 'offer', label: 'Offer' },
  { value: 'rejected', label: 'Rejected' },
]

function ago(iso: string): string {
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ''
  const days = Math.floor((Date.now() - t) / 86_400_000)
  if (days <= 0) return 'edited today'
  if (days === 1) return 'edited yesterday'
  return `edited ${days} days ago`
}

function badgeTone(score: number) {
  if (score >= 80) return 'bg-emerald-100 text-emerald-800'
  if (score >= 50) return 'bg-amber-100 text-amber-800'
  return 'bg-muted text-muted-foreground'
}

function PageLines() {
  const w = ['35%', '100%', '90%', '80%', '100%', '85%']
  return (
    <div aria-hidden className="space-y-1.5">
      <div className="h-[7px] w-[55%] rounded bg-slate-300" />
      <div className="h-[5px] w-[35%] rounded bg-slate-200" />
      <div className="h-2" />
      {w.map((x, i) => (
        <div key={i} className={cn('h-[5px] rounded', i % 3 === 0 ? 'bg-slate-300' : 'bg-slate-200')} style={{ width: i % 3 === 0 ? '30%' : x }} />
      ))}
    </div>
  )
}

export default function Gallery() {
  const [apps, setApps] = useState<ApplicationSummary[] | null>(null)
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<ApplicationStatus | ''>('')
  const [error, setError] = useState('')

  useEffect(() => {
    let live = true
    api
      .listApplications({ q, status })
      .then((a) => {
        if (live) {
          setApps(a)
          setError('')
        }
      })
      .catch((e: Error) => live && setError(e.message))
    return () => {
      live = false
    }
  }, [q, status])

  const filtering = q.trim() !== '' || status !== ''
  const empty = apps !== null && apps.length === 0 && !filtering

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-xl font-semibold">Resumes</h1>
        <label className="sr-only" htmlFor="gallery-search">Search</label>
        <Input
          id="gallery-search"
          className="w-56"
          placeholder="Search role or company"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <label className="sr-only" htmlFor="gallery-status">Status</label>
        <select
          id="gallery-status"
          className="h-8 rounded-lg border border-border bg-background px-2 text-sm"
          value={status}
          onChange={(e) => setStatus(e.target.value as ApplicationStatus | '')}
        >
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
      </div>

      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

      {empty && (
        <div className="rounded-xl border border-dashed border-border p-6 text-center">
          <p className="font-medium">No resumes yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Start by filling in your <Link to="/record" className="text-primary underline">Record</Link>,
            then paste a job posting in New application.
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-4">
        <Link to="/resumes/new" aria-label="New application" className="block">
          <div className="flex aspect-[8.5/11] items-center justify-center rounded-xl border-2 border-dashed border-border text-3xl text-primary">+</div>
          <div className="mt-2 font-semibold">New application</div>
          <div className="text-xs text-muted-foreground">Paste a posting</div>
        </Link>

        {(apps ?? []).map((a) => (
          <Link key={a.id} to={`/applications/${a.id}`} className="block">
            <div className="relative aspect-[8.5/11] overflow-hidden rounded-xl bg-white p-3 shadow-md ring-1 ring-black/5">
              <span className={cn('absolute right-2 top-2 rounded-full px-2 py-0.5 text-[11px] font-semibold', badgeTone(a.score))}>{a.score}</span>
              <PageLines />
            </div>
            <div className="mt-2 font-semibold">{a.title || 'Untitled role'}</div>
            <div className="text-xs text-muted-foreground">
              {[a.company, ago(a.updated_at), a.format ?? 'tex', STATUSES.find((s) => s.value === a.status)?.label]
                .filter(Boolean)
                .join(' · ')}
            </div>
            {a.stale && (
              <div className="mt-1 text-xs text-amber-700">Record changed since this was made</div>
            )}
          </Link>
        ))}
      </div>

      {apps !== null && apps.length === 0 && filtering && (
        <p className="text-sm text-muted-foreground">No resumes match those filters.</p>
      )}
    </div>
  )
}
