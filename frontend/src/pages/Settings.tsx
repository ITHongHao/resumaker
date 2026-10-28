import { useEffect, useState } from 'react'

import { api, type Provider } from '@/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export default function Settings() {
  const [provider, setProvider] = useState<Provider>('anthropic')
  const [model, setModel] = useState('')
  const [hasKey, setHasKey] = useState<boolean | null>(null)
  const [apiKey, setApiKey] = useState('') // write-only: never populated from the server
  const [msg, setMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api
      .getSettings()
      .then((s) => {
        setProvider(s.provider)
        setModel(s.model)
        setHasKey(s.has_key)
      })
      .catch((e: Error) => setError(e.message))
  }, [])

  async function save() {
    setMsg(null)
    setError(null)
    try {
      const s = await api.putSettings({ provider, model, ...(apiKey ? { api_key: apiKey } : {}) })
      setProvider(s.provider)
      setModel(s.model)
      setHasKey(s.has_key)
      setApiKey('')
      setMsg('Settings saved.')
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <div className="max-w-md space-y-6">
      <h1 className="text-xl font-semibold">Settings</h1>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <div className="space-y-1">
          <Label htmlFor="provider">AI provider</Label>
          <select
            id="provider"
            className="h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm"
            value={provider}
            onChange={(e) => setProvider(e.target.value as Provider)}
          >
            <option value="anthropic">Anthropic</option>
            <option value="openai">OpenAI</option>
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="model">Model</Label>
          <Input id="model" value={model} onChange={(e) => setModel(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="api-key">API key</Label>
          <Input
            id="api-key"
            type="password"
            autoComplete="off"
            placeholder={hasKey ? 'Enter a new key to replace the saved one' : 'Paste your API key'}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
          {hasKey !== null && (
            <p className="text-xs text-muted-foreground">{hasKey ? 'Key saved.' : 'No key saved.'}</p>
          )}
        </div>
        <Button type="submit">Save settings</Button>
      </form>
      {msg && <p role="status" className="text-sm text-muted-foreground">{msg}</p>}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
