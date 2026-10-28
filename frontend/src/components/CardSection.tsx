import { useState } from 'react'

import { api, type Card, type CardDraft, type CardKind } from '@/api'
import CardForm from '@/components/CardForm'
import CardItem from '@/components/CardItem'

const addClass =
  'w-full rounded-2xl border border-dashed border-border p-4 text-left text-sm text-primary hover:bg-muted/50'

/** A list of cards with manual add / edit / delete. jobId null = a non-job section. */
export default function CardSection({
  jobId,
  cards,
  kinds,
  addLabel,
  onChanged,
}: {
  jobId: number | null
  cards: Card[]
  kinds: CardKind[]
  addLabel: string
  onChanged: () => void
}) {
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function run(fn: () => Promise<unknown>, done: () => void) {
    setError(null)
    try {
      await fn()
      done()
      onChanged()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <div className="space-y-3">
      {cards.map((c) =>
        editing === c.id ? (
          <CardForm
            key={c.id}
            initial={c}
            kinds={kinds}
            error={error}
            onCancel={() => setEditing(null)}
            onSave={(d: CardDraft) => run(() => api.updateCard(c.id, d), () => setEditing(null))}
          />
        ) : (
          <CardItem
            key={c.id}
            card={c}
            onEdit={() => {
              setError(null)
              setEditing(c.id)
            }}
            onDelete={() => run(() => api.deleteCard(c.id), () => {})}
          />
        ),
      )}
      {adding ? (
        <CardForm
          kinds={kinds}
          error={error}
          onCancel={() => setAdding(false)}
          onSave={(d) => run(() => api.createCard({ ...d, job_id: jobId }), () => setAdding(false))}
        />
      ) : (
        <button
          type="button"
          className={addClass}
          onClick={() => {
            setError(null)
            setAdding(true)
          }}
        >
          + {addLabel}
        </button>
      )}
      {!adding && editing === null && error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
