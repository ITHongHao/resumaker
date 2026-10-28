import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { StreamLanguage, defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { stex } from '@codemirror/legacy-modes/mode/stex'
import { EditorState, StateEffect, StateField, type Range } from '@codemirror/state'
import {
  Decoration,
  EditorView,
  WidgetType,
  keymap,
  lineNumbers,
  type DecorationSet,
} from '@codemirror/view'
import { useEffect, useRef } from 'react'

import type { Suggestion } from '@/api'
import { ITEM_PREFIX, linesForTerm, locateSuggestions, termRanges } from '@/lib/termMatch'

/*
 * The .tex source editor. Suggestions are tracked changes drawn on the document itself:
 * the bullet's line is tinted, its old text struck through, the new text shown inline after
 * it, and a widget below the line holds the matched terms, the source card, the score delta
 * and Accept / Reject buttons.
 *
 * Decorations are recomputed from the current text on every change (they are not mapped
 * positions): a suggestion is drawn only on a line that still reads exactly
 * \resumeItem{old}. Hand-editing that line therefore drops the suggestion instead of
 * leaving it pointing at the wrong text, and undoing the edit brings it back.
 */

interface Config {
  suggestions: Suggestion[]
  cardTitles: Record<number, string>
  highlightTerm: string | null
  onReject: (s: Suggestion) => void
  onAccept?: (s: Suggestion) => void
}

const setConfig = StateEffect.define<Config>()

const configField = StateField.define<Config>({
  create: () => ({ suggestions: [], cardTitles: {}, highlightTerm: null, onReject: () => {} }),
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setConfig)) value = e.value
    return value
  },
})

function docLines(state: EditorState): string[] {
  const out: string[] = []
  for (let i = 1; i <= state.doc.lines; i++) out.push(state.doc.line(i).text)
  return out
}

/** Where a suggestion's old text sits in the current document, or null if it is gone. */
function findSuggestion(state: EditorState, s: Suggestion): { from: number; to: number } | null {
  const { suggestions } = state.field(configField)
  const k = suggestions.indexOf(s)
  const at = locateSuggestions(docLines(state), k >= 0 ? suggestions : [s])[k >= 0 ? k : 0]
  if (at < 0) return null
  const line = state.doc.line(at + 1)
  const from = line.from + line.text.indexOf(ITEM_PREFIX) + ITEM_PREFIX.length
  return { from, to: from + s.old_tex.length }
}

class NewTextWidget extends WidgetType {
  readonly text: string
  constructor(text: string) {
    super()
    this.text = text
  }
  eq(other: NewTextWidget) {
    return other.text === this.text
  }
  toDOM() {
    const span = document.createElement('span')
    span.className = 'cm-sugg-new'
    span.textContent = this.text
    return span
  }
}

class SuggestionWidget extends WidgetType {
  readonly s: Suggestion
  readonly cardTitle: string | undefined
  constructor(s: Suggestion, cardTitle: string | undefined) {
    super()
    this.s = s
    this.cardTitle = cardTitle
  }
  eq(other: SuggestionWidget) {
    return (
      other.s.old_tex === this.s.old_tex &&
      other.s.new_tex === this.s.new_tex &&
      other.s.score_delta === this.s.score_delta &&
      other.s.terms.join('\n') === this.s.terms.join('\n') &&
      other.cardTitle === this.cardTitle
    )
  }
  toDOM(view: EditorView) {
    const { s, cardTitle } = this
    const box = document.createElement('div')
    box.className = 'cm-sugg-widget'
    box.setAttribute('role', 'group')
    box.setAttribute('aria-label', 'Suggested rewrite')
    const terms = s.terms.map((t) => `"${t}"`).join(' and ')
    const parts = [`Matches ${terms} from the posting`]
    if (cardTitle) parts.push(`pulled from "${cardTitle}"`)
    parts.push(s.score_delta > 0 ? `+${s.score_delta} match` : 'no score change')
    const meta = document.createElement('span')
    meta.className = 'cm-sugg-meta'
    meta.textContent = parts.join(' · ')
    box.append(meta)

    const button = (label: string, cls: string, aria: string, onClick: () => void) => {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = cls
      b.textContent = label
      b.setAttribute('aria-label', aria)
      b.addEventListener('click', (e) => {
        e.preventDefault()
        onClick()
      })
      return b
    }
    const what = s.terms.length ? ` adding ${s.terms.join(', ')}` : ''
    const actions = document.createElement('span')
    actions.className = 'cm-sugg-actions'
    box.append(actions)
    actions.append(
      button('Accept', 'cm-sugg-accept', `Accept suggestion${what}`, () => {
        const range = findSuggestion(view.state, s)
        if (!range) return
        view.dispatch({
          changes: { ...range, insert: s.new_tex },
          selection: { anchor: range.from + s.new_tex.length },
          userEvent: 'input.accept',
          scrollIntoView: true,
        })
        view.focus()
        view.state.field(configField).onAccept?.(s)
      }),
      button('Reject', 'cm-sugg-reject', `Reject suggestion${what}`, () => {
        view.state.field(configField).onReject(s)
        view.focus()
      }),
    )
    return box
  }
  // Buttons inside handle their own events; the editor must not treat clicks as selection.
  ignoreEvent() {
    return true
  }
}

