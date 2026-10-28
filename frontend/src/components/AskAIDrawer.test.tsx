import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import AskAIDrawer from './AskAIDrawer'
import { installFakeApi } from '@/test/fakeApi'

afterEach(() => vi.unstubAllGlobals())

const proposal = {
  reply: 'Here is a draft.',
  proposals: [{ kind: 'project', title: 'Onboarding redesign', description: 'Redesigned onboarding in React.', tags: ['React'] }],
  followups: ['Do you have numbers for drop-off?'],
}

async function ask(server: ReturnType<typeof installFakeApi>) {
  server.override = ({ method, path }) =>
    method === 'POST' && path === '/api/ai/propose' ? { body: proposal } : undefined
  const user = userEvent.setup()
  const onAdded = vi.fn()
  render(<AskAIDrawer jobId={1} onAdded={onAdded} />)
  await user.click(screen.getByRole('button', { name: /ask ai/i }))
  await user.type(screen.getByPlaceholderText(/describe what you did/i), 'I redesigned onboarding')
  await user.click(screen.getByRole('button', { name: /send/i }))
  await screen.findByText('Onboarding redesign')
  return { user, onAdded }
}

describe('AskAIDrawer', () => {
  it('is closed until the button is pressed', async () => {
    installFakeApi()
    const user = userEvent.setup()
    render(<AskAIDrawer jobId={1} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByPlaceholderText(/describe what you did/i)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /ask ai/i }))
    expect(screen.getByRole('dialog', { name: /ask ai/i })).toBeInTheDocument()
  })

  it('does not save a proposal until Add is clicked', async () => {
    const server = installFakeApi()
    const { user, onAdded } = await ask(server)
    expect(server.calls.some((c) => c.method === 'POST' && c.path === '/api/cards')).toBe(false)
    expect(screen.getByText(/numbers for drop-off/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^add$/i }))
    const post = server.calls.find((c) => c.method === 'POST' && c.path === '/api/cards')!
    expect(post.body).toMatchObject({ job_id: 1, kind: 'project', title: 'Onboarding redesign', tags: ['React'] })
    expect(onAdded).toHaveBeenCalledTimes(1)
  })

  it('Edit opens the card form prefilled and saves only on Save', async () => {
    const server = installFakeApi()
    const { user, onAdded } = await ask(server)
    await user.click(screen.getByRole('button', { name: /^edit$/i }))
    expect(screen.getByLabelText(/^name$/i)).toHaveValue('Onboarding redesign')
    expect(screen.getByLabelText(/what it did/i)).toHaveValue('Redesigned onboarding in React.')
    expect(screen.getByLabelText(/tags/i)).toHaveValue('React')
    expect(server.calls.some((c) => c.method === 'POST' && c.path === '/api/cards')).toBe(false)

    await user.clear(screen.getByLabelText(/^name$/i))
    await user.type(screen.getByLabelText(/^name$/i), 'Onboarding v2')
    await user.click(screen.getByRole('button', { name: /^save$/i }))
    const post = server.calls.find((c) => c.method === 'POST' && c.path === '/api/cards')!
    expect(post.body).toMatchObject({ title: 'Onboarding v2', job_id: 1 })
    expect(onAdded).toHaveBeenCalledTimes(1)
  })

  it.each([
    [400, 'No API key saved for the selected AI provider. Add one in Settings.'],
    [502, 'Provider is down'],
  ])('shows a readable error for %i and changes nothing', async (status, detail) => {
    const server = installFakeApi()
    server.override = ({ path }) => (path === '/api/ai/propose' ? { status, body: { detail } } : undefined)
    const user = userEvent.setup()
    const onAdded = vi.fn()
    render(<AskAIDrawer jobId={1} onAdded={onAdded} />)
    await user.click(screen.getByRole('button', { name: /ask ai/i }))
    await user.type(screen.getByPlaceholderText(/describe what you did/i), 'hello')
    await user.click(screen.getByRole('button', { name: /send/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(detail)
    expect(onAdded).not.toHaveBeenCalled()
    expect(server.calls.some((c) => c.method === 'POST' && c.path === '/api/cards')).toBe(false)
  })

  it('can open with a prefilled message and a custom label, without sending it', async () => {
    const server = installFakeApi()
    const user = userEvent.setup()
    render(<AskAIDrawer jobId={null} label="Ask AI about it" initialMessage="Have I used Kubernetes?" />)
    await user.click(screen.getByRole('button', { name: 'Ask AI about it' }))
    expect(screen.getByPlaceholderText(/describe what you did/i)).toHaveValue('Have I used Kubernetes?')
    expect(server.calls.some((c) => c.path === '/api/ai/propose')).toBe(false)
    server.override = ({ path }) => (path === '/api/ai/propose' ? { body: proposal } : undefined)
    await user.click(screen.getByRole('button', { name: /send/i }))
    await screen.findByText('Onboarding redesign')
    const call = server.calls.find((c) => c.path === '/api/ai/propose')
    expect(call?.body).toMatchObject({ job_id: null, message: 'Have I used Kubernetes?' })
    await user.click(screen.getByRole('button', { name: /^add$/i }))
    const created = server.calls.find((c) => c.method === 'POST' && c.path === '/api/cards')
    expect(created?.body.job_id).toBeNull()
  })

  it('shows every field it will save, and Add sends exactly those fields', async () => {
    const server = installFakeApi()
    server.override = ({ method, path }) =>
      method === 'POST' && path === '/api/ai/propose'
        ? {
            body: {
              reply: 'ok',
              followups: [],
              proposals: [
                {
                  kind: 'project',
                  title: 'Ledger app',
                  description: 'Built a ledger.',
                  tags: ['Rust'],
                  // `bogus` is not a project field: it must be neither shown nor saved.
                  extra: { start_date: '2021', end_date: '2022', bogus: 'HIDDEN-VALUE' },
                },
              ],
            },
          }
        : undefined
    const user = userEvent.setup()
    render(<AskAIDrawer jobId={1} />)
    await user.click(screen.getByRole('button', { name: /ask ai/i }))
    await user.type(screen.getByPlaceholderText(/describe what you did/i), 'I built a ledger app')
    await user.click(screen.getByRole('button', { name: /send/i }))
    const box = (await screen.findByText('Ledger app')).closest('[data-proposal]') as HTMLElement
    expect(box).toHaveTextContent('Project')
    expect(box).toHaveTextContent('Built a ledger.')
    expect(box).toHaveTextContent('Rust')
    expect(box).toHaveTextContent(/start date\s*2021/i)
    expect(box).toHaveTextContent(/end date\s*2022/i)
    expect(screen.queryByText(/HIDDEN-VALUE/)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^add$/i }))
    const post = server.calls.find((c) => c.method === 'POST' && c.path === '/api/cards')!
    expect(post.body).toEqual({
      job_id: 1,
      kind: 'project',
      title: 'Ledger app',
      description: 'Built a ledger.',
      details: '',
      tags: ['Rust'],
      extra: { start_date: '2021', end_date: '2022' },
    })
  })

  describe('choosing where a gap card belongs', () => {
    const jobs = [
      { id: 7, company: 'Acme', title: 'SRE', location: '', employment_type: '', start_date: '', end_date: '', manager_contact: '', reason_for_leaving: '' },
    ]
    const k8s = {
      reply: 'ok',
      followups: [],
      proposals: [{ kind: 'accomplishment', title: 'Operated a Kubernetes cluster', description: 'Ran it.', tags: [] }],
    }

    async function open() {
      const server = installFakeApi({ jobs })
      server.override = ({ path }) => (path === '/api/ai/propose' ? { body: k8s } : undefined)
      const user = userEvent.setup()
      render(<AskAIDrawer jobId={null} chooseJob label="Ask AI about it" initialMessage="Kubernetes?" />)
      await user.click(screen.getByRole('button', { name: 'Ask AI about it' }))
      const select = (await screen.findByLabelText(/belong to/i)) as HTMLSelectElement
      await screen.findByRole('option', { name: /SRE at Acme/ })
      return { server, user, select }
    }

    it('defaults to no job, and a job-less accomplishment cannot be added as is', async () => {
      const { server, user, select } = await open()
      expect(select.value).toBe('')
      await user.click(screen.getByRole('button', { name: /send/i }))
      await screen.findByText('Operated a Kubernetes cluster')
      expect(screen.getByRole('button', { name: /^add$/i })).toBeDisabled()
      expect(screen.getByText(/accomplishment must belong to a job/i)).toBeInTheDocument()

      // The Edit form offers every kind a job-less card may have, and not accomplishment.
      await user.click(screen.getByRole('button', { name: /^edit$/i }))
      const kinds = Array.from((screen.getByLabelText(/kind/i) as HTMLSelectElement).options).map((o) => o.value)
      expect(kinds).toEqual(expect.arrayContaining(['project', 'education', 'skill', 'certificate', 'behavioral']))
      await user.click(screen.getByRole('button', { name: /^save$/i }))
      expect(server.calls.some((c) => c.method === 'POST' && c.path === '/api/cards')).toBe(false)
      await user.selectOptions(screen.getByLabelText(/kind/i), 'project')
      await user.click(screen.getByRole('button', { name: /^save$/i }))
      const post = server.calls.find((c) => c.method === 'POST' && c.path === '/api/cards')!
      expect(post.body).toMatchObject({ job_id: null, kind: 'project', title: 'Operated a Kubernetes cluster' })
    })

    it('picking a job saves the card under that job', async () => {
      const { server, user, select } = await open()
      await user.selectOptions(select, '7')
      await user.click(screen.getByRole('button', { name: /send/i }))
      await screen.findByText('Operated a Kubernetes cluster')
      expect(server.calls.find((c) => c.path === '/api/ai/propose')?.body.job_id).toBe(7)
      await user.click(screen.getByRole('button', { name: /^add$/i }))
      const post = server.calls.find((c) => c.method === 'POST' && c.path === '/api/cards')!
      expect(post.body).toMatchObject({ job_id: 7, kind: 'accomplishment' })
    })
  })
})
