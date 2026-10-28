import { execFileSync } from 'node:child_process'
import { expect, test, type Page } from '@playwright/test'

function hasTectonic(): boolean {
  try {
    execFileSync('tectonic', ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}
const TECTONIC = hasTectonic()

const POSTING = `Title: Backend Engineer
Company: Acme Robotics
Required: Python
Required: Docker
Experience with React is expected
Kubernetes is a must
Nice to have: SQL`

async function addCard(page: Page, addLabel: string, title: string, description: string, kind?: string) {
  await page.getByRole('button', { name: addLabel }).click()
  if (kind) await page.getByLabel('Kind').selectOption(kind)
  await page.getByLabel('Title').fill(title)
  await page.getByLabel('Description').fill(description)
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByText(title, { exact: true })).toBeVisible()
}

const meter = (page: Page) => page.getByRole('meter', { name: 'Match score' })
const scoreOf = async (page: Page) => Number(await meter(page).getAttribute('aria-valuenow'))
const projection = (page: Page) => page.getByText(/→ \d+ if all accepted/)

test.describe.configure({ mode: 'serial' })
let exportUrl = ''

test('record -> posting -> auto cater -> editor -> save -> stale', async ({ page }) => {
  const aiCalls: string[] = []
  const track = (on: boolean) => {
    const handler = (r: { url(): string; method(): string }) => {
      const u = new URL(r.url())
      if (u.pathname.startsWith('/api/ai/') || (r.method() === 'POST' && /^\/api\/(postings|applications)\/?$/.test(u.pathname)))
        aiCalls.push(`${r.method()} ${u.pathname}`)
    }
    if (on) page.on('request', handler)
    return handler
  }
  track(true)

  // --- Record: a job and cards, by hand --------------------------------------------------
  await page.goto('/record')
  await page.getByRole('button', { name: '+ Add job' }).click()
  await page.getByLabel('Company').fill('Acme')
  await page.getByLabel('Job title').fill('Backend Engineer')
  await page.getByLabel('Start date').fill('2022')
  await page.getByRole('button', { name: 'Save job' }).click()
  await page.getByRole('link', { name: /Backend Engineer/ }).click()
  await expect(page.getByRole('heading', { name: 'Backend Engineer' })).toBeVisible()

  await addCard(page, '+ Add project or accomplishment', 'Billing service',
    'Built a Python API with Docker for invoices.', 'accomplishment')
  await addCard(page, '+ Add project or accomplishment', 'Reporting pipeline',
    'Wrote a SQL pipeline for weekly reports.', 'accomplishment')

  // --- Ask AI: a proposal is not saved until Add is clicked ------------------------------
  const cardTitles = async () => (await (await page.request.get('/api/cards')).json()).map((c: { title: string }) => c.title)
  const proposeBefore = aiCalls.filter((c) => c.includes('/api/ai/propose')).length
  await page.getByRole('button', { name: '✦ Ask AI' }).click()
  await page.getByPlaceholder('Describe what you did...').fill('Mentored new engineers through their first month')
  await page.getByRole('button', { name: 'Send' }).click()
  await expect(page.getByText('Suggested addition')).toBeVisible()
  expect(aiCalls.filter((c) => c.includes('/api/ai/propose')).length).toBe(proposeBefore + 1)
  expect(await cardTitles()).not.toContain('Mentored new engineers through their first')
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(page.getByText('Suggested addition')).toHaveCount(0)
  await expect.poll(cardTitles).toContain('Mentored new engineers through their first')
  await page.getByRole('button', { name: 'Close' }).click()
  await page.getByRole('button', { name: 'Delete Mentored new engineers through their first' }).click()
  await expect.poll(cardTitles).not.toContain('Mentored new engineers through their first')

  // A standalone project in the Record
  await page.goto('/record')
  const projects = page.getByRole('region', { name: 'Projects' })
  await projects.getByRole('button', { name: '+ Add project' }).click()
  await page.getByLabel('Title').fill('Dashboard')
  await page.getByLabel('Description').fill('Wrote a React dashboard for ops.')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(projects.getByText('Dashboard', { exact: true })).toBeVisible()

  // --- New application: paste, read, auto cater ------------------------------------------
  await page.goto('/resumes/new')
  await page.getByLabel('Posting text').fill(POSTING)
  await page.getByRole('button', { name: 'Read posting' }).click()
  await expect(page.getByText('Posting read')).toBeVisible()
  await expect(page.getByText('Found 5 requirements:')).toBeVisible()
  await page.getByRole('button', { name: '✦ Auto cater' }).click()
  await expect(page).toHaveURL(/\/applications\/\d+$/)
  const appUrl = page.url()

  // --- Editor ----------------------------------------------------------------------------
  await expect(meter(page)).toBeVisible()
  await expect(page.getByText('Version 1 saved')).toBeVisible()
  await expect(page.getByText('"Kubernetes" is in the posting but nothing in your Record mentions it.')).toBeVisible()
  const start = await scoreOf(page)
  expect(start).toBe(0)

  // Typing never reaches an AI endpoint (or re-reads the posting).
  const callsBeforeTyping = aiCalls.length
  await page.locator('.cm-content').click()
  await page.keyboard.press('ControlOrMeta+ArrowUp')
  await page.keyboard.type('% a note typed by hand', { delay: 20 })
  await expect(page.getByText('Unsaved changes').first()).toBeVisible()
  await page.waitForTimeout(2000) // past the score (400 ms) and preview (800 ms) debounces
  expect(aiCalls.slice(callsBeforeTyping)).toEqual([])

  if (!TECTONIC) {
    // No compiler on this machine: the editor still works and says how to fix the preview.
    await expect(page.getByRole('alert').filter({ hasText: 'LaTeX compilation failed' })).toBeVisible()
    await expect(page.getByText('tectonic is not installed. Install it with: brew install tectonic')).toBeVisible()
  }

  // Accept one suggestion: the score rises.
  // CodeMirror only draws what is in view; the bullets are at the end of the source.
  await page.keyboard.press('ControlOrMeta+ArrowDown')
  const accepts = page.getByRole('button', { name: /^Accept suggestion/ })
  await expect(accepts).toHaveCount(3)
  await expect(projection(page)).toHaveText('→ 75 if all accepted')
  await accepts.first().click()
  await expect.poll(() => scoreOf(page)).toBeGreaterThan(start)
  // Python + Docker are 6 of 12 requirement weight; the projection still counts the other two.
  await expect.poll(() => scoreOf(page)).toBe(50)
  await expect(projection(page)).toHaveText('→ 75 if all accepted')
  const afterAccept = 50

  // Reject another: the "→ N" projection updates.
  await page.getByRole('button', { name: /^Reject suggestion/ }).first().click()
  // The SQL rewrite (worth 8) is gone from the projection: 75 -> 67.
  await expect(projection(page)).toHaveText('→ 67 if all accepted')
  expect(await scoreOf(page)).toBe(afterAccept)

  // Save: a version is saved.
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByText('Saved as version 2.')).toBeVisible()
  await expect(page.getByText('Version 2 saved')).toBeVisible()

  // Typing and saving made no AI request either.
  expect(aiCalls.slice(callsBeforeTyping)).toEqual([])

  // --- Record changes -> the application is flagged ---------------------------------------
  await page.goto('/record')
  await page.getByRole('link', { name: /Backend Engineer/ }).click()
  await page.getByRole('button', { name: 'Edit Billing service' }).click()
  await page.getByLabel('Description').fill('Built a Python API with Docker for invoices and receipts.')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByText('invoices and receipts')).toBeVisible()

  await page.goto(appUrl)
  await expect(page.getByText('Record changed since this was made')).toBeVisible()
  await page.goto('/resumes')
  await expect(page.getByText('Record changed since this was made')).toBeVisible()
  exportUrl = appUrl
})

test('export downloads a PDF', async ({ page }) => {
  test.skip(!TECTONIC, 'tectonic is not on PATH: the PDF download needs a real compile (brew install tectonic)')
  await page.goto(exportUrl)
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export PDF' }).click()
  expect((await download).suggestedFilename()).toMatch(/\.pdf$/)
})
