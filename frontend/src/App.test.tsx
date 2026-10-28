import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import App from './App'

describe('App', () => {
  it('renders the nav', () => {
    render(<MemoryRouter><App /></MemoryRouter>)
    expect(screen.getByText(/resumaker/i)).toBeInTheDocument()
    for (const n of ['Resumes', 'Record', 'Interview', 'Profile', 'Settings'])
      expect(screen.getByRole('link', { name: n })).toBeInTheDocument()
  })
})