const suggLine = Decoration.line({ class: 'cm-sugg-line' })
const suggOld = Decoration.mark({ class: 'cm-sugg-old' })
const hitLine = Decoration.line({ class: 'cm-req-hit' })
const hitTerm = Decoration.mark({ class: 'cm-req-term' })

function build(state: EditorState): DecorationSet {
  const { suggestions, cardTitles, highlightTerm } = state.field(configField)
  const lines = docLines(state)
  const out: Range<Decoration>[] = []
  locateSuggestions(lines, suggestions).forEach((at, k) => {
    if (at < 0) return
    const s = suggestions[k]
    const line = state.doc.line(at + 1)
    const from = line.from + line.text.indexOf(ITEM_PREFIX) + ITEM_PREFIX.length
    const to = from + s.old_tex.length
    out.push(suggLine.range(line.from))
    if (to > from) out.push(suggOld.range(from, to))
    out.push(Decoration.widget({ widget: new NewTextWidget(s.new_tex), side: 1 }).range(to))
    out.push(
      Decoration.widget({ widget: new SuggestionWidget(s, cardTitles[s.source_card_id]), block: true, side: 1 }).range(
        line.to,
      ),
    )
  })
  if (highlightTerm) {
    for (const i of linesForTerm(lines, highlightTerm, suggestions)) {
      const line = state.doc.line(i + 1)
      out.push(hitLine.range(line.from))
      for (const [a, b] of termRanges(highlightTerm, line.text)) out.push(hitTerm.range(line.from + a, line.from + b))
    }
  }
  return Decoration.set(out, true)
}

// Block widgets must come from state, not a view plugin; recompute on doc or config change.
const decorations = EditorView.decorations.compute(['doc', configField], build)

