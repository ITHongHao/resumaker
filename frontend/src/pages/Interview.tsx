import { useCallback, useEffect, useRef, useState } from 'react'

import { api, type AnswerDraft, type InterviewAnswer, type InterviewQuestion, type Job } from '@/api'
import AnswerCard, { StarBody, StarForm, emptyStar } from '@/components/AnswerCard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

const CATEGORIES = [
  'Leadership',
  'Teamwork and conflict',
  'Failure and learning',
  'Initiative',
  'Pressure and deadlines',
  'Technical experience',
  'Mine',
]

/** "c:12" -> "12"; only custom questions have an id. */
function customId(ref: string): string {
  if (!ref.startsWith('c:')) throw new Error('Built-in questions cannot be changed')
  return ref.slice(2)
}

type Draft = AnswerDraft & { ref: string }

export default function Interview() {
  const [questions, setQuestions] = useState<InterviewQuestion[] | null>(null)
  const [category, setCategory] = useState('All')
  const [selected, setSelected] = useState<string | null>(null)
  const [answers, setAnswers] = useState<InterviewAnswer[]>([])
  const [jobs, setJobs] = useState<Job[]>([])
  const [showHidden, setShowHidden] = useState(false)
  const [questionForm, setQuestionForm] = useState<{ ref: string | null; text: string } | null>(null)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [drafting, setDrafting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savingQuestion, setSavingQuestion] = useState(false)
  const [accepting, setAccepting] = useState(false)
  const lock = useRef(false)
  const selectedRef = useRef<string | null>(null)

  const loadQuestions = useCallback(async () => {
    setQuestions(await api.listQuestions(true))
  }, [])

  async function guard(fn: () => Promise<void>) {
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  useEffect(() => {
    void guard(loadQuestions)
  }, [loadQuestions])

  // Jobs only name an answer's job; answers still show without them.
  useEffect(() => {
    let live = true
    api
      .listJobs()
      .then((j) => live && setJobs(j))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [])

  useEffect(() => {
    selectedRef.current = selected
    setAdding(false)
    setDraft(null)
    setDrafting(false)
    setAnswers([])
    setError(null)
    if (!selected) {
      setAnswers([])
      return
    }
    let live = true
    api.listAnswers(selected).then((a) => live && setAnswers(a)).catch((e: Error) => live && setError(e.message))
    return () => {
      live = false
    }
  }, [selected])

  if (!questions) return error ? <p role="alert" className="text-destructive">{error}</p> : <p className="text-muted-foreground">Loading...</p>

  const visible = questions.filter((q) => !q.hidden && (category === 'All' || q.category === category))
  const hidden = questions.filter((q) => q.hidden)
  const current = questions.find((q) => q.ref === selected) ?? null

  const refreshAnswers = async () => {
    if (selected) setAnswers(await api.listAnswers(selected))
    await loadQuestions()
  }

  const row = (q: InterviewQuestion) => (
    <li key={q.ref} className="space-y-0.5">
      <button
        type="button"
        aria-current={q.ref === selected ? 'true' : undefined}
        onClick={() => setSelected(q.ref)}
        className={cn('block w-full rounded-lg px-2 py-1.5 text-left text-sm hover:bg-muted', q.ref === selected && 'bg-muted font-medium')}
      >
        {q.text}
      </button>
      <div className="flex items-center gap-2 px-2 text-xs text-muted-foreground">
        <span>
          {q.answer_count > 0 ? `Answered · ${q.answer_count} ${q.answer_count === 1 ? 'answer' : 'answers'}` : 'No answer yet'}
        </span>
        {q.hidden && (
          <Button size="xs" variant="outline" aria-label={`Unhide ${q.text}`} onClick={() => void guard(async () => { await api.setHidden(q.ref, false); await loadQuestions() })}>
            Unhide
          </Button>
        )}
      </div>
    </li>
  )

  async function saveQuestion() {
    if (!questionForm || !questionForm.text.trim() || lock.current) return
    lock.current = true
    setSavingQuestion(true)
    await guard(async () => {
      if (questionForm.ref) {
        await api.updateQuestion(customId(questionForm.ref), { text: questionForm.text.trim() })
      } else {
        const q = await api.createQuestion({ text: questionForm.text.trim() })
        if (category !== 'All' && category !== q.category) setCategory('All')
        setSelected(q.ref)
      }
      setQuestionForm(null)
      await loadQuestions()
    })
    lock.current = false
    setSavingQuestion(false)
  }

  async function runDraft() {
    const ref = selected
    if (!ref || drafting) return
    setDrafting(true)
    setDraft(null)
    setError(null)
    try {
      const d = await api.draftAnswer(ref)
      if (selectedRef.current === ref) setDraft({ ...d, ref })
    } catch (e) {
      if (selectedRef.current === ref) setError((e as Error).message)
    } finally {
      if (selectedRef.current === ref) setDrafting(false)
    }
  }

  async function accept() {
    if (!draft || lock.current) return
    lock.current = true
    setAccepting(true)
    const { ref, ...d } = draft
    await guard(async () => {
      await api.createAnswer({ question_ref: ref, situation: d.situation, task: d.task, action: d.action, result: d.result, source_card_ids: d.source_card_ids })
      setDraft(null)
      if (selectedRef.current === ref) await refreshAnswers()
      else await loadQuestions()
    })
    lock.current = false
    setAccepting(false)
  }

  return (
    <div className="grid gap-6 md:grid-cols-[18rem_1fr]">
      <aside className="space-y-3">
        <h1 className="text-xl font-semibold">Interview</h1>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Categories">
          {['All', ...CATEGORIES].map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={category === c}
              onClick={() => setCategory(c)}
              className={cn('rounded-full border border-border px-2.5 py-0.5 text-xs', category === c ? 'bg-foreground text-background' : 'hover:bg-muted')}
            >
              {c}
            </button>
          ))}
        </div>
        {visible.length === 0 ? (
          <p className="text-sm text-muted-foreground">No questions in this category</p>
        ) : (
          <ul className="space-y-1">{visible.map(row)}</ul>
        )}
        {questionForm && questionForm.ref === null ? (
          <QuestionForm saving={savingQuestion} value={questionForm.text} onChange={(text) => setQuestionForm({ ref: null, text })} onSave={saveQuestion} onCancel={() => setQuestionForm(null)} />
        ) : (
          <Button size="sm" variant="outline" onClick={() => setQuestionForm({ ref: null, text: '' })}>+ Add my own question</Button>
        )}
        {hidden.length > 0 && (
          <div className="space-y-1">
            <Button size="sm" variant="ghost" aria-expanded={showHidden} onClick={() => setShowHidden(!showHidden)}>
              Hidden ({hidden.length})
            </Button>
            {showHidden && <ul className="space-y-1">{hidden.map(row)}</ul>}
          </div>
        )}
      </aside>

      <section className="space-y-4">
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {!current ? (
          <p className="text-muted-foreground">Pick a question to prepare your answers.</p>
        ) : (
          <>
            {questionForm && questionForm.ref === current.ref ? (
              <QuestionForm saving={savingQuestion} value={questionForm.text} onChange={(text) => setQuestionForm({ ref: current.ref, text })} onSave={saveQuestion} onCancel={() => setQuestionForm(null)} />
            ) : (
              <h2 className="text-lg font-semibold">{current.text}</h2>
            )}
            <div className="flex flex-wrap gap-2">
              {current.builtin ? (
                !current.hidden && (
                  <Button size="sm" variant="outline" onClick={() => void guard(async () => { await api.setHidden(current.ref, true); setSelected(null); await loadQuestions() })}>
                    Hide question
                  </Button>
                )
              ) : (
                <>
                  <Button size="sm" variant="outline" onClick={() => setQuestionForm({ ref: current.ref, text: current.text })}>Edit question</Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => {
                      if (!window.confirm('Delete this question and all its answers?')) return
                      void guard(async () => {
                        await api.deleteQuestion(customId(current.ref))
                        setSelected(null)
                        await loadQuestions()
                      })
                    }}
                  >
                    Delete question
                  </Button>
                </>
              )}
            </div>

            {answers.length === 0 && !adding && <p className="text-sm text-muted-foreground">No answers yet</p>}
            {answers.map((a, i) => (
              <AnswerCard
                key={a.id}
                answer={a}
                index={i + 1}
                job={jobs.find((j) => j.id === a.job_id)}
                onUpdate={async (id, v) => {
                  await api.updateAnswer(id, { situation: v.situation, task: v.task, action: v.action, result: v.result })
                  await refreshAnswers()
                }}
                onDelete={(id) => {
                  if (!window.confirm('Delete this answer?')) return
                  void guard(async () => { await api.deleteAnswer(id); await refreshAnswers() })
                }}
              />
            ))}

            <div aria-live="polite">
              {drafting && <p className="text-sm text-muted-foreground">Drafting an answer from your Record...</p>}
              {draft && draft.ref === current.ref && (
                <div className="space-y-3 rounded-2xl border-2 border-primary/40 bg-primary/5 p-4">
                  <p className="text-sm font-medium">Suggested draft, not saved until you accept</p>
                  <StarBody a={draft} />
                  <div className="flex gap-2">
                    <Button size="sm" disabled={accepting} onClick={() => void accept()}>Accept</Button>
                    <Button size="sm" variant="outline" onClick={() => setDraft(null)}>Reject</Button>
                  </div>
                </div>
              )}
            </div>

            {adding ? (
              <StarForm
                initial={emptyStar}
                onCancel={() => setAdding(false)}
                onSave={async (v) => {
                  await api.createAnswer({ question_ref: current.ref, ...v })
                  setAdding(false)
                  await refreshAnswers()
                }}
              />
            ) : (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => setAdding(true)}>+ Add an answer</Button>
                <Button size="sm" disabled={drafting} onClick={() => void runDraft()}>
                  {answers.length > 0 ? 'Draft another version' : 'Draft an answer'}
                </Button>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  )
}

function QuestionForm({ saving, value, onChange, onSave, onCancel }: { saving: boolean; value: string; onChange: (v: string) => void; onSave: () => void; onCancel: () => void }) {
  return (
    <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); onSave() }}>
      <Label htmlFor="q-text">Question</Label>
      <Input id="q-text" value={value} onChange={(e) => onChange(e.target.value)} />
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={saving}>Save question</Button>
        <Button type="button" size="sm" variant="outline" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  )
}
