import { describe, expect, it } from 'vitest'

import type { Suggestion } from '@/api'
import { bodyLines, lineMentions, linesForTerm, locateSuggestions, termRanges } from './termMatch'

const sugg = (bullet_index: number, old_tex: string): Suggestion => ({
  bullet_index, old: old_tex, new: `${old_tex} better`, old_tex, new_tex: `${old_tex} better`,
  terms: ['X'], source_card_id: 1, score_delta: 1,
})

describe('locateSuggestions', () => {
  const lines = [
    '\\begin{document}',
    '    \\resumeItem{Led the team}', // bullet 0 (job A)
    '    \\resumeItem{Shipped the app}', // bullet 1
    '    \\resumeItem{Led the team}', // bullet 2 (job B), same text as bullet 0
  ]

  it('uses the bullet_index line when it still holds the old text', () => {
    expect(locateSuggestions(lines, [sugg(2, 'Led the team')])).toEqual([3])
    expect(locateSuggestions(lines, [sugg(1, 'Shipped the app')])).toEqual([2])
  })

  it('falls back to the one line with that text when bullets moved', () => {
    const moved = ['    \\resumeItem{New first bullet}', ...lines]
    expect(locateSuggestions(moved, [sugg(1, 'Shipped the app')])).toEqual([3])
  })

  it('drops the suggestion instead of guessing between identical bullets', () => {
    const moved = ['    \\resumeItem{New first bullet}', ...lines]
    // bullet_index 2 now points at "Shipped the app"; two lines read "Led the team".
    expect(locateSuggestions(moved, [sugg(2, 'Led the team')])).toEqual([-1])
  })

  it('drops a suggestion whose line was edited', () => {
    const edited = lines.map((l) => l.replace('Shipped the app', 'Shipped the mobile app'))
    expect(locateSuggestions(edited, [sugg(1, 'Shipped the app')])).toEqual([-1])
  })
})

describe('lineMentions', () => {
  it('matches whole words, aliases and stems like the scorer', () => {
    expect(lineMentions('Kubernetes', '\\resumeItem{Ran k8s clusters}')).toBe(true)
    expect(lineMentions('Go', '\\resumeItem{Go-to person}')).toBe(true) // scorer: hyphen splits words
    expect(lineMentions('C', '\\resumeItem{Wrote C++}')).toBe(false)
    expect(lineMentions('Pipeline', '\\resumeItem{Built pipelines}')).toBe(true)
    expect(lineMentions('Airflow', '% Airflow in a comment')).toBe(false)
  })
})

describe('only the document body is highlighted', () => {
  const doc = [
    '\\documentclass{article}',
    '\\usepackage[english]{babel}',
    '\\usepackage[usenames,dvipsnames]{color}',
    '\\begin{document}',
    '\\resumeItem{Wrote English docs}',
    '\\end{document}',
    'English after the end',
  ]

  it('ignores preamble package names and text after \\end{document}', () => {
    expect(linesForTerm(doc, 'English', [])).toEqual([4])
    expect(linesForTerm(doc, 'color', [])).toEqual([])
  })

  it('uses the whole text when there is no \\begin{document}', () => {
    expect(linesForTerm(['\\usepackage{color}', 'color line'], 'color', [])).toEqual([0, 1])
  })

  it('blanks the non-body part of a line, keeping offsets', () => {
    const one = ['\\usepackage{color}\\begin{document}color here\\end{document} color']
    const body = bodyLines(one)
    expect(body[0]).toHaveLength(one[0].length)
    expect(linesForTerm(one, 'color', [])).toEqual([0])
    expect(termRanges('color', body[0])).toEqual([[34, 39]])
  })
})
