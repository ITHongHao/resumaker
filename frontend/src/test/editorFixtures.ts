import { EditorView } from '@codemirror/view'
import { act } from '@testing-library/react'

import type { ApplicationDetail, Suggestion } from '@/api'

export const TEX = [
  '\\documentclass{article}',
  '\\begin{document}',
  '\\section{Experience}',
  '  \\resumeItemListStart',
  '    \\resumeItem{Built Python Airflow pipelines that cut report time by 40\\%}',
  '    \\resumeItem{Built a TypeScript web app}',
  '  \\resumeItemListEnd',
  '\\end{document}',
].join('\n')

export const SUGGESTION: Suggestion = {
  bullet_index: 1,
  old: 'Built a TypeScript web app',
  new: 'Built a TypeScript web app backed by PostgreSQL',
  old_tex: 'Built a TypeScript web app',
  new_tex: 'Built a TypeScript web app backed by PostgreSQL',
  terms: ['PostgreSQL'],
  source_card_id: 5,
  score_delta: 14,
}

/** A second suggestion, on bullet 0 (the Airflow line). */
export const SUGGESTION_2: Suggestion = {
  bullet_index: 0,
  old: 'Built Python Airflow pipelines that cut report time by 40%',
  new: 'Built Python Airflow pipelines on Kubernetes that cut report time by 40%',
  old_tex: 'Built Python Airflow pipelines that cut report time by 40\\%',
  new_tex: 'Built Python Airflow pipelines on Kubernetes that cut report time by 40\\%',
  terms: ['Kubernetes'],
  source_card_id: 4,
  score_delta: 10,
}

export function detail(over: Partial<ApplicationDetail> = {}): ApplicationDetail {
  return {
    id: 1,
    posting_id: 7,
    status: 'not_applied',
    created_at: '2026-10-27T10:00:00Z',
    posting: { id: 7, title: 'ML Engineer', company: 'Northwind' },
    version: {
      id: 11, version: 1, tex: TEX, bullets: [], record_hash: 'h', created_at: '2026-10-27T10:00:00Z',
    },
    score: 62,
    matches: [
      { term: 'Python', status: 'matched' },
      { term: 'Airflow', status: 'matched' },
      { term: 'Pipeline', status: 'partial' },
      { term: 'PostgreSQL', status: 'missing' },
      { term: 'Kubernetes', status: 'missing' },
    ],
    potential: 76,
    suggestions: [SUGGESTION],
    uncovered: [{ term: 'Kubernetes', kind: 'tool', weight: 2 }],
    stale: false,
    ...over,
  }
}

export function editorView(): EditorView {
  const el = document.querySelector('.cm-editor') as HTMLElement | null
  if (!el) throw new Error('no editor rendered')
  const view = EditorView.findFromDOM(el)
  if (!view) throw new Error('no EditorView for .cm-editor')
  return view
}

/** Insert text as if typed, at a document offset. */
export function typeAt(pos: number, text: string) {
  act(() => {
    editorView().dispatch({ changes: { from: pos, insert: text }, userEvent: 'input.type' })
  })
}

export function docText(): string {
  return editorView().state.doc.toString()
}

/** Offset of the end of the first occurrence of `needle` in the editor's document. */
export function offsetAfter(needle: string): number {
  const i = docText().indexOf(needle)
  if (i < 0) throw new Error(`not in doc: ${needle}`)
  return i + needle.length
}
