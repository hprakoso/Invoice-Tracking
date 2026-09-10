import { describe, it, expect } from 'vitest'
import {
  canMutateDocuments,
  canChangeOwnPassword,
  isVendorApiBlockedPendingPasswordChange,
} from '../permissions'

const OTHER_ROLES = ['ADMIN', 'GA_STAFF', 'GA_MANAGER']

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

// A vendor gets exactly one self-service password change — the forced one at
// first login. Every later change is admin-initiated, which re-arms the flag
// and grants another single change, so no admin ever holds a live vendor
// password and the vendor can never rotate one on its own.
describe('canChangeOwnPassword', () => {
  it('lets a vendor complete the forced initial change', () => {
    expect(canChangeOwnPassword('VENDOR', true)).toBe(true)
  })

  it('refuses a vendor once the initial password has been replaced', () => {
    expect(canChangeOwnPassword('VENDOR', false)).toBe(false)
  })

  it('leaves every other role unrestricted', () => {
    for (const role of OTHER_ROLES) {
      expect(canChangeOwnPassword(role, true)).toBe(true)
      expect(canChangeOwnPassword(role, false)).toBe(true)
    }
  })
})

// The forced change used to be a middleware redirect on page routes only —
// every /api/* request went through untouched, so a vendor still on the
// admin-issued password could drive the whole application from curl without
// ever changing it.
describe('isVendorApiBlockedPendingPasswordChange', () => {
  const block = (path: string) => isVendorApiBlockedPendingPasswordChange('VENDOR', true, path)

  it('blocks a vendor that has not completed the forced change', () => {
    for (const path of [
      '/api/invoices',
      '/api/invoices/abc-123',
      '/api/invoices/abc-123/upload',
      '/api/invoices/abc-123/ocr',
      '/api/vendors/abc-123',
      '/api/companies',
      '/api/dashboard',
      '/api/users/me/passwordx', // a prefix that only looks like the exempt route
    ]) {
      expect(block(path), path).toBe(true)
    }
  })

  it('still allows exactly what is needed to sign in and set the new password', () => {
    for (const path of [
      '/api/auth/session',
      '/api/auth/signout',
      '/api/auth/callback/credentials',
      '/api/users/me/password',
    ]) {
      expect(block(path), path).toBe(false)
    }
  })

  it('stops applying the moment the change is done', () => {
    expect(isVendorApiBlockedPendingPasswordChange('VENDOR', false, '/api/invoices')).toBe(false)
  })

  it('never applies to any other role', () => {
    for (const role of OTHER_ROLES) {
      expect(isVendorApiBlockedPendingPasswordChange(role, true, '/api/invoices')).toBe(false)
      expect(isVendorApiBlockedPendingPasswordChange(role, false, '/api/invoices')).toBe(false)
    }
  })

  it('leaves page routes to the existing middleware redirect', () => {
    expect(block('/invoices/upload')).toBe(false)
    expect(block('/change-password')).toBe(false)
  })
})
