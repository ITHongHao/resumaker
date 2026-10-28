import { rmSync } from 'node:fs'

export default function globalTeardown() {
  const tmp = process.env.RESUMAKER_E2E_TMP
  if (tmp && tmp.includes('resumaker-e2e-')) rmSync(tmp, { recursive: true, force: true })
}
