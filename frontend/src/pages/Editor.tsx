import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useBlocker, useNavigate, useParams } from 'react-router-dom'

import {
  api,
  ApiError,
  CompileFailure,
  type ApplicationDetail,
  type ApplicationStatus,
  type ScoreOut,
  type Suggestion,
} from '@/api'
import AskAIDrawer from '@/components/AskAIDrawer'
import CriteriaChips from '@/components/CriteriaChips'
import PdfPreview from '@/components/PdfPreview'
import ScoreMeter from '@/components/ScoreMeter'
import SourceEditor from '@/components/SourceEditor'
import { Button } from '@/components/ui/button'
import { linesForTerm, locateSuggestions } from '@/lib/termMatch'
import { cn } from '@/lib/utils'

/** Score recompute delay after the last keystroke. */
const SCORE_DELAY_MS = 400

const STATUSES: { value: ApplicationStatus; label: string }[] = [
  { value: 'not_applied', label: 'Not applied' },
  { value: 'applied', label: 'Applied' },
  { value: 'interview', label: 'Interview' },
  { value: 'offer', label: 'Offer' },
  { value: 'rejected', label: 'Rejected' },
]

function scoreKey(active: number[], tex: string): string {
  return `${[...active].sort((a, b) => a - b).join(',')}\u0000${tex}`
}

