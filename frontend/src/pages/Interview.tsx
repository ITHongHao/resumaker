import { useCallback, useEffect, useState } from 'react'

import { api, type AnswerDraft, type InterviewAnswer, type InterviewQuestion } from '@/api'
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

export default function Interview() {
  const [questions, setQuestions] = useState<InterviewQuestion[] | null>(null)
  const [category, setCategory] = useState('All')
  const [selected, setSelected] = useState<string | null>(null)
  const [answers, setAnswers] = useState<InterviewAnswer[]>([])
  const [showHidden, setShowHidden] = useState(false)
  const [questionForm, setQuestionForm] = useState<{ ref: string | null; text: string } | null>(null)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState<AnswerDraft | null>(null)
  const [drafting, setDrafting] = useState(false)
  const [error, setError] = useState<string | null>(null)

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

  useEffect(() => {
    setAdding(false)
    setDraft(null)
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
        onClick={() => setSelected(q.ref)}
        className={cn('block w-full rounded-lg px-2 py-1.5 text-left text-sm hover:bg-muted', q.ref === selected && 'bg-muted font-medium')}
      >
        {q.text}
      </button>
      <div className="flex items-center gap-2 px-2 text-xs text-muted-foreground">
        <span>{q.answer_count > 0 ? 'Answered' : 'No answer yet'}</span>
        {q.hidden && (
          <Button size="xs" variant="outline" onClick={() => void guard(async () => { await api.setHidden(q.ref, false); await loadQuestions() })}>
            Unhide
          </Button>
        )}
      </div>
    </li>
  )

  async function saveQuestion() {
    if (!questionForm || !questionForm.text.trim()) return
    await guard(async () => {
      if (questionForm.ref) {
        await api.updateQuestion(questionForm.ref.slice(2), { text: questionForm.text.trim() })
      } else {
        const q = await api.createQuestion({ text: questionForm.text.trim() })
        setSelected(q.ref)
      }
      setQuestionForm(null)
      await loadQuestions()
    })
  }

  async function runDraft() {
    if (!selected) return
    setDrafting(true)
    setDraft(null)
    await guard(async () => setDraft(await api.draftAnswer(selected)))
    setDrafting(false)
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
        <ul className="space-y-1">{visible.map(row)}</ul>
        {questionForm && questionForm.ref === null ? (
          <QuestionForm value={questionForm.text} onChange={(text) => setQuestionForm({ ref: null, text })} onSave={saveQuestion} onCancel={() => setQuestionForm(null)} />
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
              <QuestionForm value={questionForm.text} onChange={(text) => setQuestionForm({ ref: current.ref, text })} onSave={saveQuestion} onCancel={() => setQuestionForm(null)} />
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
                        await api.deleteQuestion(current.ref.slice(2))
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

            {answers.map((a) => (
              <AnswerCard
                key={a.id}
                answer={a}
                onUpdate={async (id, v) => { await guard(async () => { await api.updateAnswer(id, v); await refreshAnswers() }) }}
                onDelete={(id) => {
                  if (!window.confirm('Delete this answer?')) return
                  void guard(async () => { await api.deleteAnswer(id); await refreshAnswers() })
                }}
              />
            ))}

            {draft && (
              <div className="space-y-3 rounded-2xl border-2 border-primary/40 bg-primary/5 p-4">
                <p className="text-sm font-medium">Suggested draft, not saved until you accept</p>
                <StarBody a={draft} />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={() => void guard(async () => {
                      await api.createAnswer({ question_ref: current.ref, situation: draft.situation, task: draft.task, action: draft.action, result: draft.result, source_card_ids: draft.source_card_ids })
                      setDraft(null)
                      await refreshAnswers()
                    })}
                  >
                    Accept
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setDraft(null)}>Reject</Button>
                </div>
              </div>
            )}

            {adding ? (
              <StarForm
                initial={emptyStar}
                onCancel={() => setAdding(false)}
                onSave={(v) => guard(async () => {
                  await api.createAnswer({ question_ref: current.ref, ...v })
                  setAdding(false)
                  await refreshAnswers()
                })}
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

function QuestionForm({ value, onChange, onSave, onCancel }: { value: string; onChange: (v: string) => void; onSave: () => void; onCancel: () => void }) {
  return (
    <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); onSave() }}>
      <Label htmlFor="q-text">Question</Label>
      <Input id="q-text" value={value} onChange={(e) => onChange(e.target.value)} />
      <div className="flex gap-2">
        <Button type="submit" size="sm">Save question</Button>
        <Button type="button" size="sm" variant="outline" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  )
}
