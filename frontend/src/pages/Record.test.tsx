import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import JobPage from './JobPage'
import Record from './Record'
import { installFakeApi } from '@/test/fakeApi'

const job = {
  id: 1, company: 'Acme Corp', title: 'Software Engineer', location: '', employment_type: '',
  start_date: '2021', end_date: '2024', manager_contact: '', reason_for_leaving: '',
}

afterEach(() => vi.unstubAllGlobals())

function renderJob() {
  return render(
    <MemoryRouter initialEntries={['/record/jobs/1']}>
      <Routes>
        <Route path="/record/jobs/:id" element={<JobPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('JobPage', () => {
  it('adds a card manually', async () => {
    const server = installFakeApi({ jobs: [job] })
    const user = userEvent.setup()
    renderJob()
    await user.click(await screen.findByRole('button', { name: /add project or accomplishment/i }))
    await user.type(screen.getByLabelText(/title/i), 'Churn model')
    await user.type(screen.getByLabelText(/description/i), 'Predicts churn weekly.')
    await user.type(screen.getByLabelText(/tags/i), 'ML, Airflow')
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    expect(await screen.findByText('Churn model')).toBeInTheDocument()
    expect(screen.getByText('Airflow')).toBeInTheDocument()
    const post = server.calls.find((c) => c.method === 'POST' && c.path === '/api/cards')!
    expect(post.body).toMatchObject({ job_id: 1, kind: 'project', title: 'Churn model', tags: ['ML', 'Airflow'] })
  })

  it('shows API validation errors readably and keeps the form', async () => {
    const server = installFakeApi({ jobs: [job] })
    server.override = ({ method, path }) =>
      method === 'POST' && path === '/api/cards'
        ? { status: 422, body: { detail: [{ type: 'missing', loc: ['body', 'title'], msg: 'Field required' }] } }
        : undefined
    const user = userEvent.setup()
    renderJob()
    await user.click(await screen.findByRole('button', { name: /add project or accomplishment/i }))
    await user.type(screen.getByLabelText(/title/i), 'x')
    await user.click(screen.getByRole('button', { name: /^save$/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent('title: Field required')
    expect(screen.getByLabelText(/title/i)).toHaveValue('x')
  })
})

describe('Record', () => {
  it('lists jobs and non-job sections', async () => {
    installFakeApi({
      jobs: [job],
      cards: [
        { id: 5, job_id: null, kind: 'skill', title: 'Python', description: '', details: '', tags: [], extra: {} },
      ],
    })
    render(<MemoryRouter><Record /></MemoryRouter>)
    expect(await screen.findByText(/Acme Corp/)).toBeInTheDocument()
    const skills = screen.getByRole('region', { name: /skills/i })
    expect(await within(skills).findByText('Python')).toBeInTheDocument()
    for (const n of [/employment/i, /education/i, /projects/i, /certificates/i, /behavioral/i])
      expect(screen.getByRole('region', { name: n })).toBeInTheDocument()
  })
})
