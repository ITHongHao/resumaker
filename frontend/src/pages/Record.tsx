import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { api, type Card, type CardKind, type Job } from '@/api'
import CardSection from '@/components/CardSection'
import JobForm from '@/components/JobForm'

const SECTIONS: { kind: CardKind; title: string; add: string }[] = [
  { kind: 'education', title: 'Education', add: 'Add education' },
  { kind: 'project', title: 'Projects', add: 'Add project' },
  { kind: 'skill', title: 'Skills', add: 'Add skill' },
  { kind: 'certificate', title: 'Certificates', add: 'Add certificate' },
  { kind: 'behavioral', title: 'Behavioral answers', add: 'Add behavioral answer' },
]

export default function Record() {
  const [jobs, setJobs] = useState<Job[]>([])
  const [cards, setCards] = useState<Card[]>([])
  const [error, setError] = useState<string | null>(null)
  const [addingJob, setAddingJob] = useState(false)

  const load = useCallback(async () => {
    try {
      const [j, c] = await Promise.all([api.listJobs(), api.listCards()])
      setJobs(j)
      setCards(c)
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])
  useEffect(() => {
    void load()
  }, [load])

  const countFor = (jobId: number) => cards.filter((c) => c.job_id === jobId).length

  return (
    <div className="space-y-10">
      <h1 className="text-xl font-semibold">Record</h1>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}

      <section aria-label="Employment" className="space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground">Employment</h2>
        {jobs.map((j) => (
          <Link
            key={j.id}
            to={`/record/jobs/${j.id}`}
            className="block rounded-2xl border border-border bg-card p-4 hover:bg-muted/40"
          >
            <div className="text-xs tracking-wide text-muted-foreground uppercase">
              {[j.company, [j.start_date, j.end_date].filter(Boolean).join(' to ')].filter(Boolean).join(' · ')}
            </div>
            <div className="font-semibold">{j.title}</div>
            <div className="text-sm text-muted-foreground">
              {countFor(j.id)} project{countFor(j.id) === 1 ? '' : 's'} and accomplishments
            </div>
          </Link>
        ))}
        {addingJob ? (
          <JobForm
            error={error}
            onCancel={() => setAddingJob(false)}
            onSave={async (j) => {
              try {
                await api.createJob(j)
                setAddingJob(false)
                await load()
              } catch (e) {
                setError((e as Error).message)
              }
            }}
          />
        ) : (
          <button
            type="button"
            className="w-full rounded-2xl border border-dashed border-border p-4 text-left text-sm text-primary hover:bg-muted/50"
            onClick={() => setAddingJob(true)}
          >
            + Add job
          </button>
        )}
      </section>

      {SECTIONS.map((s) => (
        <section key={s.kind} aria-label={s.title} className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground">{s.title}</h2>
          <CardSection
            jobId={null}
            cards={cards.filter((c) => c.job_id === null && c.kind === s.kind)}
            kinds={[s.kind]}
            addLabel={s.add}
            onChanged={() => void load()}
          />
        </section>
      ))}
    </div>
  )
}
