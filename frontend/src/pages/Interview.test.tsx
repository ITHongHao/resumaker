import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import Interview from './Interview'
import App from '@/App'
import { installFakeApi } from '@/test/fakeApi'

afterEach(() => vi.unstubAllGlobals())

const Q1 = 'Tell me about a time you led a project.'
const Q2 = 'Tell me about a conflict with a teammate.'
const posts = (s: ReturnType<typeof installFakeApi>) =>
  s.calls.filter((c) => c.method === 'POST' && c.path === '/api/interview/answers')

async function setup() {
  const server = installFakeApi({ cards: [{ id: 5, job_id: null, kind: 'project', title: 'Cache rewrite', description: '', tags: [], details: '', extra: {} }] })
  const user = userEvent.setup()
  render(<Interview />)
  await screen.findByRole('button', { name: Q1 })
  return { server, user }
}

async function fillAnswer(user: ReturnType<typeof userEvent.setup>, v: string) {
  await user.click(screen.getByRole('button', { name: /add an answer/i }))
  for (const l of ['Situation', 'Task', 'Action', 'Result']) await user.type(screen.getByLabelText(l), `${l} ${v}`)
  await user.click(screen.getByRole('button', { name: /save answer/i }))
}

describe('Interview', () => {
  it('lists questions and a category chip narrows them', async () => {
    const { user } = await setup()
    expect(screen.getByRole('button', { name: Q2 })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Leadership' }))
    expect(screen.getByRole('button', { name: Q1 })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: Q2 })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'All' }))
    expect(screen.getByRole('button', { name: Q2 })).toBeInTheDocument()
  })

  it('adds a custom question', async () => {
    const { user } = await setup()
    await user.click(screen.getByRole('button', { name: /add my own question/i }))
    await user.type(screen.getByLabelText('Question'), 'Why us?')
    await user.click(screen.getByRole('button', { name: /save question/i }))
    expect(await screen.findByRole('button', { name: 'Why us?' })).toBeInTheDocument()
  })

  it('adds two answers and shows STAR labels in order', async () => {
    const { user } = await setup()
    await user.click(screen.getByRole('button', { name: Q1 }))
    await fillAnswer(user, 'one')
    expect(await screen.findByText('Situation one')).toBeInTheDocument()
    await fillAnswer(user, 'two')
    expect(await screen.findByText('Situation two')).toBeInTheDocument()
    const cards = screen.getAllByRole('article')
    expect(cards).toHaveLength(2)
    const labels = within(cards[0]).getAllByTestId('star-label').map((e) => e.textContent)
    expect(labels).toEqual(['Situation', 'Task', 'Action', 'Result'])
  })

  it('Draft shows a suggestion; nothing is saved until Accept', async () => {
    const { server, user } = await setup()
    await user.click(screen.getByRole('button', { name: Q1 }))
    await user.click(await screen.findByRole('button', { name: 'Draft an answer' }))
    expect(await screen.findByText(/suggested draft, not saved until you accept/i)).toBeInTheDocument()
    expect(screen.getByText('S draft')).toBeInTheDocument()
    expect(posts(server)).toHaveLength(0)
    await user.click(screen.getByRole('button', { name: 'Accept' }))
    expect(await screen.findByRole('article')).toHaveTextContent('A draft')
    expect(posts(server)).toHaveLength(1)
    expect(posts(server)[0].body).toMatchObject({ question_ref: 'b:lead-project', situation: 'S draft', result: 'R draft', source_card_ids: [] })
    expect(screen.getByRole('button', { name: 'Draft another version' })).toBeInTheDocument()
  })

  it('Reject discards the draft with no save', async () => {
    const { server, user } = await setup()
    await user.click(screen.getByRole('button', { name: Q1 }))
    await user.click(await screen.findByRole('button', { name: 'Draft an answer' }))
    await user.click(await screen.findByRole('button', { name: 'Reject' }))
    expect(screen.queryByText('S draft')).not.toBeInTheDocument()
    expect(posts(server)).toHaveLength(0)
  })

  it('disables the draft button while loading', async () => {
    const { server, user } = await setup()
    let release!: () => void
    server.override = ({ path }) =>
      path === '/api/interview/draft'
        ? new Promise((r) => (release = () => r({ body: server.draft })))
        : undefined
    await user.click(screen.getByRole('button', { name: Q1 }))
    await user.click(await screen.findByRole('button', { name: 'Draft an answer' }))
    expect(screen.getByRole('button', { name: /draft/i })).toBeDisabled()
    release()
    expect(await screen.findByText('S draft')).toBeInTheDocument()
  })

  it('shows the 422 message from draft', async () => {
    const { server, user } = await setup()
    server.override = ({ path }) =>
      path === '/api/interview/draft' ? { status: 422, body: { detail: 'Not enough on your Record yet.' } } : undefined
    await user.click(screen.getByRole('button', { name: Q1 }))
    await user.click(await screen.findByRole('button', { name: 'Draft an answer' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Not enough on your Record yet.')
  })

  it('hides a question into Hidden and unhides it', async () => {
    const { user } = await setup()
    await user.click(screen.getByRole('button', { name: Q1 }))
    await user.click(await screen.findByRole('button', { name: 'Hide question' }))
    await vi.waitFor(() => expect(screen.queryByRole('button', { name: Q1 })).not.toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /hidden \(1\)/i }))
    expect(screen.getByText(Q1)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Unhide' }))
    expect(await screen.findByRole('button', { name: Q1 })).toBeInTheDocument()
  })

  it('confirms before deleting an answer', async () => {
    const { server, user } = await setup()
    await user.click(screen.getByRole('button', { name: Q1 }))
    await fillAnswer(user, 'one')
    await screen.findByText('Situation one')
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    await user.click(screen.getByRole('button', { name: 'Delete answer' }))
    expect(server.answers).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: 'Delete answer' }))
    await vi.waitFor(() => expect(screen.queryByRole('article')).not.toBeInTheDocument())
    expect(confirm).toHaveBeenCalledTimes(2)
    expect(server.answers).toHaveLength(0)
  })

  it('confirms before deleting a custom question; built-ins have no delete', async () => {
    const { server, user } = await setup()
    expect(screen.queryByRole('button', { name: 'Delete question' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /add my own question/i }))
    await user.type(screen.getByLabelText('Question'), 'Why us?')
    await user.click(screen.getByRole('button', { name: /save question/i }))
    await user.click(await screen.findByRole('button', { name: 'Why us?' }))
    vi.spyOn(window, 'confirm').mockReturnValueOnce(true)
    await user.click(await screen.findByRole('button', { name: 'Delete question' }))
    await vi.waitFor(() => expect(screen.queryByRole('button', { name: 'Why us?' })).not.toBeInTheDocument())
    expect(server.questions.some((q) => q.text === 'Why us?')).toBe(false)
  })

  it('edits a custom question', async () => {
    const { user } = await setup()
    await user.click(screen.getByRole('button', { name: /add my own question/i }))
    await user.type(screen.getByLabelText('Question'), 'Why us?')
    await user.click(screen.getByRole('button', { name: /save question/i }))
    await user.click(await screen.findByRole('button', { name: 'Why us?' }))
    await user.click(await screen.findByRole('button', { name: 'Edit question' }))
    const f = screen.getByLabelText('Question')
    await user.clear(f)
    await user.type(f, 'Why you?')
    await user.click(screen.getByRole('button', { name: /save question/i }))
    expect(await screen.findByRole('button', { name: 'Why you?' })).toBeInTheDocument()
  })

  it('edits an answer', async () => {
    const { user } = await setup()
    await user.click(screen.getByRole('button', { name: Q1 }))
    await fillAnswer(user, 'one')
    await screen.findByText('Situation one')
    await user.click(screen.getByRole('button', { name: 'Edit answer' }))
    const f = screen.getByLabelText('Result')
    await user.clear(f)
    await user.type(f, 'New result')
    await user.click(screen.getByRole('button', { name: /save answer/i }))
    expect(await screen.findByText('New result')).toBeInTheDocument()
  })

  it('renders built-from sources and "source removed"', async () => {
    const { server, user } = await setup()
    server.answers.push({ id: 1, question_ref: 'b:lead-project', situation: 's', task: 't', action: 'a', result: 'r', source_card_ids: [5, 99], job_id: null })
    await user.click(screen.getByRole('button', { name: Q1 }))
    const card = await screen.findByRole('article')
    expect(card).toHaveTextContent('Cache rewrite')
    expect(card).toHaveTextContent('source removed')
  })

  it('shows answered state per question', async () => {
    const { server } = await setup()
    expect(server.questions.length).toBe(2)
    expect(screen.getAllByText('No answer yet')).toHaveLength(2)
  })

  it('nav has an Interview link', () => {
    installFakeApi()
    render(<MemoryRouter><App /></MemoryRouter>)
    expect(screen.getByRole('link', { name: 'Interview' })).toHaveAttribute('href', '/interview')
  })
})
