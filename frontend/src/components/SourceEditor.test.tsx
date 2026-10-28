import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type { Suggestion } from '@/api'
import SourceEditor from './SourceEditor'
import { SUGGESTION, TEX, docText, editorView, offsetAfter, typeAt } from '@/test/editorFixtures'

function Harness({ onChange = () => {}, highlightTerm = null as string | null, initial = [SUGGESTION] }: {
  onChange?: (t: string) => void
  highlightTerm?: string | null
  initial?: Suggestion[]
}) {
  const [suggestions, setSuggestions] = useState(initial)
  return (
    <SourceEditor
      initialValue={TEX}
      onChange={onChange}
      suggestions={suggestions}
      cardTitles={{ 5: 'Recipe site' }}
      highlightTerm={highlightTerm}
      onReject={(s) => setSuggestions((all) => all.filter((x) => x !== s))}
    />
  )
}

const lineEl = (text: string) =>
  [...document.querySelectorAll('.cm-line')].find((l) => l.textContent?.includes(text)) as HTMLElement

describe('SourceEditor', () => {
  it('shows a suggestion inline as a tracked change on its bullet line', () => {
    render(<Harness />)
    const old = document.querySelector('.cm-sugg-old')
    expect(old).toHaveTextContent('Built a TypeScript web app')
    expect(old?.closest('.cm-line')).toHaveClass('cm-sugg-line')
    expect(document.querySelector('.cm-sugg-new')).toHaveTextContent('backed by PostgreSQL')
    const widget = document.querySelector('.cm-sugg-widget')!
    expect(widget).toHaveTextContent('PostgreSQL')
    expect(widget).toHaveTextContent('pulled from "Recipe site"')
    expect(widget).toHaveTextContent('+14')
  })

  it('accepting a suggestion replaces the line', async () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    await userEvent.setup().click(screen.getByRole('button', { name: /accept/i }))
    expect(docText()).toContain('    \\resumeItem{Built a TypeScript web app backed by PostgreSQL}')
    expect(docText()).not.toContain('\\resumeItem{Built a TypeScript web app}')
    expect(onChange).toHaveBeenLastCalledWith(docText())
    expect(document.querySelector('.cm-sugg-old')).toBeNull()
    expect(screen.queryByRole('button', { name: /accept/i })).toBeNull()
  })

  it('rejecting removes the decoration only', async () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    await userEvent.setup().click(screen.getByRole('button', { name: /reject/i }))
    expect(document.querySelector('.cm-sugg-old')).toBeNull()
    expect(document.querySelector('.cm-sugg-widget')).toBeNull()
    expect(docText()).toBe(TEX)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('editing a suggested line removes its suggestion', () => {
    render(<Harness />)
    typeAt(offsetAfter('Built a TypeScript'), ' and React')
    expect(document.querySelector('.cm-sugg-old')).toBeNull()
    expect(document.querySelector('.cm-sugg-widget')).toBeNull()
    expect(screen.queryByRole('button', { name: /accept/i })).toBeNull()
  })

  it('keeps a suggestion on its own bullet when other lines change', () => {
    render(<Harness />)
    typeAt(offsetAfter('\\section{Experience}'), '\n    \\resumeItem{A brand new first bullet}')
    const old = document.querySelector('.cm-sugg-old')
    expect(old).toHaveTextContent('Built a TypeScript web app')
    expect(old?.closest('.cm-line')).toBe(lineEl('Built a TypeScript web app'))
    expect(lineEl('A brand new first bullet')).not.toHaveClass('cm-sugg-line')
  })

  it('Accept and Reject are focusable buttons with labels', () => {
    render(<Harness />)
    for (const name of [/accept/i, /reject/i]) {
      const b = screen.getByRole('button', { name })
      expect(b.tagName).toBe('BUTTON')
      expect(b).not.toHaveAttribute('tabindex', '-1')
      expect(b.getAttribute('aria-label')).toMatch(/PostgreSQL/)
    }
  })

  it('highlights lines mentioning the selected requirement', () => {
    const { rerender } = render(<Harness highlightTerm="Airflow" />)
    expect(lineEl('Airflow pipelines')).toHaveClass('cm-req-hit')
    expect(lineEl('TypeScript web app')).not.toHaveClass('cm-req-hit')
    expect(document.querySelector('.cm-req-term')).toHaveTextContent('Airflow')
    // A missing term is highlighted where a suggestion would add it.
    rerender(<Harness highlightTerm="PostgreSQL" />)
    expect(lineEl('TypeScript web app')).toHaveClass('cm-req-hit')
    expect(lineEl('Airflow pipelines')).not.toHaveClass('cm-req-hit')
    rerender(<Harness highlightTerm={null} />)
    expect(document.querySelector('.cm-req-hit')).toBeNull()
  })

  it('labels the editor and does not take focus by itself', () => {
    render(<Harness />)
    expect(editorView().contentDOM).toHaveAttribute('aria-label', 'Resume source (.tex)')
  })
})
