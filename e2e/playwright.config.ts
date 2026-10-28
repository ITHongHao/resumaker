import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { defineConfig } from '@playwright/test'

// Fresh data per run. The config is also loaded by workers, which inherit this env var, so the
// directory is created once (in the main process) and removed by global-teardown.ts.
const tmp = (process.env.RESUMAKER_E2E_TMP ??= mkdtempSync(path.join(tmpdir(), 'resumaker-e2e-')))

// Ports differ from `make dev` (8000 / 5173) so a running dev server is never reused.
const API_PORT = 8100
const WEB_PORT = 5273
const root = path.resolve(import.meta.dirname, '..')

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  workers: 1,
  fullyParallel: false,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  globalTeardown: './global-teardown.ts',
  reporter: [['list']],
  outputDir: path.join(import.meta.dirname, 'test-results'), // gitignored; temp data lives in tmp
  use: {
    baseURL: `http://127.0.0.1:${WEB_PORT}`,
    // Uses the Chromium Playwright already cached (revision 1223 for @playwright/test 1.60.x);
    // nothing is downloaded.
    browserName: 'chromium',
    acceptDownloads: true,
  },
  webServer: [
    {
      command: `.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port ${API_PORT}`,
      cwd: path.join(root, 'backend'),
      url: `http://127.0.0.1:${API_PORT}/api/health`,
      reuseExistingServer: false,
      env: {
        RESUMAKER_DB: path.join(tmp, 'resumaker.db'),
        RESUMAKER_HOME: path.join(tmp, 'home'),
        RESUMAKER_FAKE_LLM: '1', // tests/demos only; see README
      },
    },
    {
      command: `npx vite --host 127.0.0.1 --port ${WEB_PORT} --strictPort`,
      cwd: path.join(root, 'frontend'),
      url: `http://127.0.0.1:${WEB_PORT}`,
      reuseExistingServer: false,
      env: { RESUMAKER_API_URL: `http://127.0.0.1:${API_PORT}` },
    },
  ],
})
