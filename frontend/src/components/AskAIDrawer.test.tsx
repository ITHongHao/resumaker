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
    expect(screen.getByLabelText(/title/i)).toHaveValue('Onboarding redesign')
    expect(screen.getByLabelText(/description/i)).toHaveValue('Redesigned onboarding in React.')
    expect(screen.getByLabelText(/tags/i)).toHaveValue('React')
    expect(server.calls.some((c) => c.method === 'POST' && c.path === '/api/cards')).toBe(false)

    await user.clear(screen.getByLabelText(/title/i))
    await user.type(screen.getByLabelText(/title/i), 'Onboarding v2')
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
})
