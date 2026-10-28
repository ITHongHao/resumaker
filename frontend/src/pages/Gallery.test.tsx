import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import Gallery from './Gallery'
import { installFakeApi } from '@/test/fakeApi'

afterEach(() => vi.unstubAllGlobals())

const apps = [ // newest-edited first, as the backend returns them
  { id: 2, posting_id: 2, status: 'not_applied', created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-03T00:00:00Z', title: 'Backend Engineer', company: 'Plaid', score: 64, version: 2, stale: true },
  { id: 1, posting_id: 1, status: 'applied', created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-02T00:00:00Z', title: 'ML Engineer', company: 'Northwind', score: 91, version: 1 },
]

function setup(list: unknown[] = apps) {
  const server = installFakeApi()
  server.override = ({ method, path }) => {
    if (method === 'GET' && path === '/api/applications') {
      const q = (server.calls.at(-1)?.search ?? '')
      const params = new URLSearchParams(q)
      const status = params.get('status')
      const needle = (params.get('q') ?? '').toLowerCase()
      return {
        body: (list as typeof apps).filter(
          (a) => (!status || a.status === status) && (!needle || (a.title + a.company).toLowerCase().includes(needle)),
        ),
      }
    }
  }
  render(<MemoryRouter><Gallery /></MemoryRouter>)
  return server
}

describe('Gallery', () => {
  it('gallery shows new-application tile first', async () => {
    setup()
    await screen.findByText('ML Engineer')
    const links = screen.getAllByRole('link')
    expect(links[0]).toHaveAccessibleName(/new application/i)
    expect(links[0]).toHaveAttribute('href', '/resumes/new')
    expect(links[1]).toHaveAttribute('href', '/applications/2')
    expect(screen.getByText('91')).toBeInTheDocument()
  })

  it('marks stale resumes', async () => {
    setup()
    await screen.findByText('Backend Engineer')
    expect(screen.getAllByText(/record changed since this was made/i)).toHaveLength(1)
  })

  it('filter by status narrows tiles', async () => {
    const server = setup()
    const user = userEvent.setup()
    await screen.findByText('ML Engineer')
    await user.selectOptions(screen.getByLabelText(/status/i), 'applied')
    await vi.waitFor(() => expect(screen.queryByText('Backend Engineer')).not.toBeInTheDocument())
    expect(screen.getByText('ML Engineer')).toBeInTheDocument()
    expect(server.calls.some((c) => c.search?.includes('status=applied'))).toBe(true)
  })

  it('search narrows tiles by role or company', async () => {
    setup()
    const user = userEvent.setup()
    await screen.findByText('ML Engineer')
    await user.type(screen.getByLabelText(/search/i), 'plaid')
    await vi.waitFor(() => expect(screen.queryByText('ML Engineer')).not.toBeInTheDocument())
    expect(screen.getByText('Backend Engineer')).toBeInTheDocument()
  })

  it('empty gallery points to Record and New application', async () => {
    setup([])
    expect(await screen.findByText(/no resumes yet/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /record/i })).toHaveAttribute('href', '/record')
    expect(screen.getAllByRole('link', { name: /new application/i }).length).toBeGreaterThan(0)
  })

  it('shows a readable error when the server is unreachable', async () => {
    const server = installFakeApi()
    server.override = () => ({ status: 500, body: { detail: 'boom' } })
    render(<MemoryRouter><Gallery /></MemoryRouter>)
    expect(await screen.findByText(/boom/)).toBeInTheDocument()
  })
})
