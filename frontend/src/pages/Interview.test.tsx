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

const calls = (s: ReturnType<typeof installFakeApi>, method: string, re: RegExp) =>
  s.calls.filter((c) => c.method === method && re.test(c.path))

function defer(server: ReturnType<typeof installFakeApi>, method: string, path: string) {
  let release!: () => void
  const gate = new Promise<void>((r) => (release = r))
  server.override = (req) => (req.method === method && req.path === path ? gate.then(() => undefined) : undefined)
  return () => release()
}

async function addQuestion(user: ReturnType<typeof userEvent.setup>, text: string) {
  await user.click(screen.getByRole('button', { name: /add my own question/i }))
  await user.type(screen.getByLabelText('Question'), text)
  await user.click(screen.getByRole('button', { name: /save question/i }))
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
    const { server, user } = await setup()
    await addQuestion(user, 'Why us?')
    expect(await screen.findByRole('button', { name: 'Why us?' })).toBeInTheDocument()
    const c = calls(server, 'POST', /^\/api\/interview\/questions$/)
    expect(c).toHaveLength(1)
    expect(c[0].body).toMatchObject({ text: 'Why us?' })
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
    server.draft = { situation: 'S draft', task: 'T draft', action: 'A draft', result: 'R draft', source_card_ids: [5] }
    await user.click(screen.getByRole('button', { name: Q1 }))
    await user.click(await screen.findByRole('button', { name: 'Draft an answer' }))
    expect(await screen.findByText(/suggested draft, not saved until you accept/i)).toBeInTheDocument()
    expect(screen.getByText('S draft')).toBeInTheDocument()
    expect(posts(server)).toHaveLength(0)
    await user.click(screen.getByRole('button', { name: 'Accept' }))
    expect(await screen.findByRole('article')).toHaveTextContent('A draft')
    expect(posts(server)).toHaveLength(1)
    expect(posts(server)[0].body).toMatchObject({ question_ref: 'b:lead-project', situation: 'S draft', task: 'T draft', action: 'A draft', result: 'R draft', source_card_ids: [5] })
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

  it('hides a question into a collapsed Hidden group and unhides it', async () => {
    const { server, user } = await setup()
    await user.click(screen.getByRole('button', { name: Q1 }))
    await user.click(await screen.findByRole('button', { name: 'Hide question' }))
    await vi.waitFor(() => expect(screen.queryByRole('button', { name: Q1 })).not.toBeInTheDocument())
    const put = calls(server, 'PUT', /hidden$/)
    expect(put).toHaveLength(1)
    expect(put[0].path).toBe('/api/interview/questions/b%3Alead-project/hidden')
    expect(put[0].body).toEqual({ hidden: true })
    const toggle = screen.getByRole('button', { name: /hidden \(1\)/i })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText(Q1)).not.toBeInTheDocument()
    await user.click(toggle)
    expect(screen.getByText(Q1)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: `Unhide ${Q1}` }))
    expect(await screen.findByRole('button', { name: Q1 })).toBeInTheDocument()
    const put2 = calls(server, 'PUT', /hidden$/)
    expect(put2).toHaveLength(2)
    expect(put2[1].body).toEqual({ hidden: false })
  })

  it('confirms before deleting an answer', async () => {
    const { server, user } = await setup()
    await user.click(screen.getByRole('button', { name: Q1 }))
    await fillAnswer(user, 'one')
    await screen.findByText('Situation one')
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    await user.click(screen.getByRole('button', { name: 'Delete answer 1' }))
    expect(server.answers).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: 'Delete answer 1' }))
    await vi.waitFor(() => expect(screen.queryByRole('article')).not.toBeInTheDocument())
    expect(confirm).toHaveBeenCalledTimes(2)
    expect(server.answers).toHaveLength(0)
    const del = calls(server, 'DELETE', /^\/api\/interview\/answers\/\d+$/)
    expect(del).toHaveLength(1)
  })

  it('confirms before deleting a custom question; built-ins have no delete', async () => {
    const { server, user } = await setup()
    await user.click(screen.getByRole('button', { name: Q1 }))
    expect(screen.queryByRole('button', { name: 'Delete question' })).not.toBeInTheDocument()
    await addQuestion(user, 'Why us?')
    await user.click(await screen.findByRole('button', { name: 'Why us?' }))
    vi.spyOn(window, 'confirm').mockReturnValueOnce(true)
    await user.click(await screen.findByRole('button', { name: 'Delete question' }))
    await vi.waitFor(() => expect(screen.queryByRole('button', { name: 'Why us?' })).not.toBeInTheDocument())
    expect(server.questions.some((q) => q.text === 'Why us?')).toBe(false)
    expect(calls(server, 'DELETE', /^\/api\/interview\/questions\/\d+$/)).toHaveLength(1)
  })

  it('edits a custom question', async () => {
    const { server, user } = await setup()
    await addQuestion(user, 'Why us?')
    await user.click(await screen.findByRole('button', { name: 'Why us?' }))
    await user.click(await screen.findByRole('button', { name: 'Edit question' }))
    const f = screen.getByLabelText('Question')
    await user.clear(f)
    await user.type(f, 'Why you?')
    await user.click(screen.getByRole('button', { name: /save question/i }))
    expect(await screen.findByRole('button', { name: 'Why you?' })).toBeInTheDocument()
    const c = calls(server, 'PATCH', /^\/api\/interview\/questions\/\d+$/)
    expect(c).toHaveLength(1)
    expect(c[0].body).toEqual({ text: 'Why you?' })
  })

  it('edits an answer', async () => {
    const { server, user } = await setup()
    await user.click(screen.getByRole('button', { name: Q1 }))
    await fillAnswer(user, 'one')
    await screen.findByText('Situation one')
    await user.click(screen.getByRole('button', { name: 'Edit answer 1' }))
    const f = screen.getByLabelText('Result')
    await user.clear(f)
    await user.type(f, 'New result')
    await user.click(screen.getByRole('button', { name: /save answer/i }))
    expect(await screen.findByText('New result')).toBeInTheDocument()
    const c = calls(server, 'PATCH', /^\/api\/interview\/answers\/\d+$/)
    expect(c).toHaveLength(1)
    expect(c[0].body).toEqual({ situation: 'Situation one', task: 'Task one', action: 'Action one', result: 'New result' })
  })

  it('renders built-from sources and "source removed"', async () => {
    const { server, user } = await setup()
    server.answers.push({ id: 1, question_ref: 'b:lead-project', situation: 's', task: 't', action: 'a', result: 'r', source_card_ids: [5, 99], job_id: null })
    await user.click(screen.getByRole('button', { name: Q1 }))
    const card = await screen.findByRole('article')
    expect(card).toHaveTextContent('Cache rewrite')
    expect(card).toHaveTextContent('source removed')
  })

  it("shows an answer's job", async () => {
    const { server, user } = await setup()
    server.jobs.push({ id: 3, company: 'Acme', title: 'SRE', location: '', employment_type: '', start_date: '', end_date: '', manager_contact: '', reason_for_leaving: '', extra: {} })
    server.answers.push({ id: 1, question_ref: 'b:lead-project', situation: 's', task: 't', action: 'a', result: 'r', source_card_ids: [], job_id: 3 })
    await user.click(screen.getByRole('button', { name: Q1 }))
    const card = await screen.findByRole('article')
    expect(await within(card).findByText(/SRE, Acme/)).toBeInTheDocument()
  })

  it('shows answered state per question', async () => {
    const { user } = await setup()
    expect(screen.getAllByText('No answer yet')).toHaveLength(2)
    await user.click(screen.getByRole('button', { name: Q1 }))
    expect(await screen.findByText('No answers yet')).toBeInTheDocument()
    await fillAnswer(user, 'one')
    expect(await screen.findByText(/answered.*1 answer/i)).toBeInTheDocument()
    expect(screen.getAllByText('No answer yet')).toHaveLength(1)
    expect(screen.getByRole('button', { name: Q1 })).toHaveAttribute('aria-current', 'true')
  })

  it('the Mine chip filters to custom questions and empty categories say so', async () => {
    const { user } = await setup()
    await addQuestion(user, 'Why us?')
    await screen.findByRole('button', { name: 'Why us?' })
    await user.click(screen.getByRole('button', { name: 'Mine' }))
    expect(screen.getByRole('button', { name: 'Why us?' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: Q1 })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Initiative' }))
    expect(screen.getByText('No questions in this category')).toBeInTheDocument()
  })

  it('adding a question while a category filter hides it switches to All', async () => {
    const { user } = await setup()
    await user.click(screen.getByRole('button', { name: 'Leadership' }))
    await addQuestion(user, 'Why us?')
    expect(await screen.findByRole('button', { name: 'Why us?' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: Q2 })).toBeInTheDocument()
  })

  it('discards a draft that arrives after switching questions', async () => {
    const { server, user } = await setup()
    const release = defer(server, 'POST', '/api/interview/draft')
    await user.click(screen.getByRole('button', { name: Q1 }))
    await user.click(await screen.findByRole('button', { name: 'Draft an answer' }))
    expect(screen.getByText(/drafting/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: Q2 }))
    expect(await screen.findByRole('button', { name: 'Draft an answer' })).toBeEnabled()
    release()
    await new Promise((r) => setTimeout(r, 20))
    expect(screen.queryByText(/suggested draft/i)).not.toBeInTheDocument()
    expect(screen.queryByText('S draft')).not.toBeInTheDocument()
    expect(posts(server)).toHaveLength(0)
  })

  it('Accept saves against the question the draft was made for, once, even on double click', async () => {
    const { server, user } = await setup()
    await user.click(screen.getByRole('button', { name: Q1 }))
    await user.click(await screen.findByRole('button', { name: 'Draft an answer' }))
    await screen.findByText('S draft')
    const release = defer(server, 'POST', '/api/interview/answers')
    await user.dblClick(screen.getByRole('button', { name: 'Accept' }))
    release()
    await screen.findByRole('article')
    expect(posts(server)).toHaveLength(1)
    expect(posts(server)[0].body.question_ref).toBe('b:lead-project')
  })

  it('Save answer sends exactly one request on double click', async () => {
    const { server, user } = await setup()
    await user.click(screen.getByRole('button', { name: Q1 }))
    await user.click(screen.getByRole('button', { name: /add an answer/i }))
    for (const l of ['Situation', 'Task', 'Action', 'Result']) await user.type(screen.getByLabelText(l), l)
    const release = defer(server, 'POST', '/api/interview/answers')
    await user.dblClick(screen.getByRole('button', { name: /save answer/i }))
    release()
    await screen.findByRole('article')
    expect(posts(server)).toHaveLength(1)
  })

  it('Save question sends exactly one request on double click and on double Enter', async () => {
    const { server, user } = await setup()
    await user.click(screen.getByRole('button', { name: /add my own question/i }))
    await user.type(screen.getByLabelText('Question'), 'Why us?')
    const release = defer(server, 'POST', '/api/interview/questions')
    await user.dblClick(screen.getByRole('button', { name: /save question/i }))
    await user.type(screen.getByLabelText('Question'), '{Enter}{Enter}')
    release()
    await screen.findByRole('button', { name: 'Why us?' })
    expect(calls(server, 'POST', /questions$/)).toHaveLength(1)
  })

  it('a failed answer edit keeps the editor open with the text and shows the error', async () => {
    const { server, user } = await setup()
    await user.click(screen.getByRole('button', { name: Q1 }))
    await fillAnswer(user, 'one')
    await screen.findByText('Situation one')
    await user.click(screen.getByRole('button', { name: 'Edit answer 1' }))
    server.override = ({ method }) => (method === 'PATCH' ? { status: 500, body: { detail: 'boom' } } : undefined)
    const f = screen.getByLabelText('Result')
    await user.clear(f)
    await user.type(f, 'Typed result')
    await user.click(screen.getByRole('button', { name: /save answer/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent('boom')
    expect(screen.getByLabelText('Result')).toHaveValue('Typed result')
  })

  it('a failed question edit keeps the editor open with the text and shows the error', async () => {
    const { server, user } = await setup()
    await addQuestion(user, 'Why us?')
    await user.click(await screen.findByRole('button', { name: 'Why us?' }))
    await user.click(await screen.findByRole('button', { name: 'Edit question' }))
    server.override = ({ method }) => (method === 'PATCH' ? { status: 500, body: { detail: 'boom' } } : undefined)
    const f = screen.getByLabelText('Question')
    await user.clear(f)
    await user.type(f, 'Typed q')
    await user.click(screen.getByRole('button', { name: /save question/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent('boom')
    expect(screen.getByLabelText('Question')).toHaveValue('Typed q')
  })

  it('nav has an Interview link', () => {
    installFakeApi()
    render(<MemoryRouter><App /></MemoryRouter>)
    expect(screen.getByRole('link', { name: 'Interview' })).toHaveAttribute('href', '/interview')
  })
})
