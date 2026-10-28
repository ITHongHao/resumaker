import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import PdfPreview from './PdfPreview'
import { installFakeApi } from '@/test/fakeApi'

let urls = 0
beforeEach(() => {
  urls = 0
  URL.createObjectURL = vi.fn(() => `blob:pdf-${++urls}`)
  URL.revokeObjectURL = vi.fn()
})
afterEach(() => vi.unstubAllGlobals())

const pdf = () => new Blob(['%PDF-1.5'], { type: 'application/pdf' })
const failure = {
  status: 422,
  body: { detail: { message: 'LaTeX compilation failed', log: '! Undefined control sequence.\nl.5 \\resumeItm' } },
}

describe('PdfPreview', () => {
  it('compile error keeps previous pdf and shows the log', async () => {
    const server = installFakeApi()
    let fail = false
    server.override = ({ path }) => (path === '/api/latex/compile' ? (fail ? failure : { body: pdf() }) : undefined)
    const { rerender } = render(<PdfPreview tex="good" delay={0} />)
    const frame = await screen.findByTitle('PDF preview')
    expect(frame).toHaveAttribute('src', 'blob:pdf-1')

    fail = true
    rerender(<PdfPreview tex="bad \resumeItm" delay={0} />)
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('LaTeX compilation failed')
    // The last good PDF stays visible beside the error.
    expect(screen.getByTitle('PDF preview')).toHaveAttribute('src', 'blob:pdf-1')
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith('blob:pdf-1')
    const log = screen.getByText(/undefined control sequence/i)
    expect(log.closest('details')).not.toHaveAttribute('open')
    await userEvent.setup().click(screen.getByText(/compiler log/i))
    expect(log.closest('details')).toHaveAttribute('open')

    fail = false
    rerender(<PdfPreview tex="good again" delay={0} />)
    await waitFor(() => expect(screen.getByTitle('PDF preview')).toHaveAttribute('src', 'blob:pdf-2'))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:pdf-1')
  })

  it('shows the compiler message even when no pdf was ever built', async () => {
    const server = installFakeApi()
    server.override = ({ path }) =>
      path === '/api/latex/compile'
        ? { status: 422, body: { detail: { message: 'LaTeX compilation failed', log: 'tectonic is not installed. Install it with: brew install tectonic' } } }
        : undefined
    render(<PdfPreview tex="x" delay={0} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('LaTeX compilation failed')
    expect(screen.getByText(/brew install tectonic/)).toBeInTheDocument()
    expect(screen.queryByTitle('PDF preview')).toBeNull()
  })

  it('an older compile finishing late never replaces a newer one', async () => {
    const server = installFakeApi()
    let release!: () => void
    const slow = new Promise<void>((r) => (release = r))
    server.override = async ({ path, body }) => {
      if (path !== '/api/latex/compile') return undefined
      if (body.tex === 'first') {
        await slow
        return failure
      }
      return { body: pdf() }
    }
    const { rerender } = render(<PdfPreview tex="first" delay={0} />)
    await waitFor(() => expect(server.calls.some((c) => c.body?.tex === 'first')).toBe(true))
    rerender(<PdfPreview tex="second" delay={0} />)
    await waitFor(() => expect(screen.getByTitle('PDF preview')).toHaveAttribute('src', 'blob:pdf-1'))
    release()
    await new Promise((r) => setTimeout(r, 20))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByTitle('PDF preview')).toHaveAttribute('src', 'blob:pdf-1')
  })
})
