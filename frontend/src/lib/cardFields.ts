import type { CardKind } from '@/api'

/**
 * The `extra` fields each card kind has: the ones the resume template prints. Mirrors
 * CARD_EXTRA_FIELDS in backend/app/models.py.
 */
export const EXTRA_FIELDS: Record<CardKind, { key: string; label: string; placeholder?: string }[]> = {
  education: [
    { key: 'location', label: 'Location', placeholder: 'Cambridge, MA' },
    { key: 'start_date', label: 'Start date', placeholder: 'Sep 2016' },
    { key: 'end_date', label: 'End date', placeholder: 'May 2020' },
  ],
  project: [
    { key: 'start_date', label: 'Start date', placeholder: 'Jan 2021' },
    { key: 'end_date', label: 'End date', placeholder: 'Jun 2021' },
  ],
  skill: [{ key: 'category', label: 'Category', placeholder: 'Languages' }],
  certificate: [{ key: 'date', label: 'Date', placeholder: 'Mar 2023' }],
  accomplishment: [],
  behavioral: [],
}

export const MAX_EXTRA_CHARS = 100

/** Only the known fields for `kind`, as trimmed non-empty strings (unknown keys dropped). */
export function knownExtra(kind: CardKind, extra: Record<string, unknown> | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const { key } of EXTRA_FIELDS[kind] ?? []) {
    const v = extra?.[key]
    if (typeof v === 'string' && v.trim()) out[key] = v.trim().slice(0, MAX_EXTRA_CHARS)
  }
  return out
}

/** Kinds a card under a job may have, and kinds a card outside any job may have. */
export const JOB_KINDS: CardKind[] = ['project', 'accomplishment']
export const JOBLESS_KINDS: CardKind[] = ['project', 'education', 'skill', 'certificate', 'behavioral']

/** Same rule and wording as the backend (POST /api/cards answers 422). */
export const JOBLESS_ACCOMPLISHMENT =
  'An accomplishment must belong to a job. Choose the job it happened at, or save it as another kind, such as a project.'
