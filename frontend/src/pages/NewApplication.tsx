import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { api, ApiError, type Posting } from '@/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

type Mode = 'text' | 'url' | 'html' | 'image'
const MODES: { id: Mode; label: string }[] = [
  { id: 'text', label: 'Paste text' },
  { id: 'url', label: 'URL' },
  { id: 'html', label: 'HTML' },
  { id: 'image', label: 'Screenshot' },
]

export default function NewApplication() {
  const navigate = useNavigate()
  const [mode, setMode] = useState<Mode>('text')
  const [text, setText] = useState('')
  const [url, setUrl] = useState('')
  const [html, setHtml] = useState('')
  const [image, setImage] = useState<File | null>(null)
  const [posting, setPosting] = useState<Posting | null>(null)
  const [readError, setReadError] = useState('')
  const [readStatus, setReadStatus] = useState(0)
  const [reading, setReading] = useState(false)
  const [caterError, setCaterError] = useState<ApiError | null>(null)
  const [catering, setCatering] = useState(false)

  const value = { text, url, html, image }[mode]
  const canRead = !reading && (mode === 'image' ? image !== null : String(value ?? '').trim() !== '')

  async function read() {
    const form = new FormData()
    if (mode === 'image') form.append('image', image as File)
    else form.append(mode, String(value).trim())
    setReading(true)
    setReadError('')
    setReadStatus(0)
    setCaterError(null)
    setPosting(null)
    try {
      setPosting(await api.createPosting(form))
    } catch (e) {
      const err = e as ApiError
      setReadError(err.message)
      setReadStatus(err.status)
      if (err.fallback === 'paste_text') setMode('text') // inputs for every mode are kept
    } finally {
      setReading(false)
    }
  }

  async function cater() {
    if (!posting) return
    setCatering(true)
    setCaterError(null)
    try {
      const app = await api.createApplication(posting.id)
      navigate(`/applications/${app.id}`)
    } catch (e) {
      setCaterError(e as ApiError)
    } finally {
      setCatering(false)
    }
  }

  const ready = posting !== null && posting.requirements.length > 0

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold">New application</h1>

      <div className="space-y-3 rounded-xl border border-border p-4">
        <div role="tablist" className="flex flex-wrap gap-1">
          {MODES.map((m) => (
            <button
              key={m.id}
              role="tab"
              type="button"
              aria-selected={mode === m.id}
              onClick={() => setMode(m.id)}
              className={cn('rounded-full px-3 py-1 text-sm', mode === m.id ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-muted')}
            >
              {m.label}
            </button>
          ))}
        </div>

        {mode === 'text' && (
          <Textarea aria-label="Posting text" rows={8} placeholder="Paste the job posting text…" value={text} onChange={(e) => setText(e.target.value)} />
        )}
        {mode === 'url' && (
          <Input aria-label="Posting URL" placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} />
        )}
        {mode === 'html' && (
          <Textarea aria-label="Posting HTML" rows={8} placeholder="Paste the page HTML…" value={html} onChange={(e) => setHtml(e.target.value)} />
        )}
        {mode === 'image' && (
          <div>
            <Input
              aria-label="Posting screenshot"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => setImage(e.target.files?.[0] ?? null)}
            />
            <p className="mt-1 text-xs text-muted-foreground">PNG, JPEG or WebP, 8 MB max.</p>
          </div>
        )}

        <Button type="button" onClick={read} disabled={!canRead}>
          {reading ? 'Reading…' : posting ? 'Read again' : 'Read posting'}
        </Button>

        {readError && (
          <p role="alert" className="text-sm text-destructive">
            {readError} Your input is kept.
            {readStatus === 400 && (
              <> <Link to="/settings" className="underline">Open Settings</Link></>
            )}
          </p>
        )}
      </div>

      {posting && (
        <div className="rounded-xl border border-border bg-muted/40 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <b>{[posting.title, posting.company].filter(Boolean).join(' · ') || 'Untitled posting'}</b>
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">Posting read</span>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            Found {posting.requirements.length} requirements:
          </p>
          <ul className="mt-1 flex flex-wrap gap-1.5">
            {posting.requirements.map((r, i) => (
              <li key={`${r.term}-${i}`} className="rounded-full bg-background px-2 py-0.5 text-xs ring-1 ring-border">{r.term}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Format</span>
          <span className="rounded-full bg-muted px-2.5 py-1">LaTeX</span>
          <span className="text-muted-foreground">Template</span>
          <span className="rounded-full bg-muted px-2.5 py-1">Jake's</span>
        </div>
        <Button className="ml-auto" type="button" onClick={cater} disabled={!ready || catering}>
          {catering ? 'Catering…' : '✦ Auto cater'}
        </Button>
      </div>

      {caterError && (
        <div role="alert" className="space-y-1 text-sm text-destructive">
          <p>{caterError.message}</p>
          {caterError.status === 400 && (
            <p><Link to="/settings" className="underline">Open Settings</Link> to add your API key.</p>
          )}
          {caterError.status === 422 && (
            <p><Link to="/record" className="underline">Open Record</Link> to add more experience.</p>
          )}
          {caterError.status === 502 && <p>Your posting is kept. Press Auto cater to try again.</p>}
        </div>
      )}
    </div>
  )
}
