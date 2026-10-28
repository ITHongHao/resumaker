import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import Profile from './Profile'
import { installFakeApi } from '@/test/fakeApi'

afterEach(() => vi.unstubAllGlobals())

const doc = {
  schema_version: 1,
  jobs: [{ id: 1, company: 'A', title: 'T' }, { id: 2, company: 'B', title: 'U' }],
  cards: [{ id: 1, job_id: 1, kind: 'project', title: 'x' }, { id: 2, job_id: null, kind: 'skill', title: 'y' }, { id: 3, job_id: null, kind: 'skill', title: 'z' }],
  profile: { name: 'N', email: '', phone: '', links: [], work_authorization: '' },
}
const importCalls = (s: ReturnType<typeof installFakeApi>) =>
  s.calls.filter((c) => c.method === 'POST' && c.path === '/api/import')

async function pick(content: string) {
  const server = installFakeApi()
  const user = userEvent.setup()
  render(<Profile />)
  await screen.findByLabelText('Name')
  const input = screen.getByLabelText(/import json file/i) as HTMLInputElement
  await user.upload(input, new File([content], 'backup.json', { type: 'application/json' }))
  return { server, user, input }
}

describe('Profile import', () => {
  it('shows a confirm with counts and makes no import call on file choice', async () => {
    const { server } = await pick(JSON.stringify(doc))
    const panel = await screen.findByRole('alertdialog')
    expect(panel).toHaveTextContent(/replace all current jobs, cards and your profile/i)
    expect(panel).toHaveTextContent('2 jobs, 3 cards')
    expect(panel).toHaveTextContent(/cannot be undone/i)
    expect(screen.getByRole('button', { name: /export current data first/i })).toBeInTheDocument()
    expect(importCalls(server)).toHaveLength(0)
  })

  it('Cancel makes no import call and clears the chosen file', async () => {
    const { server, user, input } = await pick(JSON.stringify(doc))
    await user.click(await screen.findByRole('button', { name: /^cancel$/i }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(importCalls(server)).toHaveLength(0)
    expect(input.value).toBe('')
    await user.upload(input, new File([JSON.stringify(doc)], 'backup.json', { type: 'application/json' }))
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument()
  })

  it('Confirm makes exactly one import call with the file contents', async () => {
    const { server, user } = await pick(JSON.stringify(doc))
    server.override = ({ method, path }) =>
      method === 'POST' && path === '/api/import' ? { body: { jobs: 2, cards: 3 } } : undefined
    await user.click(await screen.findByRole('button', { name: /^confirm/i }))
    expect(await screen.findByText(/imported 2 jobs and 3 cards/i)).toBeInTheDocument()
    const calls = importCalls(server)
    expect(calls).toHaveLength(1)
    expect(calls[0].body).toEqual(doc)
  })

  it('shows an error and makes no request for an unparseable file', async () => {
    const { server } = await pick('not json {')
    expect(await screen.findByRole('alert')).toHaveTextContent(/not valid json/i)
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(server.calls.some((c) => c.path === '/api/import')).toBe(false)
  })

  it('rejects a wrong or missing schema_version before the confirm', async () => {
    const { server } = await pick(JSON.stringify({ ...doc, schema_version: 7 }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/schema_version/i)
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(server.calls.some((c) => c.path === '/api/import')).toBe(false)
  })

  it('shows a readable error on a failed import and leaves the page unchanged', async () => {
    const { server, user } = await pick(JSON.stringify(doc))
    server.override = ({ method, path }) =>
      method === 'POST' && path === '/api/import'
        ? { status: 422, body: { detail: 'cards reference unknown job ids: [9]' } }
        : undefined
    await user.type(screen.getByLabelText('Name'), 'Edited')
    await user.click(await screen.findByRole('button', { name: /^confirm/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent('cards reference unknown job ids: [9]')
    expect(screen.getByLabelText('Name')).toHaveValue('Edited')
    expect(server.calls.filter((c) => c.method === 'GET' && c.path === '/api/profile')).toHaveLength(1)
  })
})
