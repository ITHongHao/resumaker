import '@testing-library/jest-dom/vitest'

// jsdom has no layout. CodeMirror measures text through Range rects; give it empty ones.
if (typeof Range !== 'undefined') {
  const empty = () => Object.assign([], { item: () => null }) as unknown as DOMRectList
  Range.prototype.getClientRects ??= empty
  Range.prototype.getBoundingClientRect ??= () => new DOMRect()
}
