import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { api, type Card, type Job, type JobInput } from '@/api'
import AskAIDrawer from '@/components/AskAIDrawer'
import CardSection from '@/components/CardSection'
import JobForm from '@/components/JobForm'
import { Button } from '@/components/ui/button'
import { FIELDS, hasValue } from '@/lib/recordFields'

export default function JobPage() {
  const id = Number(useParams().id)
  const nav = useNavigate()
  const [job, setJob] = useState<Job | null>(null)
  const [cards, setCards] = useState<Card[]>([])
  const [error, setError] = useState<string | null>(null)
  const [editingJob, setEditingJob] = useState(false)

  const load = useCallback(async () => {
    try {
      const [j, cs] = await Promise.all([api.getJob(id), api.listCards({ job_id: id })])
      setJob(j)
      setCards(cs)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [id])
  useEffect(() => {
    void load()
  }, [load])

  if (error && !job)
    return (
      <p role="alert" className="text-destructive">
        {error}
      </p>
    )
  if (!job) return <p className="text-muted-foreground">Loading...</p>

  const dates = [job.start_date, job.end_date].filter(Boolean).join(' to ')
  // Optional job fields that hold a value (location, manager, salary and so on).
  const record = job as unknown as Record<string, unknown>
  const details = FIELDS.job
    .filter((f) => !['company', 'title', 'start_date', 'end_date'].includes(f.key))
    .flatMap((f) => {
      const val = f.column ? record[f.key] : job.extra?.[f.key]
      return hasValue(val) ? [f.key === 'location' ? String(val) : `${f.label}: ${String(val)}`] : []
    })
  return (
    <div className="space-y-6">
      <Link to="/record" className="text-sm text-muted-foreground hover:underline">
        &larr; Record
      </Link>
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-xs tracking-wide text-muted-foreground uppercase">
            {[job.company, dates].filter(Boolean).join(' · ')}
          </div>
          <h1 className="text-xl font-semibold">{job.title}</h1>
          {details.length > 0 && <div className="text-sm text-muted-foreground">{details.join(' · ')}</div>}
        </div>
        <AskAIDrawer jobId={id} onAdded={() => void load()} />
      </div>

      <section aria-label="Projects and work" className="space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground">Projects and work</h2>
        <CardSection
          jobId={id}
          cards={cards}
          kinds={['project', 'accomplishment']}
          addLabel="Add project or accomplishment"
          onChanged={() => void load()}
        />
      </section>

      <section aria-label="Job details" className="space-y-3">
        {editingJob ? (
          <JobForm
            initial={job}
            error={error}
            onCancel={() => setEditingJob(false)}
            onSave={async (j: JobInput) => {
              try {
                setJob(await api.updateJob(id, j))
                setError(null)
                setEditingJob(false)
              } catch (e) {
                setError((e as Error).message)
              }
            }}
          />
        ) : (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setEditingJob(true)}>
              Edit job details
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={async () => {
                if (!window.confirm('Delete this job and all its cards?')) return
                try {
                  await api.deleteJob(id)
                  nav('/record')
                } catch (e) {
                  setError((e as Error).message)
                }
              }}
            >
              Delete job
            </Button>
          </div>
        )}
      </section>
    </div>
  )
}
