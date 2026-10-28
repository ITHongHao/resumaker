import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import CardForm from './CardForm'

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

  it('allows an accomplishment under a job', async () => {
    const onSave = vi.fn()
    const user = userEvent.setup()
    render(<CardForm kinds={['project', 'accomplishment']} onSave={onSave} onCancel={() => {}} />)
    await user.selectOptions(screen.getByLabelText(/kind/i), 'accomplishment')
    await user.type(screen.getByLabelText(/title/i), 'Cut costs')
    await user.click(screen.getByRole('button', { name: /^save$/i }))
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ kind: 'accomplishment' }))
  })
})
