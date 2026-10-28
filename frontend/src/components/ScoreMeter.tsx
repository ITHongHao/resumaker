/** Match score ring with "→ N if all accepted" when the suggestions would raise it. */
export default function ScoreMeter({ score, potential }: { score: number; potential: number }) {
  const r = 14
  const c = 2 * Math.PI * r
  const clamped = Math.max(0, Math.min(100, score))
  const color = clamped >= 80 ? '#1a9f5b' : clamped >= 50 ? '#f5a524' : '#d64545'
  return (
    <div className="flex items-center gap-2">
      <div
        role="meter"
        aria-label="Match score"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={score}
        className="flex items-center gap-2"
      >
        <svg width="34" height="34" viewBox="0 0 34 34" aria-hidden>
          <circle cx="17" cy="17" r={r} fill="none" stroke="#eceef0" strokeWidth="4" />
          <circle
            cx="17"
            cy="17"
            r={r}
            fill="none"
            stroke={color}
            strokeWidth="4"
            strokeLinecap="round"
            strokeDasharray={`${(clamped / 100) * c} ${c}`}
            transform="rotate(-90 17 17)"
          />
        </svg>
        <b className="text-[15px] tabular-nums">{score}</b>
      </div>
      {potential > score && <span className="text-sm text-muted-foreground">→ {potential} if all accepted</span>}
    </div>
  )
}
