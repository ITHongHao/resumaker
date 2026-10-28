import { useEffect, useState } from 'react'

import { api, type Card, type CardDraft, type ChatTurn, type Job } from '@/api'
import CardForm, { KIND_LABELS } from '@/components/CardForm'
import { TagChips } from '@/components/CardItem'
import { Button } from '@/components/ui/button'
import { fieldsFor, JOB_KINDS, JOBLESS_ACCOMPLISHMENT, JOBLESS_KINDS, knownExtra } from '@/lib/recordFields'

type Msg = { role: 'user' | 'assistant'; text: string; proposals?: CardDraft[]; followups?: string[] }

function ExtraList({ kind, extra }: { kind: CardDraft['kind']; extra: CardDraft['extra'] }) {
  const shown = knownExtra(kind, extra)
  const fields = fieldsFor(kind).filter((f) => shown[f.key])
  if (!fields.length) return null
  return (
    <dl className="my-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
      {fields.map((f) => (
        <div key={f.key} className="flex gap-1">
          <dt>{f.label}</dt>
          <dd className="text-foreground">{shown[f.key]}</dd>
        </div>
      ))}
    </dl>
  )
}

export default function AskAIDrawer({
  jobId,
  onAdded,
  label = '✦ Ask AI',
  initialMessage = '',
  describedBy,
  chooseJob = false,
}: {
  /** Job the conversation is about, or null for something outside any job. */
  jobId: number | null
  /** Let the user pick which job (or none) new cards belong to; `jobId` is the default. */
  chooseJob?: boolean
  onAdded?: (c: Card) => void
  label?: string
  /** Prefills the message box when the drawer opens. It is not sent until the user presses Send. */
  initialMessage?: string
  describedBy?: string
}) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState(initialMessage)
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // Which proposal is being edited, as "msgIndex:proposalIndex"
  const [editing, setEditing] = useState<string | null>(null)
  // Where accepted cards go. Fixed to jobId unless chooseJob.
  const [parent, setParent] = useState<number | null>(jobId)
  const [jobs, setJobs] = useState<Job[]>([])

  useEffect(() => {
    if (!open || !chooseJob) return
    let live = true
    api
      .listJobs()
      .then((j) => live && setJobs(j))
      .catch(() => {
        /* the picker then offers only "No job" */
      })
    return () => {
      live = false
    }
  }, [open, chooseJob])
  const kinds = parent === null ? JOBLESS_KINDS : JOB_KINDS

  async function send() {
    const message = text.trim()
    if (!message || busy) return
    const history: ChatTurn[] = msgs.map((m) => ({ role: m.role, content: m.text }))
    setBusy(true)
    setError(null)
    try {
      const r = await api.propose(parent, message, history)
      setMsgs((m) => [
        ...m,
        { role: 'user', text: message },
        { role: 'assistant', text: r.reply, proposals: r.proposals, followups: r.followups },
      ])
      setText('')
    } catch (e) {
      // Leave the conversation and the typed message untouched.
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function accept(mi: number, pi: number, d: CardDraft) {
    setError(null)
    try {
      // Exactly the fields the proposal box (or the edit form) shows; nothing else the model sent.
      const card = await api.createCard({
        job_id: parent,
        kind: d.kind,
        title: d.title,
        description: d.description ?? '',
        details: d.details ?? '',
        tags: d.tags ?? [],
        extra: knownExtra(d.kind, d.extra),
      })
      setMsgs((ms) =>
        ms.map((m, i) => (i === mi ? { ...m, proposals: m.proposals?.filter((_, j) => j !== pi) } : m)),
      )
      setEditing(null)
      onAdded?.(card)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <>
      <Button variant="outline" className="rounded-full" aria-describedby={describedBy} onClick={() => setOpen(true)}>
        {label}
      </Button>
      {open && (
        <div className="fixed inset-0 z-40 flex justify-end bg-black/30">
          <div className="flex-1" onClick={() => setOpen(false)} aria-hidden />
          <aside
            role="dialog"
            aria-label="Ask AI"
            className="flex h-full w-full max-w-md flex-col bg-background p-5 shadow-[-8px_0_24px_rgba(0,0,0,.12)]"
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-semibold">✦ Ask AI</h2>
              <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={() => setOpen(false)}>
                ✕
              </Button>
            </div>
            {chooseJob && (
              <div className="mb-3 space-y-1 text-sm">
                <label htmlFor="ask-ai-parent" className="font-medium">
                  New cards belong to
                </label>
                <select
                  id="ask-ai-parent"
                  className="h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm"
                  value={parent === null ? '' : String(parent)}
                  onChange={(e) => setParent(e.target.value === '' ? null : Number(e.target.value))}
                >
                  <option value="">No job (a project, skill, certificate, ...)</option>
                  {jobs.map((j) => (
                    <option key={j.id} value={String(j.id)}>
                      {[j.title, j.company].filter(Boolean).join(' at ')}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="flex flex-1 flex-col gap-3 overflow-y-auto">
              <div className="max-w-[90%] rounded-2xl rounded-bl-sm bg-muted px-3.5 py-2.5 text-sm">
                Tell me about anything you worked on here. I will suggest cards; nothing is saved until you click Add.
              </div>
              {msgs.map((m, mi) =>
                m.role === 'user' ? (
                  <div key={mi} className="max-w-[90%] self-end rounded-2xl rounded-br-sm bg-foreground px-3.5 py-2.5 text-sm text-background">
                    {m.text}
                  </div>
                ) : (
                  <div key={mi} className="space-y-2">
                    <div className="max-w-[90%] rounded-2xl rounded-bl-sm bg-muted px-3.5 py-2.5 text-sm">{m.text}</div>
                    {m.proposals?.map((p, pi) =>
                      editing === `${mi}:${pi}` ? (
                        <CardForm
                          key={pi}
                          initial={p}
                          kinds={kinds}
                          jobless={parent === null}
                          onCancel={() => setEditing(null)}
                          onSave={(d) => accept(mi, pi, d)}
                          error={error}
                        />
                      ) : (
                        <div
                          key={pi}
                          data-proposal
                          className="rounded-xl border border-blue-200 bg-blue-50/70 p-3 text-sm dark:border-blue-900 dark:bg-blue-950/30"
                        >
                          <div className="mb-1 font-semibold text-primary">
                            Suggested addition · {KIND_LABELS[p.kind] ?? p.kind}
                          </div>
                          <div className="font-medium">{p.title}</div>
                          {p.description && <p className="my-1 text-muted-foreground">{p.description}</p>}
                          {p.details && <p className="my-1 text-muted-foreground">{p.details}</p>}
                          <ExtraList kind={p.kind} extra={p.extra} />
                          <TagChips tags={p.tags ?? []} />
                          {parent === null && p.kind === 'accomplishment' && (
                            <p className="mt-1 text-xs text-amber-800">
                              {JOBLESS_ACCOMPLISHMENT} Pick a job above, or use Edit.
                            </p>
                          )}
                          <div className="mt-2 flex gap-2">
                            <Button
                              size="sm"
                              className="rounded-full"
                              disabled={parent === null && p.kind === 'accomplishment'}
                              onClick={() => accept(mi, pi, p)}
                            >
                              Add
                            </Button>
                            <Button size="sm" variant="outline" className="rounded-full" onClick={() => setEditing(`${mi}:${pi}`)}>
                              Edit
                            </Button>
                          </div>
                        </div>
                      ),
                    )}
                    {m.followups?.map((f, fi) => (
                      <div key={fi} className="text-sm text-muted-foreground">
                        {f}
                      </div>
                    ))}
                  </div>
                ),
              )}
            </div>
            {error && editing === null && (
              <p role="alert" className="mt-3 rounded-lg bg-destructive/10 p-2.5 text-sm text-destructive">
                {error}
              </p>
            )}
            <form
              className="mt-4 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                void send()
              }}
            >
              <input
                className="h-10 flex-1 rounded-full border border-border bg-transparent px-4 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                placeholder="Describe what you did..."
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
              <Button type="submit" className="rounded-full" disabled={busy}>
                Send
              </Button>
            </form>
          </aside>
        </div>
      )}
    </>
  )
}
