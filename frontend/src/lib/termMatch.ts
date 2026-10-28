/**
 * Which source lines mention a posting requirement, for chip highlighting.
 *
 * A port of the backend scorer's matching (backend/app/scoring.py) applied to one line at a
 * time: a whole-word, case-insensitive match where spaces and hyphens are interchangeable and
 * "C" does not match inside "C++"; an alias spelling (k8s for Kubernetes) also counts; and a
 * stem match ("pipelines" for "Pipeline") counts for plain word terms. LaTeX command names,
 * braces and comments are blanked out first (offsets are kept, so match ranges map back onto
 * the original line). The score itself always comes from the backend; this only drives the
 * highlight.
 */

import type { Suggestion } from '@/api'

const ALIAS_GROUPS: string[][] = [
  ['pytorch', 'torch'],
  ['javascript', 'js'],
  ['typescript', 'ts'],
  ['kubernetes', 'k8s'],
  ['postgresql', 'postgres'],
  ['machine learning', 'ml'],
  ['node.js', 'nodejs'],
  ['amazon web services', 'aws'],
  ['continuous integration', 'ci'],
]
const STEM_SUFFIXES = ['ments', 'ment', 'ings', 'ing', 'ers', 'er', 'ed', 'es', 's']
const MIN_STEM_LEN = 4

const norm = (term: string) => term.trim().toLowerCase().replace(/[\s-]+/g, ' ')
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const alnum = (c: string) => /[a-z0-9]/.test(c)

function exactPattern(n: string): RegExp {
  const body = n.split(' ').map(escapeRe).join('[\\s\\-]+')
  const before = alnum(n[0]) ? '(?<![a-z0-9])(?<![a-z0-9]\\.)' : '(?<![a-z0-9])'
  const after = alnum(n[n.length - 1]) ? '(?![a-z0-9+#])' : '(?![a-z0-9])'
  return new RegExp(before + body + after, 'g')
}

function stem(word: string): string {
  for (const s of STEM_SUFFIXES) {
    if (word.endsWith(s) && word.length - s.length >= MIN_STEM_LEN) {
      word = word.slice(0, -s.length)
      break
    }
  }
  if (word.endsWith('e') && word.length > MIN_STEM_LEN) word = word.slice(0, -1)
  return word
}

const stemTokens = (text: string) => (text.match(/[a-z0-9]+/g) ?? []).map(stem)

/** Lowercased line with LaTeX markup blanked to spaces, same length as the input. */
export function plainLine(line: string): string {
  const blank = (m: string) => ' '.repeat(m.length)
  return line
    .replace(/\\.|%.*$/g, (m) => (m.startsWith('\\') ? m : blank(m))) // comments
    .replace(/\\([%&#$_{}])|\\[a-zA-Z]+\*?|\\.|[{}]/g, (m, lit: string | undefined) =>
      lit ? ` ${lit}` : blank(m),
    )
    .toLowerCase()
}

/** [from, to) offsets in `line` of exact or alias mentions of `term`. */
export function termRanges(term: string, line: string): [number, number][] {
  const n = norm(term)
  if (!n) return []
  const text = plainLine(line)
  const spellings = [n, ...(ALIAS_GROUPS.find((g) => g.includes(n)) ?? []).filter((o) => o !== n)]
  const out: [number, number][] = []
  for (const s of spellings) {
    for (const m of text.matchAll(exactPattern(s))) out.push([m.index, m.index + m[0].length])
  }
  return out.sort((a, b) => a[0] - b[0])
}

/** Whether the line mentions the term under the scorer's matched-or-partial rules. */
export function lineMentions(term: string, line: string): boolean {
  if (termRanges(term, line).length) return true
  const n = norm(term)
  if (!/^[a-z0-9]+( [a-z0-9]+)*$/.test(n) || n.replace(/ /g, '').length < 3) return false
  const needle = ` ${stemTokens(n).join(' ')} `
  return ` ${stemTokens(plainLine(line)).join(' ')} `.includes(needle)
}

export const ITEM_PREFIX = '\\resumeItem{'
export const itemLine = (textTex: string) => `${ITEM_PREFIX}${textTex}}`

/**
 * The 0-based line index holding each suggestion's bullet, or -1 when its `old` text is no
 * longer on a line of its own (accepted or hand-edited). The bullet_index-th \resumeItem line
 * is used when it still reads exactly \resumeItem{old}. Otherwise (bullets added or moved) the
 * one unclaimed line with exactly that text is used; when several lines have that text the
 * suggestion is dropped rather than guessed onto what may be another job's bullet.
 */
export function locateSuggestions(lines: string[], suggestions: Suggestion[]): number[] {
  const items = lines.flatMap((l, i) => (l.trim().startsWith(ITEM_PREFIX) ? [i] : []))
  const claimed = new Set<number>()
  return suggestions.map((s) => {
    const target = itemLine(s.old_tex)
    const preferred = items[s.bullet_index]
    let at = -1
    if (preferred !== undefined && !claimed.has(preferred) && lines[preferred].trim() === target) {
      at = preferred
    } else {
      const candidates = items.filter((i) => !claimed.has(i) && lines[i].trim() === target)
      if (candidates.length === 1) at = candidates[0]
    }
    if (at >= 0) claimed.add(at)
    return at
  })
}

/**
 * 0-based indexes of lines a chip should highlight: lines mentioning the term, plus the lines
 * of shown suggestions that would add it.
 */
export function linesForTerm(lines: string[], term: string, suggestions: Suggestion[]): number[] {
  const hit = new Set<number>()
  lines.forEach((l, i) => lineMentions(term, l) && hit.add(i))
  const key = norm(term)
  locateSuggestions(lines, suggestions).forEach((at, k) => {
    if (at >= 0 && suggestions[k].terms.some((t) => norm(t) === key)) hit.add(at)
  })
  return [...hit].sort((a, b) => a - b)
}
