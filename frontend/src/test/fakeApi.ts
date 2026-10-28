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
  settings: { provider: string; model: string; base_url: string; has_key: boolean }
  override?: Handler
  /** Interview state: built-in questions (ref b:*), custom ones, hidden refs and answers. */
  questions: { ref: string; text: string; category: string; builtin: boolean }[]
  hiddenRefs: string[]
  answers: any[]
  draft: { situation: string; task: string; action: string; result: string; source_card_ids: number[] }
}

export function installFakeApi(init: Partial<Pick<FakeServer, 'jobs' | 'cards'>> = {}): FakeServer {
  const s: FakeServer = {
    jobs: init.jobs ?? [],
    cards: init.cards ?? [],
    calls: [],
    questions: [
      { ref: 'b:lead-project', text: 'Tell me about a time you led a project.', category: 'Leadership', builtin: true },
      { ref: 'b:team-conflict', text: 'Tell me about a conflict with a teammate.', category: 'Teamwork and conflict', builtin: true },
    ],
    hiddenRefs: [],
    answers: [],
    draft: { situation: 'S draft', task: 'T draft', action: 'A draft', result: 'R draft', source_card_ids: [] },
    settings: { provider: 'anthropic', model: 'claude-sonnet-4-5', base_url: '', has_key: false },
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
      if (path.startsWith('/api/interview/')) {
        const r = interviewRoute(s, method, path, u, body, json, () => nextId++)
        if (r) return r
      }
      if (path === '/api/profile') return json({ name: '', email: '', phone: '', links: [], work_authorization: '' })
      return json({ detail: `unhandled ${method} ${path}` }, 404)
    }),
  )
  return s
}

function interviewRoute(
  s: FakeServer,
  method: string,
  path: string,
  u: URL,
  body: any,
  json: (b: unknown, status?: number) => Response,
  newId: () => number,
): Response | undefined {
  const empty = { ok: true, status: 204, json: async () => undefined } as Response
  const sources = (a: any) => ({
    ...a,
    source_cards: a.source_card_ids.map((id: number) => {
      const c = (s.cards as Card[]).find((c) => c.id === id)
      return c ? { id, title: c.title } : { id, removed: true }
    }),
  })
  const count = (ref: string) => s.answers.filter((a) => a.question_ref === ref).length
  const p = path.replace('/api/interview', '')
  if (p === '/questions' && method === 'GET') {
    const all = u.searchParams.get('include_hidden') === 'true'
    return json(
      s.questions
        .filter((q) => all || !s.hiddenRefs.includes(q.ref))
        .map((q) => ({ ...q, hidden: s.hiddenRefs.includes(q.ref), answer_count: count(q.ref) })),
    )
  }
  if (p === '/questions' && method === 'POST') {
    const q = { ref: `c:${newId()}`, text: body.text, category: body.category ?? 'Mine', builtin: false }
    s.questions.push(q)
    return json({ ...q, hidden: false, answer_count: 0 }, 201)
  }
  const hm = p.match(/^\/questions\/(.+)\/hidden$/)
  if (hm && method === 'PUT') {
    const ref = decodeURIComponent(hm[1])
    s.hiddenRefs = s.hiddenRefs.filter((r) => r !== ref)
    if (body.hidden) s.hiddenRefs.push(ref)
    return json({ ref, hidden: body.hidden })
  }
  const qm = p.match(/^\/questions\/(\d+)$/)
  if (qm && method === 'PATCH') {
    const q = s.questions.find((q) => q.ref === `c:${qm[1]}`)!
    Object.assign(q, body)
    return json({ ...q, hidden: false, answer_count: count(q.ref) })
  }
  if (qm && method === 'DELETE') {
    s.questions = s.questions.filter((q) => q.ref !== `c:${qm[1]}`)
    s.answers = s.answers.filter((a) => a.question_ref !== `c:${qm[1]}`)
    return empty
  }
  if (p === '/answers' && method === 'GET') {
    const ref = u.searchParams.get('question_ref')
    return json(s.answers.filter((a) => !ref || a.question_ref === ref).map(sources))
  }
  if (p === '/answers' && method === 'POST') {
    const a = { id: newId(), source_card_ids: [], job_id: null, ...body }
    s.answers.push(a)
    return json(sources(a), 201)
  }
  const am = p.match(/^\/answers\/(\d+)$/)
  if (am && method === 'PATCH') {
    const a = s.answers.find((a) => a.id === +am[1])!
    Object.assign(a, body)
    return json(sources(a))
  }
  if (am && method === 'DELETE') {
    s.answers = s.answers.filter((a) => a.id !== +am[1])
    return empty
  }
  if (p === '/draft' && method === 'POST') return json(s.draft)
  return undefined
}
