import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import NewApplication from './NewApplication'
import { installFakeApi } from '@/test/fakeApi'

afterEach(() => vi.unstubAllGlobals())

const posting = {
  id: 7, source_kind: 'text', title: 'ML Engineer', company: 'Northwind',
  requirements: [{ term: 'PyTorch', kind: 'skill', weight: 3 }, { term: 'Airflow', kind: 'tool', weight: 2 }],
}

function setup(override?: Parameters<typeof installFakeApi>[0] extends never ? never : (req: { method: string; path: string; body: any }) => { status?: number; body?: unknown } | undefined) {
  const server = installFakeApi()
  server.override = override
  render(
    <MemoryRouter initialEntries={['/resumes/new']}>
      <Routes>
        <Route path="/resumes/new" element={<NewApplication />} />
        <Route path="/applications/:id" element={<div>EDITOR PLACEHOLDER</div>} />
      </Routes>
    </MemoryRouter>,
  )
  return server
}

const readPosting = async (user: ReturnType<typeof userEvent.setup>, text = 'We need PyTorch and Airflow') => {
  await user.type(screen.getByLabelText(/posting text/i), text)
  await user.click(screen.getByRole('button', { name: /read posting/i }))
}

describe('NewApplication', () => {
  it('Auto cater is disabled until a posting is read', async () => {
    const server = setup(({ method, path }) =>
      method === 'POST' && path === '/api/postings' ? { body: posting } : undefined)
    const user = userEvent.setup()
    const cater = screen.getByRole('button', { name: /auto cater/i })
    expect(cater).toBeDisabled()
    expect(screen.getByText('LaTeX')).toBeInTheDocument()
    expect(screen.getByText(/jake/i)).toBeInTheDocument()
    await readPosting(user)
    expect(await screen.findByText(/posting read/i)).toBeInTheDocument()
    expect(screen.getByText('PyTorch')).toBeInTheDocument()
    expect(cater).toBeEnabled()
    expect(server.calls.some((c) => c.path === '/api/applications')).toBe(false)
  })

  it('url fetch failure shows the paste-text fallback', async () => {
    setup(({ method, path }) =>
      method === 'POST' && path === '/api/postings'
        ? { status: 422, body: { fallback: 'paste_text', detail: 'Could not fetch that page. Paste the posting text instead.' } }
        : undefined)
    const user = userEvent.setup()
    await user.click(screen.getByRole('tab', { name: /url/i }))
    await user.type(screen.getByLabelText(/posting url/i), 'https://example.com/job')
    await user.click(screen.getByRole('button', { name: /read posting/i }))
    expect(await screen.findByText(/could not fetch that page/i)).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /paste text/i })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByLabelText(/posting text/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /auto cater/i })).toBeDisabled()
    await user.click(screen.getByRole('tab', { name: /url/i }))
    expect(screen.getByLabelText(/posting url/i)).toHaveValue('https://example.com/job')
  })

  it('no requirements found shows a message and keeps the input', async () => {
    setup(({ method, path }) =>
      method === 'POST' && path === '/api/postings'
        ? { status: 422, body: { fallback: 'paste_text', detail: 'No requirements could be found in that posting. Paste the posting text instead.' } }
        : undefined)
    const user = userEvent.setup()
    await readPosting(user, 'hello world')
    expect(await screen.findByText(/no requirements could be found/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/posting text/i)).toHaveValue('hello world')
    expect(screen.getByRole('button', { name: /auto cater/i })).toBeDisabled()
  })

  it('no key on reading the posting links to Settings and keeps the input', async () => {
    setup(({ method, path }) =>
      method === 'POST' && path === '/api/postings'
        ? { status: 400, body: { detail: 'No API key saved. Add one in Settings.' } }
        : undefined)
    const user = userEvent.setup()
    await readPosting(user, 'keep me')
    expect(await screen.findByText(/no api key saved/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /open settings/i })).toHaveAttribute('href', '/settings')
    expect(screen.getByLabelText(/posting text/i)).toHaveValue('keep me')
  })

  it('Auto cater creates the application and opens it', async () => {
    const server = setup(({ method, path }) => {
      if (method === 'POST' && path === '/api/postings') return { body: posting }
      if (method === 'POST' && path === '/api/applications') return { status: 201, body: { id: 42 } }
    })
    const user = userEvent.setup()
    await readPosting(user)
    await user.click(await screen.findByRole('button', { name: /auto cater/i }))
    expect(await screen.findByText('EDITOR PLACEHOLDER')).toBeInTheDocument()
    const call = server.calls.find((c) => c.path === '/api/applications')!
    expect(call.body).toEqual({ posting_id: 7 })
  })

  it.each([
    [400, 'No API key saved.', /settings/i, '/settings'],
    [422, 'Your Record is too small.', /record/i, '/record'],
  ])('%i from Auto cater links to the fix and keeps the posting', async (status, detail, linkName, href) => {
    setup(({ method, path }) => {
      if (method === 'POST' && path === '/api/postings') return { body: posting }
      if (method === 'POST' && path === '/api/applications') return { status: status as number, body: { detail } }
    })
    const user = userEvent.setup()
    await readPosting(user)
    await user.click(await screen.findByRole('button', { name: /auto cater/i }))
    expect(await screen.findByText(detail)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: linkName })).toHaveAttribute('href', href)
    expect(screen.getByText('PyTorch')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /auto cater/i })).toBeEnabled()
  })

  it('502 from Auto cater shows the message and keeps the posting', async () => {
    setup(({ method, path }) => {
      if (method === 'POST' && path === '/api/postings') return { body: posting }
      if (method === 'POST' && path === '/api/applications') return { status: 502, body: { detail: 'The AI service failed.' } }
    })
    const user = userEvent.setup()
    await readPosting(user)
    await user.click(await screen.findByRole('button', { name: /auto cater/i }))
    expect(await screen.findByText(/the ai service failed/i)).toBeInTheDocument()
    expect(screen.getByText('PyTorch')).toBeInTheDocument()
  })

  it('editing the input after a read disables Auto cater until it matches again', async () => {
    const server = setup(({ method, path }) =>
      method === 'POST' && path === '/api/postings' ? { body: posting } : undefined)
    const user = userEvent.setup()
    await readPosting(user, 'posting A')
    await screen.findByText(/posting read/i)
    const cater = screen.getByRole('button', { name: /auto cater/i })
    expect(cater).toBeEnabled()
    const box = screen.getByLabelText(/posting text/i)
    await user.type(box, ' edited')
    expect(await screen.findByText(/input changed since this posting was read/i)).toBeInTheDocument()
    expect(screen.getByText('PyTorch')).toBeInTheDocument()
    expect(cater).toBeDisabled()
    await user.type(box, '{Backspace>7/}')
    expect(box).toHaveValue('posting A')
    expect(cater).toBeEnabled()
    expect(screen.queryByText(/input changed since/i)).not.toBeInTheDocument()
    expect(server.calls.some((c) => c.path === '/api/applications')).toBe(false)
  })

  it.each([
    [502, { detail: 'The AI service failed.' }, /the ai service failed/i],
    [422, { fallback: 'paste_text', detail: 'No requirements could be found. Paste the posting text instead.' }, /no requirements could be found/i],
  ])('a failed re-read (%i) keeps the earlier posting', async (status, body, msg) => {
    let n = 0
    setup(({ method, path }) => {
      if (method === 'POST' && path === '/api/postings') return ++n === 1 ? { body: posting } : { status: status as number, body }
    })
    const user = userEvent.setup()
    await readPosting(user)
    await screen.findByText(/posting read/i)
    await user.click(screen.getByRole('button', { name: /read again/i }))
    expect(await screen.findByText(msg)).toBeInTheDocument()
    expect(screen.getByText('PyTorch')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /auto cater/i })).toBeEnabled()
  })

  it('Read is disabled while Auto cater is in flight, and a double click sends one request', async () => {
    let release: () => void = () => {}
    const server = setup(({ method, path }) => {
      if (method === 'POST' && path === '/api/postings') return { body: posting }
    })
    const base = server.override
    server.override = (req) => base?.(req)
    // hold the application request open
    const realFetch = globalThis.fetch
    vi.stubGlobal('fetch', vi.fn((url: string, opts?: RequestInit) =>
      url === '/api/applications' && opts?.method === 'POST'
        ? (server.calls.push({ method: 'POST', path: '/api/applications', body: JSON.parse(String(opts.body)) }),
          new Promise((r) => { release = () => r({ ok: true, status: 201, json: async () => ({ id: 42 }) } as Response) }))
        : realFetch(url, opts)))
    const user = userEvent.setup()
    await readPosting(user)
    const cater = await screen.findByRole('button', { name: /auto cater/i })
    await user.dblClick(cater)
    expect(server.calls.filter((c) => c.path === '/api/applications')).toHaveLength(1)
    expect(screen.getByRole('button', { name: /read again/i })).toBeDisabled()
    release()
    expect(await screen.findByText('EDITOR PLACEHOLDER')).toBeInTheDocument()
  })

  it('the read request carries only the active mode field', async () => {
    const server = setup(({ method, path }) =>
      method === 'POST' && path === '/api/postings' ? { body: posting } : undefined)
    const user = userEvent.setup()
    await user.click(screen.getByRole('tab', { name: /url/i }))
    await user.type(screen.getByLabelText(/posting url/i), 'https://example.com/j')
    await user.click(screen.getByRole('tab', { name: /paste text/i }))
    await readPosting(user, 'only text')
    const call = server.calls.find((c) => c.path === '/api/postings')!
    expect(call.body).toEqual({ text: 'only text' })
  })

  it('retrying after a cater error makes no second posting read', async () => {
    let apps = 0
    const server = setup(({ method, path }) => {
      if (method === 'POST' && path === '/api/postings') return { body: posting }
      if (method === 'POST' && path === '/api/applications')
        return ++apps === 1 ? { status: 502, body: { detail: 'The AI service failed.' } } : { status: 201, body: { id: 9 } }
    })
    const user = userEvent.setup()
    await readPosting(user)
    await user.click(await screen.findByRole('button', { name: /auto cater/i }))
    await screen.findByText(/the ai service failed/i)
    await user.click(screen.getByRole('button', { name: /auto cater/i }))
    expect(await screen.findByText('EDITOR PLACEHOLDER')).toBeInTheDocument()
    expect(server.calls.filter((c) => c.path === '/api/postings')).toHaveLength(1)
    expect(server.calls.filter((c) => c.path === '/api/applications')).toHaveLength(2)
  })
})
