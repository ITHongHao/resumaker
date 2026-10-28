import type { MatchStatus, RequirementMatch } from '@/api'
import { cn } from '@/lib/utils'

const LOOK: Record<MatchStatus, { icon: string; cls: string; ring: string }> = {
  matched: { icon: '✓', cls: 'bg-[#e8f6ee] text-[#1a7f4b]', ring: 'outline-[#7cc9a0]' },
  partial: { icon: '◐', cls: 'bg-[#fff4e0] text-[#a15c00]', ring: 'outline-[#f5c26b]' },
  missing: { icon: '✕', cls: 'bg-[#fdecec] text-[#b42318]', ring: 'outline-[#f2a3a3]' },
}

/** One chip per posting requirement. Clicking selects it (or clears it when selected). */
export default function CriteriaChips({
  matches,
  selected,
  onSelect,
}: {
  matches: RequirementMatch[]
  selected: string | null
  onSelect: (term: string | null) => void
}) {
  return (
    <div role="group" aria-label="Posting requirements" className="flex flex-wrap gap-2">
      {matches.map((m) => {
        const look = LOOK[m.status]
        const on = selected === m.term
        return (
          <button
            key={m.term}
            type="button"
            aria-pressed={on}
            aria-label={`${m.term}: ${m.status}`}
            title={`${m.status[0].toUpperCase()}${m.status.slice(1)} · click to show its lines`}
            onClick={() => onSelect(on ? null : m.term)}
            className={cn(
              'rounded-full px-3 py-1 text-xs font-medium transition-shadow focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
              look.cls,
              on && cn('outline-2 outline-solid', look.ring),
            )}
          >
            {look.icon} {m.term}
          </button>
        )
      })}
    </div>
  )
}
