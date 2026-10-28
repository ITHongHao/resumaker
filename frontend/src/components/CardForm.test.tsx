import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => vi.unstubAllGlobals())

import CardForm from './CardForm'
import CardSection from './CardSection'
import { installFakeApi } from '@/test/fakeApi'

describe('CardForm', () => {
  it('refuses a job-less accomplishment with a readable message', async () => {
    const onSave = vi.fn()
    const user = userEvent.setup()
    render(
      <CardForm
        jobless
        initial={{ kind: 'accomplishment', title: 'Operated a Kubernetes cluster', description: '', tags: [] }}
        kinds={['project', 'education', 'skill', 'certificate', 'behavioral']}
        onSave={onSave}
        onCancel={() => {}}
      />,
    )
    // The current kind is shown even though it is not one of the offered kinds.
    expect(screen.getByLabelText(/kind/i)).toHaveValue('accomplishment')
    await user.click(screen.getByRole('button', { name: /^save$/i }))
    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent(/accomplishment must belong to a job/i)

    await user.selectOptions(screen.getByLabelText(/kind/i), 'project')
    await user.click(screen.getByRole('button', { name: /^save$/i }))
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ kind: 'project', title: 'Operated a Kubernetes cluster' }))
  })

  it('offers no date fields for a project under a job (they would never print)', () => {
    render(<CardForm kinds={['project', 'accomplishment']} onSave={() => {}} onCancel={() => {}} />)
    expect(screen.queryByLabelText(/^start date$/i)).toBeNull()
    expect(screen.getByLabelText(/^details/i)).toBeInTheDocument()
  })

  it('allows an accomplishment under a job', async () => {
    const onSave = vi.fn()
    const user = userEvent.setup()
    render(<CardForm kinds={['project', 'accomplishment']} onSave={onSave} onCancel={() => {}} />)
    await user.selectOptions(screen.getByLabelText(/kind/i), 'accomplishment')
    await user.type(screen.getByLabelText(/title/i), 'Cut costs')
    await user.click(screen.getByRole('button', { name: /^save$/i }))
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ kind: 'accomplishment' }))
  })

  it.each([
    ['education', ['Location', 'Start date', 'End date']],
    ['project', ['Start date', 'End date']],
    ['skill', ['Category']],
    ['certificate', ['Date']],
    ['accomplishment', []],
    ['behavioral', []],
  ] as const)('shows the %s fields and a details box', (kind, labels) => {
    render(<CardForm jobless kinds={[kind]} onSave={() => {}} onCancel={() => {}} />)
    for (const l of ['Location', 'Start date', 'End date', 'Category', 'Date']) {
      const want = (labels as readonly string[]).includes(l)
      expect(screen.queryByLabelText(new RegExp(`^${l}$`, 'i')) !== null).toBe(want)
    }
    expect(screen.getByLabelText(/^details/i)).toBeInTheDocument()
    expect(screen.getByText(/more detail than ever appears on the resume/i)).toBeInTheDocument()
  })

  it('sends the per-kind fields and details, and only the current kind\'s fields', async () => {
    const onSave = vi.fn()
    const user = userEvent.setup()
    render(<CardForm jobless kinds={['education', 'project']} onSave={onSave} onCancel={() => {}} />)
    await user.type(screen.getByLabelText(/^title$/i), 'State University')
    await user.type(screen.getByLabelText(/^description$/i), 'BSc Computer Science')
    await user.type(screen.getByLabelText(/^location$/i), 'Springfield')
    await user.type(screen.getByLabelText(/^start date$/i), '2016')
    await user.type(screen.getByLabelText(/^end date$/i), '2020')
    await user.type(screen.getByLabelText(/^details/i), 'Thesis on schedulers')
    await user.click(screen.getByRole('button', { name: /^save$/i }))
    expect(onSave).toHaveBeenLastCalledWith({
      kind: 'education',
      title: 'State University',
      description: 'BSc Computer Science',
      details: 'Thesis on schedulers',
      tags: [],
      extra: { location: 'Springfield', start_date: '2016', end_date: '2020' },
    })
    // Switching to project keeps the dates it shares and drops the location.
    await user.selectOptions(screen.getByLabelText(/kind/i), 'project')
    expect(screen.queryByLabelText(/^location$/i)).toBeNull()
    await user.click(screen.getByRole('button', { name: /^save$/i }))
    expect(onSave.mock.lastCall?.[0].extra).toEqual({ start_date: '2016', end_date: '2020' })
  })

  it('prefills every field when editing, and keeps unknown extra keys', async () => {
    const onSave = vi.fn()
    const user = userEvent.setup()
    render(
      <CardForm
        kinds={['skill']}
        initial={{ kind: 'skill', title: 'Python', description: '', details: 'Since 2012', tags: ['lang'], extra: { category: 'Languages', imported_note: 'x' } }}
        onSave={onSave}
        onCancel={() => {}}
      />,
    )
    expect(screen.getByLabelText(/^category$/i)).toHaveValue('Languages')
    expect(screen.getByLabelText(/^details/i)).toHaveValue('Since 2012')
    await user.clear(screen.getByLabelText(/^category$/i))
    await user.type(screen.getByLabelText(/^category$/i), 'Programming')
    await user.click(screen.getByRole('button', { name: /^save$/i }))
    expect(onSave.mock.lastCall?.[0]).toMatchObject({ details: 'Since 2012', extra: { category: 'Programming', imported_note: 'x' } })
  })

  it('round-trips through create, the card view and edit', async () => {
    const server = installFakeApi()
    const user = userEvent.setup()
    const { rerender } = render(<CardSection jobId={null} cards={[]} kinds={['certificate']} addLabel="Add certificate" onChanged={() => {}} />)
    await user.click(screen.getByRole('button', { name: /add certificate/i }))
    await user.type(screen.getByLabelText(/^title$/i), 'AWS Solutions Architect')
    await user.type(screen.getByLabelText(/^date$/i), 'Mar 2023')
    await user.type(screen.getByLabelText(/^details/i), 'Associate level')
    await user.click(screen.getByRole('button', { name: /^save$/i }))
    const post = server.calls.find((c) => c.method === 'POST' && c.path === '/api/cards')!
    expect(post.body).toMatchObject({ job_id: null, kind: 'certificate', details: 'Associate level', extra: { date: 'Mar 2023' } })

    rerender(<CardSection jobId={null} cards={server.cards} kinds={['certificate']} addLabel="Add certificate" onChanged={() => {}} />)
    expect(screen.getByText('Mar 2023')).toBeInTheDocument()
    expect(screen.getByText('Associate level')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /edit aws/i }))
    expect(screen.getByLabelText(/^date$/i)).toHaveValue('Mar 2023')
    expect(screen.getByLabelText(/^details/i)).toHaveValue('Associate level')
  })

  it('deleting a card asks first, and Cancel keeps it', async () => {
    const card = { id: 9, job_id: null, kind: 'skill' as const, title: 'Python', description: '', details: '', tags: [], extra: {} }
    const server = installFakeApi({ cards: [card] })
    const onChanged = vi.fn()
    const user = userEvent.setup()
    render(<CardSection jobId={null} cards={[card]} kinds={['skill']} addLabel="Add skill" onChanged={onChanged} />)
    const confirm = vi.fn(() => false)
    vi.stubGlobal('confirm', confirm)
    await user.click(screen.getByRole('button', { name: /delete python/i }))
    expect(confirm).toHaveBeenCalledWith(expect.stringMatching(/delete "Python"/i))
    expect(server.calls.some((c) => c.method === 'DELETE')).toBe(false)
    confirm.mockReturnValue(true)
    await user.click(screen.getByRole('button', { name: /delete python/i }))
    expect(server.calls.filter((c) => c.method === 'DELETE' && c.path === '/api/cards/9')).toHaveLength(1)
    expect(onChanged).toHaveBeenCalled()
  })
})
