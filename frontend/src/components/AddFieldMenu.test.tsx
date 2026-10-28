import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import AddFieldMenu from './AddFieldMenu'

const available = [
  { key: 'minor', label: 'Minor', type: 'text' as const, default: false, printed: false },
  { key: 'notes', label: 'Notes', type: 'text' as const, default: false, printed: false },
]

describe('AddFieldMenu', () => {
  it('lists the available labels once opened and reports the pick', async () => {
    const onPick = vi.fn()
    const user = userEvent.setup()
    render(<AddFieldMenu available={available} onPick={onPick} />)
    expect(screen.queryByRole('menuitem')).toBeNull()
    await user.click(screen.getByRole('button', { name: /add field/i }))
    expect(screen.getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Minor', 'Notes'])
    await user.click(screen.getByRole('menuitem', { name: 'Minor' }))
    expect(onPick).toHaveBeenCalledWith('minor')
    expect(screen.queryByRole('menuitem')).toBeNull()
  })

  it('renders nothing when every field is already shown', () => {
    render(<AddFieldMenu available={[]} onPick={() => {}} />)
    expect(screen.queryByRole('button', { name: /add field/i })).toBeNull()
  })
})
