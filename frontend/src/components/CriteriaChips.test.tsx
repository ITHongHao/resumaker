import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import CriteriaChips from './CriteriaChips'

const matches = [
  { term: 'Python', status: 'matched' as const },
  { term: 'PyTorch', status: 'partial' as const },
  { term: 'MLOps', status: 'missing' as const },
]

describe('CriteriaChips', () => {
  it('shows each requirement with its status', () => {
    render(<CriteriaChips matches={matches} selected={null} onSelect={() => {}} />)
    expect(screen.getByRole('button', { name: 'Python: matched' })).toHaveTextContent('✓ Python')
    expect(screen.getByRole('button', { name: 'PyTorch: partial' })).toHaveTextContent('◐ PyTorch')
    expect(screen.getByRole('button', { name: 'MLOps: missing' })).toHaveTextContent('✕ MLOps')
  })

  it('selecting a chip reports its term and toggles off', async () => {
    const onSelect = vi.fn()
    const { rerender } = render(<CriteriaChips matches={matches} selected={null} onSelect={onSelect} />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /pytorch/i }))
    expect(onSelect).toHaveBeenLastCalledWith('PyTorch')
    rerender(<CriteriaChips matches={matches} selected="PyTorch" onSelect={onSelect} />)
    expect(screen.getByRole('button', { name: /pytorch/i })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: /pytorch/i }))
    expect(onSelect).toHaveBeenLastCalledWith(null)
  })
})
