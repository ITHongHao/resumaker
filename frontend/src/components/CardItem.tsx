import type { Card } from '@/api'
import { Button } from '@/components/ui/button'

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
      <TagChips tags={card.tags} />
    </div>
  )
}
