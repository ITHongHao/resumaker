import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import JobForm from './JobForm'

const job = {
  id: 1, company: 'Acme', title: 'Engineer', location: '', employment_type: '',
  start_date: '2021', end_date: '', manager_contact: '', reason_for_leaving: '',
}

describe('JobForm', () => {
  it('shows only the seven default fields', () => {
    render(<JobForm onSave={vi.fn()} onCancel={vi.fn()} />)
    for (const l of ['Company', 'Job title', 'Location', 'Employment type', 'Start date', 'End date', 'Currently work here'])
      expect(screen.getByLabelText(l)).toBeInTheDocument()
    for (const l of ['Manager name', 'Manager contact', 'OK to contact', 'Salary', 'Reason for leaving'])
      expect(screen.queryByLabelText(l)).toBeNull()
  })

  it('renders yes/no fields as a select with blank, Yes and No', () => {
    render(<JobForm onSave={vi.fn()} onCancel={vi.fn()} />)
    const sel = screen.getByLabelText('Currently work here') as HTMLSelectElement
    expect(sel.tagName).toBe('SELECT')
    expect(Array.from(sel.options).map((o) => o.value)).toEqual(['', 'yes', 'no'])
    expect(Array.from(sel.options).map((o) => o.textContent)).toEqual(['', 'Yes', 'No'])
    expect((screen.getByLabelText('Employment type') as HTMLSelectElement).tagName).toBe('SELECT')
  })

  it('lists the five other fields in the Add field menu', async () => {
    const user = userEvent.setup()
    render(<JobForm onSave={vi.fn()} onCancel={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: /add field/i }))
    const items = screen.getAllByRole('menuitem').map((i) => i.textContent)
    expect(items).toEqual(['Manager name', 'Manager contact', 'OK to contact', 'Salary', 'Reason for leaving'])
  })

  it('shows a field that already has a value, including a column', () => {
    render(<JobForm initial={{ ...job, manager_contact: 'sam@acme.com', extra: { salary: '100k' } }} onSave={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByLabelText('Manager contact')).toHaveValue('sam@acme.com')
    expect(screen.getByLabelText('Salary')).toHaveValue('100k')
    expect(screen.queryByLabelText('Manager name')).toBeNull()
  })

  it('saves extra fields in extra and columns at the top level', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(<JobForm initial={{ ...job, extra: { unknown_key: 'keep' } }} onSave={onSave} onCancel={vi.fn()} />)
    await user.selectOptions(screen.getByLabelText('Currently work here'), 'Yes')
    expect(screen.getByLabelText('Currently work here')).toHaveValue('yes')
    await user.click(screen.getByRole('button', { name: /add field/i }))
    await user.click(screen.getByRole('menuitem', { name: 'Manager name' }))
    await user.type(screen.getByLabelText('Manager name'), 'Sam')
    await user.click(screen.getByRole('button', { name: /add field/i }))
    await user.click(screen.getByRole('menuitem', { name: 'Manager contact' }))
    await user.type(screen.getByLabelText('Manager contact'), 'sam@acme.com')
    await user.click(screen.getByRole('button', { name: /save job/i }))
    const sent = onSave.mock.calls[0][0]
    expect(sent.manager_contact).toBe('sam@acme.com')
    expect(sent.company).toBe('Acme')
    expect(sent.extra).toEqual({ unknown_key: 'keep', currently_here: 'yes', manager_name: 'Sam' })
    expect(sent.extra).not.toHaveProperty('manager_contact')
  })

  it('sends lowercase yes/no, the values the backend stores', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(<JobForm initial={{ ...job, extra: {} }} onSave={onSave} onCancel={vi.fn()} />)
    await user.selectOptions(screen.getByLabelText('Currently work here'), 'Yes')
    await user.click(screen.getByRole('button', { name: /save job/i }))
    expect(onSave.mock.calls[0][0].extra.currently_here).toBe('yes')
  })

  it('shows a stored yes/no value as selected, whatever its case', () => {
    render(<JobForm initial={{ ...job, extra: { currently_here: 'yes', ok_to_contact: 'No' } }} onSave={vi.fn()} onCancel={vi.fn()} />)
    const sel = screen.getByLabelText('Currently work here') as HTMLSelectElement
    expect(sel.value).toBe('yes')
    expect(sel.selectedOptions[0].textContent).toBe('Yes')
    expect(screen.getByLabelText('OK to contact')).toHaveValue('no')
  })
})
