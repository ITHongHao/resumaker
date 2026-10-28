import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RouterProvider, createMemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ApplicationDetail } from '@/api'
import Editor from './Editor'
import { installFakeApi, type FakeServer } from '@/test/fakeApi'
import { TEX, detail, docText, offsetAfter, typeAt } from '@/test/editorFixtures'

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:pdf')
  URL.revokeObjectURL = vi.fn()
})
afterEach(() => vi.unstubAllGlobals())

const pdf = () => new Blob(['%PDF-1.5'], { type: 'application/pdf' })

type Over = Parameters<NonNullable<FakeServer['override']>>[0]

function setup(app: ApplicationDetail = detail(), extra?: (r: Over) => ReturnType<NonNullable<FakeServer['override']>>) {
  const server = installFakeApi({
    cards: [{ id: 5, job_id: null, kind: 'project', title: 'Recipe site', description: '', details: '', tags: [], extra: {} }],
  })
  server.override = async (r) => {
    const own = await extra?.(r)
    if (own) return own
    if (r.method === 'GET' && r.path === '/api/applications/1') return { body: app }
    if (r.method === 'POST' && r.path === '/api/applications/1/score') {
      const accepted = String(r.body.tex).includes('PostgreSQL')
      return { body: { score: accepted ? 76 : 62, matches: app.matches, potential: 76 } }
    }
    if (r.method === 'POST' && r.path === '/api/latex/compile') return { body: pdf() }
    if (r.method === 'POST' && r.path === '/api/applications/1/versions')
      return { status: 201, body: { ...app.version, id: 12, version: 2, tex: r.body.tex } }
    if (r.method === 'PATCH' && r.path === '/api/applications/1') return { body: { ...app, status: r.body.status } }
    return undefined
  }
  const router = createMemoryRouter(
    [
      { path: '/applications/:id', element: <Editor /> },
      { path: '/resumes', element: <div>GALLERY</div> },
    ],
    { initialEntries: ['/applications/1'] },
  )
  render(<RouterProvider router={router} />)
  return { server, router }
}

// The page renders, then the editor mounts in an effect; wait for both.
async function loaded() {
  await screen.findByRole('heading', { name: /ml engineer/i })
  await waitFor(() => expect(document.querySelector('.cm-editor')).not.toBeNull())
}
const meter = () => screen.getByRole('meter', { name: /match score/i })
const scoreCalls = (s: FakeServer) => s.calls.filter((c) => c.path === '/api/applications/1/score')
const AI = /^\/api\/(ai\/|postings)|^\/api\/applications$/

