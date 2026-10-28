import type { Card } from '@/api'
import { Button } from '@/components/ui/button'
import { displayValue, fieldsFor, knownExtra } from '@/lib/recordFields'

export function TagChips({ tags }: { tags: string[] }) {
  if (!tags.length) return null
  return (
    <div className="flex flex-wrap gap-1.5">
      {tags.map((t) => (
        <span key={t} className="rounded-full bg-muted px-2.5 py-1 text-xs">
          {t}
        </span>
      ))}
    </div>
  )
}

function CardExtra({ card }: { card: Card }) {
  const values = knownExtra(card.kind, card.extra)
  const fields = fieldsFor(card.kind).filter((f) => values[f.key])
  if (!fields.length) return null
  return (
    <dl className="mb-2.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
      {fields.map((f) => (
        <div key={f.key} className="flex gap-1">
          <dt>{f.label}:</dt>
          <dd className="text-foreground">{displayValue(f, values[f.key])}</dd>
        </div>
      ))}
    </dl>
  )
}

export default function CardItem({
  card,
  onEdit,
  onDelete,
}: {
  card: Card
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="font-semibold">{card.title}</div>
        <div className="flex shrink-0 gap-1">
          <Button variant="ghost" size="xs" onClick={onEdit} aria-label={`Edit ${card.title}`}>
            Edit
          </Button>
          <Button variant="ghost" size="xs" onClick={onDelete} aria-label={`Delete ${card.title}`}>
            Delete
          </Button>
        </div>
      </div>
      {card.description && <p className="mt-1.5 mb-2.5 text-sm leading-relaxed text-muted-foreground">{card.description}</p>}
      <CardExtra card={card} />
      {card.details && (
        <p className="mb-2.5 text-xs leading-relaxed whitespace-pre-line text-muted-foreground">
          <span className="font-medium">Details: </span>
          {card.details}
        </p>
      )}
      <TagChips tags={card.tags} />
    </div>
  )
}