function pdfName(app: ApplicationDetail): string {
  const base = [app.posting.title, app.posting.company].filter(Boolean).join(' ') || `resume-${app.id}`
  return `${base.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'resume'}.pdf`
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * The resume editor: the .tex source with inline suggestions, criteria chips, a live score
 * and a live PDF preview. Nothing here calls the AI on its own: typing only triggers the
 * debounced deterministic /score and the debounced /latex/compile.
 */
const REDRAFT_NOTE =
  'Drafting again makes a new application for this posting from your current Record (this calls the AI). It keeps this one as it is.'

/** Keyed on the id, so opening another application (Draft again) starts a fresh editor. */
export default function EditorRoute() {
  const { id } = useParams()
  return <Editor key={id} />
}

function Editor() {
  const appId = Number(useParams().id)
  const navigate = useNavigate()
  const [redrafting, setRedrafting] = useState(false)
  const [redraftError, setRedraftError] = useState<ApiError | null>(null)
  const redraftLock = useRef(false)
  const [app, setApp] = useState<ApplicationDetail | null>(null)
  const [loadError, setLoadError] = useState('')
  const [tex, setTex] = useState('')
  const [savedTex, setSavedTex] = useState('')
  const [version, setVersion] = useState(1)
  const [score, setScore] = useState<ScoreOut | null>(null)
  const [status, setStatus] = useState<ApplicationStatus>('not_applied')
  const [rejected, setRejected] = useState<Suggestion[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [cardTitles, setCardTitles] = useState<Record<number, string>>({})
  const [pane, setPane] = useState<'source' | 'preview'>('source')
  const [busy, setBusy] = useState<'save' | 'export' | null>(null)
  const [notice, setNotice] = useState('')
  const [actionError, setActionError] = useState('')
  // Last (shown suggestions, text) sent to /score, and a counter so only the newest response
  // is applied.
  const requested = useRef<string | null>(null)
  const scoreSeq = useRef(0)

  useEffect(() => {
    let live = true
    api
      .getApplication(appId)
      .then((a) => {
        if (!live) return
        setApp(a)
        setTex(a.version.tex)
        setSavedTex(a.version.tex)
        setVersion(a.version.version)
        setScore({ score: a.score, matches: a.matches, potential: a.potential })
        setStatus(a.status)
        // The loaded potential counts every suggestion the server still finds in the text. If
        // the editor shows a different set, the key differs and one re-score corrects it.
        requested.current = scoreKey(a.suggestions.map((x) => x.bullet_index), a.version.tex)
      })
      .catch((e: Error) => live && setLoadError(e.message))
    api
      .listCards()
      .then((cards) => live && setCardTitles(Object.fromEntries(cards.map((c) => [c.id, c.title]))))
      .catch(() => {
        /* titles are a nicety; suggestions still show without them */
      })
    return () => {
      live = false
    }
  }, [appId])

  const suggestions = useMemo(
    () => (app?.suggestions ?? []).filter((s) => !rejected.includes(s)),
    [app, rejected],
  )
  const lines = useMemo(() => tex.split('\n'), [tex])
  // Bullet indexes of the suggestions drawn in the editor right now: not rejected, and their
  // line still reads exactly \resumeItem{old}. Only these count toward "→ N if all accepted".
  const shownKey = useMemo(() => {
    const at = locateSuggestions(lines, suggestions)
    return suggestions
      .filter((_, k) => at[k] >= 0)
      .map((s) => s.bullet_index)
      .sort((a, b) => a - b)
      .join(',')
  }, [lines, suggestions])

  // Debounced live score, re-run when the text or the shown suggestions change (a Reject, or
  // a suggestion's line edited away). Each request is numbered; a response to an older
  // request is dropped so a slow old answer never overwrites a newer one.
  useEffect(() => {
    const active = shownKey ? shownKey.split(',').map(Number) : []
    const key = scoreKey(active, tex)
    if (app === null || key === requested.current) return
    const timer = setTimeout(() => {
      requested.current = key
      const mine = ++scoreSeq.current
      api
        .scoreTex(appId, tex, active)
        .then((r) => mine === scoreSeq.current && setScore(r))
        .catch(() => {
          /* keep showing the last score */
        })
    }, SCORE_DELAY_MS)
    return () => clearTimeout(timer)
  }, [tex, shownKey, app, appId])

  const dirty = app !== null && tex !== savedTex

  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname,
  )

  const hits = useMemo(
    () => (selected ? linesForTerm(lines, selected, suggestions).length : null),
    [lines, selected, suggestions],
  )

  const onReject = useCallback((s: Suggestion) => setRejected((r) => [...r, s]), [])
  const onChange = useCallback((t: string) => {
    setTex(t)
    setNotice('')
  }, [])

  async function save(): Promise<number> {
    const text = tex
    const v = await api.saveVersion(appId, text)
    setSavedTex(text)
    setVersion(v.version)
    return v.version
  }

  async function onSave() {
    setBusy('save')
    setActionError('')
    try {
      const v = await save()
      setNotice(`Saved as version ${v}.`)
    } catch (e) {
      setActionError(`Could not save: ${(e as Error).message}`)
    } finally {
      setBusy(null)
    }
  }

  async function onExport() {
    if (!app) return
    setBusy('export')
    setActionError('')
    setNotice('')
    let saved: number | null = null
    try {
      if (dirty) saved = await save()
    } catch (e) {
      setActionError(`Could not save: ${(e as Error).message}`)
      setBusy(null)
      return
    }
    try {
      download(await api.compileLatex(tex), pdfName(app))
      setNotice(saved ? `Saved as version ${saved} and downloaded the PDF.` : 'Downloaded the PDF.')
    } catch (e) {
      const why = e instanceof CompileFailure ? `${e.message}. The preview shows the compiler output.` : (e as Error).message
      setActionError(`${saved ? `Saved as version ${saved}, but c` : 'C'}ould not build the PDF: ${why}`)
    } finally {
      setBusy(null)
    }
  }

  /** Runs only when pressed: a new application from the same posting and the current Record. */
  async function onRedraft() {
    if (!app || redraftLock.current) return
    redraftLock.current = true
    setRedrafting(true)
    setRedraftError(null)
    try {
      const created = await api.createApplication(app.posting_id)
      navigate(`/applications/${created.id}`)
    } catch (e) {
      setRedraftError(e instanceof ApiError ? e : new ApiError(0, (e as Error).message))
    } finally {
      redraftLock.current = false
      setRedrafting(false)
    }
  }

  async function onStatus(next: ApplicationStatus) {
    const prev = status
    setStatus(next)
    try {
      await api.updateApplication(appId, next)
    } catch (e) {
      setStatus(prev)
      setActionError(`Could not change the status: ${(e as Error).message}`)
    }
  }

  if (loadError)
    return (
      <div className="space-y-2">
        <p role="alert" className="text-destructive">{loadError}</p>
        <Link to="/resumes" className="text-sm text-primary underline">Back to Resumes</Link>
      </div>
    )
  if (!app || !score) return <p className="text-muted-foreground">Loading…</p>

  const redraftButton = (
    <Button
      size="sm"
      variant="outline"
      className="rounded-full"
      aria-describedby="redraft-note"
      disabled={redrafting}
      onClick={() => void onRedraft()}
    >
      {redrafting ? 'Drafting…' : '✦ Draft again from current Record'}
    </Button>
  )

  // The projection comes from the server, counting only the shown suggestions; with none
  // shown there is nothing to project.
  const potential = shownKey ? score.potential : score.score

  return (
    <div className="space-y-4">
      {blocker.state === 'blocked' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="leave-title"
            aria-describedby="leave-body"
            onKeyDown={(e) => e.key === 'Escape' && blocker.reset()}
            className="w-full max-w-sm rounded-xl bg-background p-5 shadow-xl"
          >
            <h2 id="leave-title" className="font-semibold">Unsaved changes</h2>
            <p id="leave-body" className="mt-1 text-sm text-muted-foreground">
              Your edits to this resume are not saved. Leave and lose them?
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" autoFocus onClick={() => blocker.reset()}>Stay</Button>
              <Button variant="destructive" onClick={() => blocker.proceed()}>Leave</Button>
            </div>
          </div>
        </div>
      )}

      <header className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <Link to="/resumes" className="text-sm text-muted-foreground hover:text-foreground">← Resumes</Link>
        <div className="mr-auto min-w-0">
          <h1 className="truncate text-lg font-semibold">{app.posting.title || 'Untitled role'}</h1>
          <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
            {app.posting.company && <span>{app.posting.company}</span>}
            <span aria-hidden>·</span>
            <span>.tex</span>
            <span aria-hidden>·</span>
            {dirty ? (
              <span className="font-medium text-amber-700">Unsaved changes</span>
            ) : (
              <span>Version {version} saved</span>
            )}
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <span>Status</span>
          <select
            className="h-8 rounded-lg border border-border bg-background px-2 text-sm"
            value={status}
            onChange={(e) => void onStatus(e.target.value as ApplicationStatus)}
          >
            {STATUSES.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </label>
        <ScoreMeter score={score.score} potential={potential} />
        <div className="flex gap-2">
          <Button variant="outline" className="rounded-full" disabled={busy !== null || !dirty} onClick={() => void onSave()}>
            {busy === 'save' ? 'Saving…' : 'Save'}
          </Button>
          <Button className="rounded-full" disabled={busy !== null} onClick={() => void onExport()}>
            {busy === 'export' ? 'Exporting…' : 'Export PDF'}
          </Button>
        </div>
      </header>

      {app.stale && (
        <div
          role="status"
          aria-labelledby="stale-title"
          className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
        >
          <span>
            <span id="stale-title" className="font-medium">Record changed since this was made</span>
            <span className="text-amber-800"> · This resume is a snapshot and is not updated automatically.</span>
          </span>
          {redraftButton}
        </div>
      )}
      {(app.stale || app.uncovered.length > 0) && (
        <p id="redraft-note" className="text-xs text-muted-foreground">{REDRAFT_NOTE}</p>
      )}
      {redraftError && (
        <div role="alert" className="space-y-1 rounded-lg bg-destructive/10 p-2.5 text-sm text-destructive">
          <p>Could not draft again: {redraftError.message}</p>
          {redraftError.status === 400 && (
            <p><Link to="/settings" className="underline">Open Settings</Link> to add your API key.</p>
          )}
          {redraftError.status === 422 && (
            <p><Link to="/record" className="underline">Open Record</Link> to add more experience.</p>
          )}
          {redraftError.status === 502 && <p>This resume is unchanged. Press it again to retry.</p>}
        </div>
      )}
      {actionError && <p role="alert" className="rounded-lg bg-destructive/10 p-2.5 text-sm text-destructive">{actionError}</p>}
      {notice && <p role="status" className="text-sm text-emerald-700">{notice}</p>}

      <CriteriaChips matches={score.matches} selected={selected} onSelect={setSelected} />
      {selected && hits === 0 && (
        <p className="text-sm text-muted-foreground">No line mentions "{selected}" yet.</p>
      )}

      {app.uncovered.length > 0 && (
        <section aria-labelledby="uncovered-heading" className="rounded-xl border border-border bg-muted/40 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="uncovered-heading" className="text-sm font-semibold">Not in your record yet</h2>
            {redraftButton}
          </div>
          <ul className="mt-2 space-y-2">
            {app.uncovered.map((r, i) => (
              <li key={r.term} className="flex flex-wrap items-center gap-3 text-sm">
                <span id={`uncovered-${i}`} className="text-muted-foreground">
                  "{r.term}" is in the posting but nothing in your Record mentions it.
                </span>
                <AskAIDrawer
                  jobId={null}
                  chooseJob
                  label="✦ Ask AI about it"
                  describedBy={`uncovered-${i}`}
                  initialMessage={`The job posting asks for "${r.term}". Have I done anything involving ${r.term} that I could add to my Record?`}
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      <div role="tablist" aria-label="Show" className="inline-flex rounded-full border border-border p-0.5 text-sm lg:hidden">
        {(['source', 'preview'] as const).map((p) => (
          <button
            key={p}
            role="tab"
            type="button"
            aria-selected={pane === p}
            onClick={() => setPane(p)}
            className={cn('rounded-full px-3 py-1', pane === p ? 'bg-foreground text-background' : 'text-muted-foreground')}
          >
            {p === 'source' ? 'Source' : 'Preview'}
          </button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section aria-label="Source" className={cn('h-[72vh] min-h-0 overflow-hidden rounded-xl border border-border', pane !== 'source' && 'hidden lg:block')}>
          <SourceEditor
            initialValue={app.version.tex}
            onChange={onChange}
            suggestions={suggestions}
            cardTitles={cardTitles}
            highlightTerm={selected}
            onReject={onReject}
          />
        </section>
        <section aria-label="Preview" className={cn('h-[72vh] min-h-0', pane !== 'preview' && 'hidden lg:block')}>
          <PdfPreview tex={tex} />
        </section>
      </div>
    </div>
  )
}