const theme = EditorView.theme({
  '&': { height: '100%', fontSize: '13px', backgroundColor: 'var(--background)' },
  '.cm-scroller': { overflow: 'auto', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
  '.cm-content': { paddingBottom: '2rem' },
  '.cm-gutters': { backgroundColor: 'transparent', border: 'none', color: '#9aa1a9' },
  '.cm-sugg-line': { backgroundColor: '#fff8ea' },
  '.cm-sugg-old': { textDecoration: 'line-through', color: '#b42318' },
  '.cm-sugg-new': {
    backgroundColor: '#e8f6ee',
    color: '#1a7f4b',
    marginLeft: '0.5em',
    borderRadius: '3px',
    padding: '0 2px',
  },
  '.cm-sugg-widget': {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '6px',
    padding: '4px 8px 6px 2.5em',
    backgroundColor: '#fff8ea',
    borderBottom: '1px solid #f5c26b',
    color: '#a15c00',
    fontFamily: 'var(--font-sans, system-ui, sans-serif)',
    fontSize: '12px',
  },
  '.cm-sugg-meta': { marginRight: '4px' },
  '.cm-sugg-actions': { display: 'inline-flex', gap: '6px' },
  '.cm-sugg-accept, .cm-sugg-reject': {
    borderRadius: '999px',
    padding: '1px 10px',
    fontSize: '12px',
    cursor: 'pointer',
  },
  '.cm-sugg-accept': { backgroundColor: '#2457d6', color: '#fff', border: '1px solid #2457d6' },
  '.cm-sugg-reject': { backgroundColor: '#fff', color: '#333', border: '1px solid #d5d8dc' },
  '.cm-sugg-accept:focus-visible, .cm-sugg-reject:focus-visible': {
    outline: '2px solid #2457d6',
    outlineOffset: '2px',
  },
  '.cm-req-hit': { backgroundColor: '#eef4ff', boxShadow: 'inset 3px 0 0 #2457d6' },
  '.cm-req-term': { backgroundColor: '#cfe8d9', borderRadius: '2px' },
})

const NO_TITLES: Record<number, string> = {}

export interface SourceEditorProps {
  /** The document on mount. Later changes come from the user; the editor owns its text. */
  initialValue: string
  onChange: (tex: string) => void
  /** Suggestions to draw. One whose old text is no longer on its line is not drawn. */
  suggestions: Suggestion[]
  cardTitles?: Record<number, string>
  /** Requirement whose lines are highlighted (and scrolled to), or null. */
  highlightTerm?: string | null
  onReject: (s: Suggestion) => void
  onAccept?: (s: Suggestion) => void
}

export default function SourceEditor({
  initialValue,
  onChange,
  suggestions,
  cardTitles = NO_TITLES,
  highlightTerm = null,
  onReject,
  onAccept,
}: SourceEditorProps) {
  const host = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  // The editor owns its document after mount; initialValue is only the starting text.
  const initialRef = useRef(initialValue)
  // Whether this view has done its first scroll (see below). Reset per view: StrictMode
  // mounts the editor twice in development.
  const openedAt = useRef(false)
  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useEffect(() => {
    const view = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: initialRef.current,
        extensions: [
          lineNumbers(),
          history(),
          // No indentWithTab: Tab keeps moving focus, so Accept / Reject are reachable.
          keymap.of([...defaultKeymap, ...historyKeymap]),
          StreamLanguage.define(stex),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({ 'aria-label': 'Resume source (.tex)' }),
          configField,
          decorations,
          theme,
          EditorView.updateListener.of((u) => {
            if (u.docChanged) onChangeRef.current(u.state.doc.toString())
          }),
        ],
      }),
    })
    viewRef.current = view
    openedAt.current = false
    return () => {
      view.destroy()
      viewRef.current = null
    }
  }, [])

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: setConfig.of({ suggestions, cardTitles, highlightTerm, onReject, onAccept }),
    })
  }, [suggestions, cardTitles, highlightTerm, onReject, onAccept])

  // On open, show the first suggestion (or the start of the document body) rather than the
  // preamble. Only the editor's own scroller moves, not the page.
  useEffect(() => {
    const view = viewRef.current
    if (!view || openedAt.current) return
    openedAt.current = true
    const lines = docLines(view.state)
    const first = locateSuggestions(lines, suggestions).find((at) => at >= 0)
    const body = lines.findIndex((l) => l.trim().startsWith('\\begin{document}'))
    const target = first ?? (body >= 0 ? body : -1)
    if (target <= 0) return
    const pos = view.state.doc.line(target + 1).from
    view.requestMeasure({
      read: (v) => v.lineBlockAt(pos).top,
      write: (top, v) => {
        v.scrollDOM.scrollTop = Math.max(0, top - v.scrollDOM.clientHeight / 3)
      },
    })
  }, [suggestions])

  useEffect(() => {
    const view = viewRef.current
    if (!view || !highlightTerm) return
    const state = view.state
    const [first] = linesForTerm(docLines(state), highlightTerm, state.field(configField).suggestions)
    if (first === undefined) return
    view.dispatch({ effects: EditorView.scrollIntoView(state.doc.line(first + 1).from, { y: 'center' }) })
  }, [highlightTerm])

  return <div ref={host} className="h-full min-h-0" />
}
