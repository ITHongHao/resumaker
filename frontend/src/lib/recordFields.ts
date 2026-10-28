import type { CardKind } from '@/api'
import registry from '@shared/record-fields.json'

export type FieldType = 'text' | 'select' | 'yesno'
export interface FieldDef {
  key: string
  label: string
  type: FieldType
  options?: string[]
  placeholder?: string
  default: boolean
  printed: boolean
  column?: boolean
}
export type Section = 'job' | 'education' | 'project' | 'accomplishment' | 'skill' | 'certificate'

/** The fields each section has, from shared/record-fields.json (also read by the backend). */
export const FIELDS = registry as unknown as Record<Section, FieldDef[]>

/** The fields a card of `kind` can have; a behavioral answer has none. */
export function fieldsFor(kind: CardKind | Section): FieldDef[] {
  return FIELDS[kind as Section] ?? []
}

/** What the title box is called on each kind's form. */
export const TITLE_LABELS: Partial<Record<CardKind, string>> = {
  education: 'School',
  project: 'Name',
  skill: 'Name',
  certificate: 'Name',
}

/** Default fields, plus any field that holds a value. */
export function visibleKeys(defs: FieldDef[], extra: Record<string, unknown> | undefined): string[] {
  return defs.filter((f) => f.default || hasValue(extra?.[f.key])).map((f) => f.key)
}

export function hasValue(v: unknown): boolean {
  return typeof v === 'string' && v.trim() !== ''
}

export const MAX_EXTRA_CHARS = 100

/** Every key some section's field list names; other `extra` keys come from an import. */
export const KNOWN_KEYS = new Set(Object.values(FIELDS).flatMap((fs) => fs.map((f) => f.key)))

/** Only the known fields for `kind`, as trimmed non-empty strings (unknown keys dropped). */
export function knownExtra(kind: CardKind, extra: Record<string, unknown> | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const { key } of fieldsFor(kind)) {
    const v = extra?.[key]
    if (typeof v === 'string' && v.trim()) out[key] = v.trim().slice(0, MAX_EXTRA_CHARS)
  }
  return out
}

/** Kinds a card under a job may have, and kinds a card outside any job may have. */
export const JOB_KINDS: CardKind[] = ['project', 'accomplishment']
export const JOBLESS_KINDS: CardKind[] = ['project', 'education', 'skill', 'certificate']

/** Same rule and wording as the backend (POST /api/cards answers 422). */
export const JOBLESS_ACCOMPLISHMENT =
  'An accomplishment must belong to a job. Choose the job it happened at, or save it as another kind, such as a project.'
