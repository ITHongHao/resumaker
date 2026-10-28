export type CardKind =
  | 'project'
  | 'accomplishment'
  | 'education'
  | 'skill'
  | 'certificate'
  | 'behavioral'

export interface Job {
  id: number
  company: string
  title: string
  location: string
  employment_type: string
  start_date: string
  end_date: string
  manager_contact: string
  reason_for_leaving: string
}
export type JobInput = Omit<Job, 'id'>

export interface CardDraft {
  kind: CardKind
  title: string
  description: string
  tags: string[]
  extra?: Record<string, unknown>
}
export interface Card extends CardDraft {
  id: number
  job_id: number | null
  details: string
  extra: Record<string, unknown>
}
export interface CardInput extends CardDraft {
  job_id: number | null
}

export interface Profile {
  name: string
  email: string
  phone: string
  links: string[]
  work_authorization: string
}

export type Provider = 'anthropic' | 'openai'
export interface SettingsOut {
  provider: Provider
  model: string
  has_key: boolean
}
export interface SettingsIn {
  provider: Provider
  model: string
  api_key?: string
}

export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}
export interface ProposalReply {
  reply: string
  proposals: CardDraft[]
  followups: string[]
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

function describe(body: unknown, fallback: string): string {
  const detail = (body as { detail?: unknown } | null)?.detail ?? body
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    return detail
      .map((d: { loc?: unknown[]; msg?: string }) => {
        const field = Array.isArray(d.loc) ? d.loc.filter((p) => p !== 'body').join('.') : ''
        return field ? `${field}: ${d.msg}` : (d.msg ?? '')
      })
      .filter(Boolean)
      .join('; ')
  }
  return fallback
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiError(0, 'Could not reach the Resumaker server. Is the backend running?')
  }
  if (!res.ok) {
    let parsed: unknown = null
    try {
      parsed = await res.json()
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, describe(parsed, `Request failed (${res.status})`) || `Request failed (${res.status})`)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export const api = {
  listJobs: () => request<Job[]>('GET', '/api/jobs'),
  getJob: (id: number) => request<Job>('GET', `/api/jobs/${id}`),
  createJob: (j: Partial<JobInput> & Pick<JobInput, 'company' | 'title'>) =>
    request<Job>('POST', '/api/jobs', j),
  updateJob: (id: number, j: Partial<JobInput>) => request<Job>('PATCH', `/api/jobs/${id}`, j),
  deleteJob: (id: number) => request<void>('DELETE', `/api/jobs/${id}`),

  listCards: (q: { job_id?: number; kind?: CardKind } = {}) => {
    const p = new URLSearchParams()
    if (q.job_id !== undefined) p.set('job_id', String(q.job_id))
    if (q.kind) p.set('kind', q.kind)
    const s = p.toString()
    return request<Card[]>('GET', `/api/cards${s ? `?${s}` : ''}`)
  },
  createCard: (c: CardInput) => request<Card>('POST', '/api/cards', c),
  updateCard: (id: number, c: Partial<CardInput>) => request<Card>('PATCH', `/api/cards/${id}`, c),
  deleteCard: (id: number) => request<void>('DELETE', `/api/cards/${id}`),

  getProfile: () => request<Profile>('GET', '/api/profile'),
  putProfile: (p: Profile) => request<Profile>('PUT', '/api/profile', p),

  getSettings: () => request<SettingsOut>('GET', '/api/settings'),
  putSettings: (s: SettingsIn) => request<SettingsOut>('PUT', '/api/settings', s),

  exportAll: () => request<unknown>('GET', '/api/export'),
  importAll: (doc: unknown) => request<{ jobs: number; cards: number }>('POST', '/api/import', doc),

  propose: (job_id: number | null, message: string, history: ChatTurn[]) =>
    request<ProposalReply>('POST', '/api/ai/propose', { job_id, message, history }),
}
