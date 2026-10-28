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
  /** More detail than ever appears on the resume. */
  details?: string
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

export type Provider = 'anthropic' | 'openai' | 'custom'
export interface SettingsOut {
  provider: Provider
  model: string
  base_url: string
  has_key: boolean
}
export interface SettingsIn {
  provider: Provider
  model: string
  base_url?: string
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

export type ApplicationStatus = 'not_applied' | 'applied' | 'interview' | 'offer' | 'rejected'

export interface Requirement {
  term: string
  kind: 'skill' | 'tool' | 'responsibility' | 'qualification'
  weight: number
}
export interface Posting {
  id: number
  source_kind: 'url' | 'text' | 'html' | 'image'
  title: string
  company: string
  requirements: Requirement[]
}
export interface ApplicationSummary {
  id: number
  posting_id: number
  status: ApplicationStatus
  created_at: string
  updated_at: string
  title: string
  company: string
  score: number
  version: number
  stale?: boolean
  format?: string
}

export type MatchStatus = 'matched' | 'partial' | 'missing'
export interface RequirementMatch {
  term: string
  status: MatchStatus
}
/** A rewrite of one \resumeItem{...} line. `old_tex`/`new_tex` are the escaped forms. */
export interface Suggestion {
  bullet_index: number
  old: string
  new: string
  old_tex: string
  new_tex: string
  terms: string[]
  source_card_id: number
  score_delta: number
}
export interface ResumeVersion {
  id: number
  version: number
  tex: string
  bullets: { section: string; job_id: number | null; text: string; source_card_id: number }[]
  record_hash: string
  created_at: string
}
export interface ApplicationDetail {
  id: number
  posting_id: number
  status: ApplicationStatus
  created_at: string
  posting: { id: number; title: string; company: string }
  version: ResumeVersion
  score: number
  matches: RequirementMatch[]
  potential: number
  suggestions: Suggestion[]
  uncovered: Requirement[]
  stale: boolean
}
export interface ScoreOut {
  score: number
  matches: RequirementMatch[]
  potential: number
}

/** POST /api/latex/compile answered 422: the compiler's message and log. */
export class CompileFailure extends Error {
  log: string
  constructor(message: string, log: string) {
    super(message)
    this.log = log
  }
}
export interface ApplicationCreated {
  id: number
}

export class ApiError extends Error {
  status: number
  fallback?: string
  constructor(status: number, message: string, fallback?: string) {
    super(message)
    this.status = status
    this.fallback = fallback
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

async function compileLatex(tex: string): Promise<Blob> {
  let res: Response
  try {
    res = await fetch('/api/latex/compile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tex }),
    })
  } catch {
    throw new ApiError(0, 'Could not reach the Resumaker server. Is the backend running?')
  }
  if (res.ok) return res.blob()
  let parsed: unknown = null
  try {
    parsed = await res.json()
  } catch {
    /* non-JSON error body */
  }
  const detail = (parsed as { detail?: unknown } | null)?.detail
  if (detail && typeof detail === 'object' && !Array.isArray(detail) && 'message' in detail) {
    const d = detail as { message?: unknown; log?: unknown }
    throw new CompileFailure(String(d.message ?? 'LaTeX compilation failed'), typeof d.log === 'string' ? d.log : '')
  }
  throw new ApiError(res.status, describe(parsed, `Compile failed (${res.status})`))
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    const form = body instanceof FormData
    res = await fetch(url, {
      method,
      headers: body === undefined || form ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : form ? body : JSON.stringify(body),
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
    const fallback = (parsed as { fallback?: unknown } | null)?.fallback
    throw new ApiError(
      res.status,
      describe(parsed, `Request failed (${res.status})`) || `Request failed (${res.status})`,
      typeof fallback === 'string' ? fallback : undefined,
    )
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

  createPosting: (form: FormData) => request<Posting>('POST', '/api/postings', form),
  listApplications: (q: { q?: string; status?: ApplicationStatus | '' } = {}) => {
    const p = new URLSearchParams()
    if (q.q?.trim()) p.set('q', q.q.trim())
    if (q.status) p.set('status', q.status)
    const s = p.toString()
    return request<ApplicationSummary[]>('GET', `/api/applications${s ? `?${s}` : ''}`)
  },
  createApplication: (posting_id: number) =>
    request<ApplicationCreated>('POST', '/api/applications', { posting_id }),
  getApplication: (id: number) => request<ApplicationDetail>('GET', `/api/applications/${id}`),
  updateApplication: (id: number, status: ApplicationStatus) =>
    request<{ id: number; status: ApplicationStatus }>('PATCH', `/api/applications/${id}`, { status }),
  /** Deterministic live score of unsaved tex. Never an AI call. `active` (bullet indexes of
   *  the suggestions the editor shows) limits which suggestions count toward `potential`. */
  scoreTex: (id: number, tex: string, active?: number[]) =>
    request<ScoreOut>('POST', `/api/applications/${id}/score`, active === undefined ? { tex } : { tex, active }),
  saveVersion: (id: number, tex: string) =>
    request<ResumeVersion>('POST', `/api/applications/${id}/versions`, { tex }),
  compileLatex,

  propose: (job_id: number | null, message: string, history: ChatTurn[]) =>
    request<ProposalReply>('POST', '/api/ai/propose', { job_id, message, history }),
}
