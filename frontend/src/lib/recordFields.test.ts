import { describe, expect, it } from 'vitest'

import { displayValue, FIELDS, formValue } from './recordFields'

const currently = FIELDS.job.find((f) => f.key === 'currently_here')!
const company = FIELDS.job.find((f) => f.key === 'company')!

describe('yes/no values', () => {
  it('shows stored lowercase values as Yes and No', () => {
    expect(displayValue(currently, 'yes')).toBe('Yes')
    expect(displayValue(currently, 'no')).toBe('No')
    expect(displayValue(company, 'yes')).toBe('yes')
  })

  it('reads a stored value of any case into the lowercase form value', () => {
    expect(formValue(currently, 'Yes')).toBe('yes')
    expect(formValue(company, 'Acme')).toBe('Acme')
  })
})
