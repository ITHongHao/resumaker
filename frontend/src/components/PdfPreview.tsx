import { useEffect, useRef, useState } from 'react'

import { api, CompileFailure } from '@/api'

type Failure = { message: string; log: string }

/**
 * Live PDF of the source, compiled (debounced) through POST /api/latex/compile. A failed
 * compile never blanks the preview: the last good PDF stays and the compiler message (and a
 * collapsible log) shows beside it. Responses to older text are discarded.
 */
export default function PdfPreview({ tex, delay = 800 }: { tex: string; delay?: number }) {
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<Failure | null>(null)
  const [busy, setBusy] = useState(false)
  const seq = useRef(0)
  const current = useRef<string | null>(null)

  useEffect(() => {
    const mine = ++seq.current
    const timer = setTimeout(async () => {
      setBusy(true)
      try {
        const blob = await api.compileLatex(tex)
        if (mine !== seq.current) return
        const next = URL.createObjectURL(blob)
        if (current.current) URL.revokeObjectURL(current.current)
        current.current = next
        setUrl(next)
        setError(null)
      } catch (e) {
        if (mine !== seq.current) return
        setError(e instanceof CompileFailure ? { message: e.message, log: e.log } : { message: (e as Error).message, log: '' })
      } finally {
        if (mine === seq.current) setBusy(false)
      }
    }, delay)
    return () => clearTimeout(timer)
  }, [tex, delay])

  useEffect(
    () => () => {
      if (current.current) URL.revokeObjectURL(current.current)
    },
    [],
  )

  // A short one-line log (for example "tectonic is not installed ...") is shown as is;
  // a real compiler log is long, so it is collapsed.
  const shortLog = error && error.log && !error.log.includes('\n') && error.log.length <= 200

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex items-center justify-between text-xs text-muted-foreground" aria-live="polite">
        <span>{busy ? 'Building preview…' : error ? (url ? 'Showing the last PDF that built' : 'No preview yet') : url ? 'Preview up to date' : ''}</span>
      </div>
      {error && (
        <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          <p className="font-medium">{error.message}</p>
          {shortLog ? (
            <p className="mt-1 font-mono text-xs break-words">{error.log}</p>
          ) : (
            error.log && (
              <details className="mt-1">
                <summary className="cursor-pointer text-xs">Compiler log</summary>
                <pre className="mt-1 max-h-48 overflow-auto rounded bg-background/70 p-2 text-[11px] whitespace-pre-wrap text-foreground">
                  {error.log}
                </pre>
              </details>
            )
          )}
        </div>
      )}
      {url ? (
        <iframe title="PDF preview" src={url} className="min-h-[60vh] w-full flex-1 rounded-lg border border-border bg-white" />
      ) : (
        <div className="flex min-h-[60vh] flex-1 items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted-foreground">
          {error ? 'The PDF preview appears once the source compiles.' : 'Building preview…'}
        </div>
      )}
    </div>
  )
}
