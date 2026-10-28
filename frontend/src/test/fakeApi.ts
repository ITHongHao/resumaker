import { vi } from 'vitest'

import type { Card, Job } from '@/api'

type Reply = { status?: number; body?: unknown } | undefined
// A handler may answer later (a Promise) to model slow responses. A Blob body is served as a
// binary response (res.blob()).
type Handler = (req: { method: string; path: string; body: any }) => Reply | Promise<Reply>

export interface FakeServer {
  jobs: Job[]
  cards: Card[]
  calls: { method: string; path: string; body: any; search?: string }[]
  settings: { provider: string; model: string; has_key: boolean }
  override?: Handler
}

export function installFakeApi(init: Partial<Pick<FakeServer, 'jobs' | 'cards'>> = {}): FakeServer {
  const s: FakeServer = {
    jobs: init.jobs ?? [],
    cards: init.cards ?? [],
    calls: [],
    settings: { provider: 'anthropic', model: 'claude-sonnet-4-5', has_key: false },
  }
  let nextId = 100
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, opts: RequestInit = {}) => {
      const method = (opts.method ?? 'GET').toUpperCase()
      const body =
        opts.body instanceof FormData
          ? Object.fromEntries(opts.body.entries())
          : opts.body
            ? JSON.parse(String(opts.body))
            : undefined
      const u = new URL(url, 'http://x')
      const path = u.pathname
      s.calls.push({ method, path, body, search: u.search })
      const json = (b: unknown, status = 200) =>
        (b instanceof Blob
          ? { ok: status < 400, status, blob: async () => b, json: async () => JSON.parse(await b.text()) }
          : { ok: status < 400, status, json: async () => b, blob: async () => new Blob([JSON.stringify(b)]) }) as Response
      const o = await s.override?.({ method, path, body })
      if (o) return json(o.body, o.status ?? 200)
      if (path === '/api/jobs' && method === 'GET') return json(s.jobs)
      if (path === '/api/jobs' && method === 'POST') {
        const j = { id: nextId++, location: '', employment_type: '', start_date: '', end_date: '', manager_contact: '', reason_for_leaving: '', ...body }
        s.jobs.push(j)
        return json(j, 201)
      }
      const jm = path.match(/^\/api\/jobs\/(\d+)$/)
      if (jm && method === 'GET') return json(s.jobs.find((j) => j.id === +jm[1]))
      if (path === '/api/cards' && method === 'GET') {
        let cs = s.cards
        const jid = u.searchParams.get('job_id')
        if (jid) cs = cs.filter((c) => c.job_id === +jid)
        return json(cs)
      }
      if (path === '/api/cards' && method === 'POST') {
        const c = { id: nextId++, details: '', extra: {}, tags: [], ...body }
        s.cards.push(c)
        return json(c, 201)
      }
      const cm = path.match(/^\/api\/cards\/(\d+)$/)
      if (cm && method === 'PATCH') {
        const c = s.cards.find((c) => c.id === +cm[1])!
        Object.assign(c, body)
        return json(c)
      }
      if (cm && method === 'DELETE') {
        s.cards = s.cards.filter((c) => c.id !== +cm[1])
        return { ok: true, status: 204, json: async () => undefined } as Response
      }
      if (path === '/api/settings' && method === 'GET') return json(s.settings)
      if (path === '/api/settings' && method === 'PUT') {
        const { api_key, ...rest } = body
        s.settings = { ...s.settings, ...rest, has_key: s.settings.has_key || !!api_key }
        return json(s.settings)
      }
      if (path === '/api/profile') return json({ name: '', email: '', phone: '', links: [], work_authorization: '' })
      return json({ detail: `unhandled ${method} ${path}` }, 404)
    }),
  )
  return s
}
