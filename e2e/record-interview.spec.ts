import { expect, test } from '@playwright/test'

// Runs after mvp.spec.ts against the same throwaway database (fake LLM), so every name here is unique.
test('record fields, add field menu, interview answers', async ({ page }) => {
  // --- Education: a Degree type, and Minor from the Add field menu ----------------------
  await page.goto('/record')
  const education = page.getByRole('region', { name: 'Education' })
  await education.getByRole('button', { name: '+ Add education' }).click()
  await page.getByLabel('School').fill('Lakeview University')
  await page.getByLabel('Degree type').selectOption("Bachelor's")
  await expect(page.getByLabel('Minor')).toHaveCount(0)
  await page.getByRole('button', { name: 'Add field' }).click()
  await page.getByRole('menuitem', { name: 'Minor' }).click()
  await expect(page.getByLabel('Minor')).toBeFocused()
  await page.getByLabel('Minor').fill('Statistics')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(education.getByText('Lakeview University', { exact: true })).toBeVisible()
  const cards = async () => (await (await page.request.get('/api/cards')).json()) as { title: string; extra: Record<string, string> }[]
  const school = (await cards()).find((c) => c.title === 'Lakeview University')
  expect(school?.extra).toMatchObject({ degree_type: "Bachelor's", minor: 'Statistics' })

  // --- Job with a manager name from the menu ---------------------------------------------
  await page.getByRole('button', { name: '+ Add job' }).click()
  await page.getByLabel('Company').fill('Harbor Labs')
  await page.getByLabel('Job title').fill('Platform Engineer')
  await page.getByLabel('Start date').fill('2020')
  await expect(page.getByLabel('Manager name')).toHaveCount(0)
  await page.getByRole('button', { name: 'Add field' }).click()
  await page.getByRole('menuitem', { name: 'Manager name' }).click()
  await page.getByLabel('Manager name').fill('Dana Reyes')
  await page.getByRole('button', { name: 'Save job' }).click()
  // Wait for the save to land before reading the API.
  await expect(page.getByRole('link', { name: /Platform Engineer/ })).toBeVisible()
  const jobs = (await (await page.request.get('/api/jobs')).json()) as { title: string; extra: Record<string, string> }[]
  expect(jobs.find((j) => j.title === 'Platform Engineer')?.extra.manager_name).toBe('Dana Reyes')

  // A project, so the fake draft has a Record card to cite.
  await page.getByRole('link', { name: /Platform Engineer/ }).click()
  await page.getByRole('button', { name: '+ Add project or accomplishment' }).click()
  await page.getByLabel('Kind').selectOption('accomplishment')
  await page.getByLabel('Title').fill('Deploy automation')
  await page.getByLabel('What it did').fill('Automated deployments with a Python tool.')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByText('Deploy automation', { exact: true })).toBeVisible()

  // Currently work here: stored as "yes", shown as "Yes", still set after a reload.
  await page.getByRole('button', { name: 'Edit job details' }).click()
  await page.getByLabel('Currently work here').selectOption({ label: 'Yes' })
  await page.getByRole('button', { name: 'Save job' }).click()
  await expect(page.getByText(/Currently work here: Yes/)).toBeVisible()
  await page.reload()
  await expect(page.getByText(/Currently work here: Yes/)).toBeVisible()
  const harbor = ((await (await page.request.get('/api/jobs')).json()) as { title: string; extra: Record<string, string> }[])
    .find((j) => j.title === 'Platform Engineer')
  expect(harbor?.extra.currently_here).toBe('yes')

  // --- Interview: custom question, manual answer, AI draft accepted -----------------------
  await page.goto('/interview')
  await page.getByRole('button', { name: '+ Add my own question' }).click()
  await page.getByLabel('Question', { exact: true }).fill('Tell me about a time you automated a process')
  await page.getByRole('button', { name: 'Save question' }).click()
  await expect(page.getByRole('heading', { name: 'Tell me about a time you automated a process' })).toBeVisible()
  await expect(page.getByText('No answers yet')).toBeVisible()

  await page.getByRole('button', { name: '+ Add an answer' }).click()
  await page.getByLabel('Situation').fill('Releases were slow.')
  await page.getByLabel('Task').fill('Speed them up.')
  await page.getByLabel('Action').fill('Wrote a script.')
  await page.getByLabel('Result').fill('Releases got easier.')
  await page.getByRole('button', { name: 'Save answer' }).click()
  await expect(page.getByText('Wrote a script.')).toBeVisible()

  await page.getByRole('button', { name: 'Draft another version' }).click()
  await expect(page.getByText('Suggested draft, not saved until you accept')).toBeVisible()
  await page.getByRole('button', { name: 'Accept' }).click()
  await expect(page.getByText('Suggested draft, not saved until you accept')).toHaveCount(0)
  await expect(page.getByRole('article')).toHaveCount(2)

  // --- Reload: both answers are still there ----------------------------------------------
  await page.reload()
  await page.getByRole('button', { name: 'Tell me about a time you automated a process' }).click()
  await expect(page.getByRole('article')).toHaveCount(2)
  await expect(page.getByText('Wrote a script.')).toBeVisible()

  // --- Record page: no Behavioral section ------------------------------------------------
  await page.goto('/record')
  await expect(page.getByRole('heading', { name: 'Education' })).toBeVisible()
  await expect(page.getByText(/behavioral/i)).toHaveCount(0)
})