describe('Editor', () => {
  it('shows the job, score, criteria chips and the source', async () => {
    setup()
    await loaded()
    expect(screen.getByText('Northwind')).toBeInTheDocument()
    expect(meter()).toHaveTextContent('62')
    expect(screen.getByText('→ 76 if all accepted')).toBeInTheDocument()
    for (const name of ['Python: matched', 'Pipeline: partial', 'Kubernetes: missing'])
      expect(screen.getByRole('button', { name })).toBeInTheDocument()
    expect(docText()).toBe(TEX)
    expect(screen.getByLabelText('Status')).toHaveValue('not_applied')
    expect(screen.queryByText(/record changed since this was made/i)).toBeNull()
  })

  it('accepting a suggestion replaces the line and updates the score', async () => {
    const { server } = setup()
    await loaded()
    await userEvent.setup().click(screen.getByRole('button', { name: /accept/i }))
    expect(docText()).toContain('\\resumeItem{Built a TypeScript web app backed by PostgreSQL}')
    await waitFor(() => expect(meter()).toHaveTextContent('76'))
    expect(scoreCalls(server).at(-1)?.body.tex).toContain('backed by PostgreSQL')
    expect(screen.queryByText(/if all accepted/)).toBeNull()
    expect(screen.getByText(/unsaved changes/i)).toBeInTheDocument()
  })

  it('rejecting removes the decoration only', async () => {
    const { server } = setup()
    await loaded()
    const before = server.calls.length
    await userEvent.setup().click(screen.getByRole('button', { name: /reject/i }))
    expect(document.querySelector('.cm-sugg-old')).toBeNull()
    expect(docText()).toBe(TEX)
    expect(screen.queryByText(/unsaved changes/i)).toBeNull()
    await new Promise((r) => setTimeout(r, 600))
    expect(server.calls.slice(before).filter((c) => c.method !== 'GET')).toEqual([])
  })

  it('clicking a chip highlights its lines', async () => {
    setup()
    await loaded()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Airflow: matched' }))
    const hits = [...document.querySelectorAll('.cm-req-hit')]
    expect(hits).toHaveLength(1)
    expect(hits[0]).toHaveTextContent('Airflow pipelines')
    expect(screen.getByRole('button', { name: 'Airflow: matched' })).toHaveAttribute('aria-pressed', 'true')
    // A missing requirement with nothing in the resume says so.
    await user.click(screen.getByRole('button', { name: 'Kubernetes: missing' }))
    expect(document.querySelector('.cm-req-hit')).toBeNull()
    expect(screen.getByText(/no line mentions "Kubernetes" yet/i)).toBeInTheDocument()
  })

  it('editing a suggested line removes its suggestion', async () => {
    setup()
    await loaded()
    expect(document.querySelector('.cm-sugg-old')).not.toBeNull()
    typeAt(offsetAfter('Built a TypeScript web'), ' and mobile')
    expect(document.querySelector('.cm-sugg-old')).toBeNull()
    expect(screen.queryByRole('button', { name: /accept/i })).toBeNull()
  })

  it('typing never calls an AI endpoint', async () => {
    const { server } = setup()
    await loaded()
    const before = server.calls.length
    let typed = 'report time by 40\\%'
    for (const ch of ' and Kubernetes') {
      typeAt(offsetAfter(typed), ch)
      typed += ch
    }
    await waitFor(() => expect(scoreCalls(server).length).toBeGreaterThan(0))
    await new Promise((r) => setTimeout(r, 1200))
    const during = server.calls.slice(before)
    expect(during.some((c) => AI.test(c.path))).toBe(false)
    for (const c of during) expect(['/api/applications/1/score', '/api/latex/compile']).toContain(c.path)
    // Debounced: a burst of keystrokes sends one score request, with the final text.
    expect(scoreCalls(server)).toHaveLength(1)
    expect(scoreCalls(server)[0].body.tex).toContain('40\\% and Kubernetes}')
  })

  it('an old score response never overwrites a newer one', async () => {
    let release!: () => void
    const slow = new Promise<void>((r) => (release = r))
    const { server } = setup(detail(), async (r) => {
      if (r.path === '/api/applications/1/score' && !String(r.body.tex).includes('second')) {
        await slow
        return { body: { score: 11, matches: detail().matches, potential: 11 } }
      }
      if (r.path === '/api/applications/1/score') return { body: { score: 88, matches: detail().matches, potential: 88 } }
      return undefined
    })
    await loaded()
    typeAt(offsetAfter('report time'), ' first')
    await waitFor(() => expect(scoreCalls(server)).toHaveLength(1))
    typeAt(offsetAfter('report time first'), ' second')
    await waitFor(() => expect(meter()).toHaveTextContent('88'))
    await act(async () => {
      release()
      await new Promise((r) => setTimeout(r, 20))
    })
    expect(meter()).toHaveTextContent('88')
  })

  it('uncovered requirement offers Ask AI', async () => {
    const { server } = setup()
    await loaded()
    const panel = screen.getByRole('region', { name: /not in your record yet/i })
    expect(within(panel).getByText(/"Kubernetes" is in the posting but nothing in your Record mentions it/i)).toBeInTheDocument()
    await userEvent.setup().click(within(panel).getByRole('button', { name: /ask ai about it/i }))
    const dialog = screen.getByRole('dialog', { name: /ask ai/i })
    const box = within(dialog).getByPlaceholderText(/describe what you did/i) as HTMLInputElement
    expect(box.value).toContain('"Kubernetes"')
    // Opening the drawer is not an AI call; only Send is.
    expect(server.calls.some((c) => c.path.startsWith('/api/ai/'))).toBe(false)
  })

  it('a stale resume shows the snapshot banner and does not regenerate', async () => {
    const { server } = setup(detail({ stale: true }))
    await loaded()
    expect(screen.getByText('Record changed since this was made')).toBeInTheDocument()
    expect(server.calls.some((c) => AI.test(c.path))).toBe(false)
  })

  it('Save stores a new version and clears the unsaved marker', async () => {
    const { server } = setup()
    await loaded()
    typeAt(offsetAfter('report time'), ' quickly')
    expect(screen.getByText(/unsaved changes/i)).toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: /^save$/i }))
    await waitFor(() => expect(screen.queryByText(/unsaved changes/i)).toBeNull())
    const save = server.calls.find((c) => c.path === '/api/applications/1/versions')
    expect(save?.method).toBe('POST')
    expect(save?.body.tex).toBe(docText())
    expect(screen.getByText('Saved as version 2.')).toBeInTheDocument()
    expect(screen.getByText('Version 2 saved')).toBeInTheDocument()
  })

  it('Export saves a version and downloads the PDF', async () => {
    const { server } = setup()
    await loaded()
    typeAt(offsetAfter('report time'), ' quickly')
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    await userEvent.setup().click(screen.getByRole('button', { name: /export pdf/i }))
    await waitFor(() => expect(click).toHaveBeenCalled())
    const paths = server.calls.filter((c) => c.method === 'POST').map((c) => c.path)
    expect(paths.lastIndexOf('/api/applications/1/versions')).toBeLessThan(paths.lastIndexOf('/api/latex/compile'))
    click.mockRestore()
  })

  it('Export shows the compiler message when the PDF cannot be built', async () => {
    let built = false
    setup(detail(), (r) => {
      if (r.path !== '/api/latex/compile') return undefined
      if (!built) {
        built = true
        return { body: pdf() }
      }
      return { status: 422, body: { detail: { message: 'LaTeX compilation failed', log: 'tectonic is not installed' } } }
    })
    await loaded()
    await waitFor(() => expect(built).toBe(true))
    await userEvent.setup().click(screen.getByRole('button', { name: /export pdf/i }))
    expect(await screen.findByText(/could not build the pdf/i)).toBeInTheDocument()
  })

  it('warns before leaving with unsaved changes', async () => {
    const { router } = setup()
    await loaded()
    const clean = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(clean)
    expect(clean.defaultPrevented).toBe(false)

    typeAt(offsetAfter('report time'), ' quickly')
    const dirty = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(dirty)
    expect(dirty.defaultPrevented).toBe(true)

    const user = userEvent.setup()
    await user.click(screen.getByRole('link', { name: /resumes/i }))
    const prompt = screen.getByRole('alertdialog', { name: /unsaved changes/i })
    await user.click(within(prompt).getByRole('button', { name: /stay/i }))
    expect(router.state.location.pathname).toBe('/applications/1')
    await user.click(screen.getByRole('link', { name: /resumes/i }))
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: /leave/i }))
    expect(await screen.findByText('GALLERY')).toBeInTheDocument()
  })

  it('changing the status saves it', async () => {
    const { server } = setup()
    await loaded()
    await userEvent.setup().selectOptions(screen.getByLabelText('Status'), 'applied')
    await waitFor(() =>
      expect(server.calls.find((c) => c.method === 'PATCH')?.body).toEqual({ status: 'applied' }))
  })

  it('a compile failure leaves the source fully usable', async () => {
    setup(detail(), (r) =>
      r.path === '/api/latex/compile'
        ? { status: 422, body: { detail: { message: 'LaTeX compilation failed', log: 'tectonic is not installed. Install it with: brew install tectonic' } } }
        : undefined)
    await loaded()
    expect(await screen.findByText(/brew install tectonic/)).toBeInTheDocument()
    typeAt(offsetAfter('report time'), ' quickly')
    expect(docText()).toContain('report time quickly')
    expect(screen.getByRole('button', { name: /accept/i })).toBeInTheDocument()
  })
})
