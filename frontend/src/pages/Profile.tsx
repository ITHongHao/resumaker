import { useEffect, useRef, useState } from 'react'

import { api, type Profile as ProfileT } from '@/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export default function Profile() {
  const [p, setP] = useState<ProfileT | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const file = useRef<HTMLInputElement>(null)

  useEffect(() => {
    api.getProfile().then(setP).catch((e: Error) => setError(e.message))
  }, [])

  async function guard(fn: () => Promise<string>) {
    setMsg(null)
    setError(null)
    try {
      setMsg(await fn())
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function doExport() {
    await guard(async () => {
      const doc = await api.exportAll()
      const url = URL.createObjectURL(new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' }))
      const a = document.createElement('a')
      a.href = url
      a.download = 'resumaker-export.json'
      a.click()
      URL.revokeObjectURL(url)
      return 'Exported.'
    })
  }

  async function doImport(f: File) {
    await guard(async () => {
      let doc: unknown
      try {
        doc = JSON.parse(await f.text())
      } catch {
        throw new Error('That file is not valid JSON.')
      }
      const r = await api.importAll(doc)
      setP(await api.getProfile())
      return `Imported ${r.jobs} jobs and ${r.cards} cards.`
    })
  }

  if (!p) return error ? <p role="alert" className="text-destructive">{error}</p> : <p className="text-muted-foreground">Loading...</p>

  const field = (k: 'name' | 'email' | 'phone' | 'work_authorization', label: string) => (
    <div className="space-y-1">
      <Label htmlFor={`p-${k}`}>{label}</Label>
      <Input id={`p-${k}`} value={p[k]} onChange={(e) => setP({ ...p, [k]: e.target.value })} />
    </div>
  )

  return (
    <div className="max-w-md space-y-8">
      <h1 className="text-xl font-semibold">Profile</h1>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          void guard(async () => {
            setP(await api.putProfile(p))
            return 'Profile saved.'
          })
        }}
      >
        {field('name', 'Name')}
        {field('email', 'Email')}
        {field('phone', 'Phone')}
        <div className="space-y-1">
          <Label htmlFor="p-links">Links (one per line)</Label>
          <textarea
            id="p-links"
            className="min-h-20 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm"
            value={p.links.join('\n')}
            onChange={(e) => setP({ ...p, links: e.target.value.split('\n').map((l) => l.trim()).filter(Boolean) })}
          />
        </div>
        {field('work_authorization', 'Work authorization')}
        <Button type="submit">Save profile</Button>
      </form>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground">Backup</h2>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => void doExport()}>
            Export JSON
          </Button>
          <Button variant="outline" onClick={() => file.current?.click()}>
            Import JSON
          </Button>
          <input
            ref={file}
            type="file"
            accept="application/json,.json"
            className="hidden"
            aria-label="Import JSON file"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void doImport(f)
              e.target.value = ''
            }}
          />
        </div>
        <p className="text-xs text-muted-foreground">Importing replaces all jobs, cards and your profile.</p>
      </section>
      {msg && <p role="status" className="text-sm text-muted-foreground">{msg}</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </div>
  )
}
