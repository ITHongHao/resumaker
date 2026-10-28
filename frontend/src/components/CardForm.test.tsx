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
    expect(screen.getByLabelText(/^results and numbers/i)).toBeInTheDocument()
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
    ['education', ['School', 'Degree type', 'Field of study', 'GPA', 'GPA scale', 'Start date', 'End date', 'Status', 'Location']],
    ['skill', ['Name', 'Category']],
    ['certificate', ['Name', 'Issuer', 'Issue date']],
    ['project', ['Name', 'What it did', 'Results and numbers', 'Start date', 'End date']],
  ] as const)('shows the %s default fields', (kind, labels) => {
    render(<CardForm jobless kinds={[kind]} onSave={() => {}} onCancel={() => {}} />)
    for (const l of labels) expect(screen.getByLabelText(new RegExp(`^${l}$`, 'i'))).toBeInTheDocument()
  })

  it('hides the stored-only education fields until added', async () => {
    const user = userEvent.setup()
    render(<CardForm jobless kinds={['education']} onSave={() => {}} onCancel={() => {}} />)
    for (const l of ['Minor', 'Honors and awards', 'Clubs and activities', 'Relevant coursework', 'Notes'])
      expect(screen.queryByLabelText(new RegExp(`^${l}$`, 'i'))).toBeNull()
    await user.click(screen.getByRole('button', { name: /add field/i }))
    expect(screen.getAllByRole('menuitem').map((i) => i.textContent)).toEqual([
      'Minor',
      'Honors and awards',
      'Clubs and activities',
      'Relevant coursework',
      'Notes',
    ])
  })

  it('a picked field is added, focused and saved as extra', async () => {
    const onSave = vi.fn()
    const user = userEvent.setup()
    render(<CardForm jobless kinds={['education']} onSave={onSave} onCancel={() => {}} />)
    await user.click(screen.getByRole('button', { name: /add field/i }))
    await user.click(screen.getByRole('menuitem', { name: 'Minor' }))
    const minor = screen.getByLabelText(/^minor$/i)
    expect(minor).toHaveFocus()
    await user.type(minor, 'Statistics')
    await user.click(screen.getByRole('button', { name: /^save$/i }))
    expect(onSave.mock.lastCall?.[0].extra).toEqual({ minor: 'Statistics' })
    // It no longer appears in the menu.
    await user.click(screen.getByRole('button', { name: /add field/i }))
    expect(screen.queryByRole('menuitem', { name: 'Minor' })).toBeNull()
  })

  it('shows a field that has a value without opening the menu', () => {
    render(
      <CardForm jobless kinds={['education']} initial={{ kind: 'education', title: 'MIT', extra: { minor: 'Stats' } }} onSave={() => {}} onCancel={() => {}} />,
    )
    expect(screen.getByLabelText(/^minor$/i)).toHaveValue('Stats')
  })

  it('omits empty added fields and keeps unknown imported keys', async () => {
    const onSave = vi.fn()
    const user = userEvent.setup()
    render(
      <CardForm jobless kinds={['education']} initial={{ kind: 'education', title: 'MIT', extra: { legacy: 'x' } }} onSave={onSave} onCancel={() => {}} />,
    )
    await user.click(screen.getByRole('button', { name: /add field/i }))
    await user.click(screen.getByRole('menuitem', { name: 'Notes' }))
    await user.click(screen.getByRole('button', { name: /^save$/i }))
    expect(onSave.mock.lastCall?.[0].extra).toEqual({ legacy: 'x' })
  })

  it('degree type Other reveals a text input saved as the typed value', async () => {
    const onSave = vi.fn()
    const user = userEvent.setup()
    render(<CardForm jobless kinds={['education']} onSave={onSave} onCancel={() => {}} />)
    expect(screen.queryByLabelText(/^degree type \(other\)$/i)).toBeNull()
    await user.selectOptions(screen.getByLabelText(/^degree type$/i), 'Master\'s')
    await user.click(screen.getByRole('button', { name: /^save$/i }))
    expect(onSave.mock.lastCall?.[0].extra).toEqual({ degree_type: "Master's" })
    await user.selectOptions(screen.getByLabelText(/^degree type$/i), 'Other')
    await user.type(screen.getByLabelText(/^degree type \(other\)$/i), 'Diploma')
    await user.click(screen.getByRole('button', { name: /^save$/i }))
    expect(onSave.mock.lastCall?.[0].extra).toEqual({ degree_type: 'Diploma' })
  })

  it('education Status offers Other with a text box', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(<CardForm jobless kinds={['education']} initial={{ kind: 'education', title: 'X' }} onSave={onSave} onCancel={() => {}} />)
    await user.selectOptions(screen.getByLabelText(/^status$/i), 'Other')
    await user.type(screen.getByLabelText(/^status \(other\)$/i), 'On leave')
    await user.click(screen.getByRole('button', { name: /^save$/i }))
    expect(onSave.mock.lastCall?.[0].extra).toEqual({ status: 'On leave' })
  })

  it('a stored value outside the list shows as Other', () => {
    render(
      <CardForm jobless kinds={['education']} initial={{ kind: 'education', title: 'X', extra: { degree_type: 'Diploma' } }} onSave={() => {}} onCancel={() => {}} />,
    )
    expect(screen.getByLabelText(/^degree type$/i)).toHaveValue('Other')
    expect(screen.getByLabelText(/^degree type \(other\)$/i)).toHaveValue('Diploma')
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
    await user.type(screen.getByLabelText(/^name$/i), 'AWS Solutions Architect')
    await user.type(screen.getByLabelText(/^issue date$/i), 'Mar 2023')
    await user.type(screen.getByLabelText(/^details/i), 'Associate level')
    await user.click(screen.getByRole('button', { name: /^save$/i }))
    const post = server.calls.find((c) => c.method === 'POST' && c.path === '/api/cards')!
    expect(post.body).toMatchObject({ job_id: null, kind: 'certificate', details: 'Associate level', extra: { date: 'Mar 2023' } })

    rerender(<CardSection jobId={null} cards={server.cards} kinds={['certificate']} addLabel="Add certificate" onChanged={() => {}} />)
    expect(screen.getByText('Mar 2023')).toBeInTheDocument()
    expect(screen.getByText('Associate level')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /edit aws/i }))
    expect(screen.getByLabelText(/^issue date$/i)).toHaveValue('Mar 2023')
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
