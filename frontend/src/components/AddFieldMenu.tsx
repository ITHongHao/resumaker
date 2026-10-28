import { useState } from 'react'

import { Button } from '@/components/ui/button'
import type { FieldDef } from '@/lib/recordFields'

/** A button that opens a short list of the fields not yet on the form. */
export default function AddFieldMenu({ available, onPick }: { available: FieldDef[]; onPick: (key: string) => void }) {
  const [open, setOpen] = useState(false)
  if (!available.length) return null
  return (
    <div className="relative inline-block">
      <Button type="button" variant="outline" size="sm" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        Add field
      </Button>
      {open && (
        <div
          role="menu"
          className="absolute left-0 z-10 mt-1 min-w-48 rounded-lg border border-border bg-card p-1 shadow-md"
          onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
        >
          {available.map((f) => (
            <button
              key={f.key}
              type="button"
              role="menuitem"
              className="block w-full rounded-md px-3 py-1.5 text-left text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
              onClick={() => {
                setOpen(false)
                onPick(f.key)
              }}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
