import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import ScoreMeter from './ScoreMeter'

describe('ScoreMeter', () => {
  it('shows the score and what it becomes if all suggestions are accepted', () => {
    render(<ScoreMeter score={72} potential={91} />)
    const meter = screen.getByRole('meter', { name: /match score/i })
    expect(meter).toHaveAttribute('aria-valuenow', '72')
    expect(meter).toHaveTextContent('72')
    expect(screen.getByText('→ 91 if all accepted')).toBeInTheDocument()
  })

  it('hides the projection when nothing would change', () => {
    render(<ScoreMeter score={80} potential={80} />)
    expect(screen.queryByText(/if all accepted/)).toBeNull()
  })
})
