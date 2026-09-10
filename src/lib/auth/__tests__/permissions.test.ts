import { describe, it, expect } from 'vitest'
import { canMutateDocuments } from '../permissions'

// The confirmation step asks the uploader to check the AI's classification.
// Before this, the uploader was the only role that could not act on it: the
// review UI rendered the type picker and remove button for vendors and every
// click 403'd. Vendors get that access, but only on a draft.
describe('canMutateDocuments', () => {
  it('lets a vendor relabel documents while the submission is a draft', () => {
    expect(canMutateDocuments('VENDOR', true)).toBe(true)
  })

  it('locks a vendor out once the invoice is live and under review', () => {
    expect(canMutateDocuments('VENDOR', false)).toBe(false)
  })

  it('leaves staff access unchanged in both states', () => {
    for (const role of ['ADMIN', 'GA_STAFF', 'GA_MANAGER']) {
      expect(canMutateDocuments(role, true)).toBe(true)
      expect(canMutateDocuments(role, false)).toBe(true)
    }
  })
})
