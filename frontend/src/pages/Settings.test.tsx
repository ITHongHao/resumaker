import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import Settings from './Settings'
import { installFakeApi } from '@/test/fakeApi'

afterEach(() => vi.unstubAllGlobals())

describe('Settings', () => {
  it('never displays the saved key', async () => {
    const server = installFakeApi()
    server.settings.has_key = true
    // Even if a server misbehaved and returned a key, the UI must not render it.
    server.override = ({ method, path }) =>
      method === 'GET' && path === '/api/settings'
        ? { body: { ...server.settings, api_key: 'sk-secret-123' } }
        : undefined
    const user = userEvent.setup()
    const { container } = render(<Settings />)
    expect(await screen.findByText(/key saved/i)).toBeInTheDocument()
    const input = screen.getByLabelText(/api key/i) as HTMLInputElement
    expect(input.type).toBe('password')
    expect(input.value).toBe('')
    expect(container.innerHTML).not.toContain('sk-secret-123')

    await user.type(input, 'sk-new-456')
    await user.click(screen.getByRole('button', { name: /save/i }))
    expect(await screen.findByText(/settings saved/i)).toBeInTheDocument()
    expect((screen.getByLabelText(/api key/i) as HTMLInputElement).value).toBe('')
    expect(container.innerHTML).not.toContain('sk-new-456')
    const put = server.calls.find((c) => c.method === 'PUT' && c.path === '/api/settings')!
    expect(put.body.api_key).toBe('sk-new-456')
  })

  it('omits api_key when the field is left empty', async () => {
    const server = installFakeApi()
    const user = userEvent.setup()
    render(<Settings />)
    await screen.findByText(/no key saved/i)
    await user.click(screen.getByRole('button', { name: /save/i }))
    await screen.findByText(/settings saved/i)
    const put = server.calls.find((c) => c.method === 'PUT')!
    expect('api_key' in put.body).toBe(false)
  })

  it('shows Base URL only for the custom provider and sends it', async () => {
    const server = installFakeApi()
    const user = userEvent.setup()
    render(<Settings />)
    await screen.findByText(/no key saved/i)
    expect(screen.queryByLabelText(/base url/i)).toBeNull()
    await user.selectOptions(screen.getByLabelText(/ai provider/i), 'custom')
    await user.clear(screen.getByLabelText(/^model/i))
    await user.type(screen.getByLabelText(/^model/i), 'llama3.1')
    await user.type(screen.getByLabelText(/base url/i), 'http://localhost:11434/v1')
    await user.click(screen.getByRole('button', { name: /save/i }))
    await screen.findByText(/settings saved/i)
    const put = server.calls.find((c) => c.method === 'PUT')!
    expect(put.body).toEqual({
      provider: 'custom',
      model: 'llama3.1',
      base_url: 'http://localhost:11434/v1',
    })
  })
})
