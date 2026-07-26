import { describe, it, expect } from 'vitest'
import id from '../id'
import en from '../en'

function keyPaths(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key
    return typeof value === 'object' && value !== null
      ? keyPaths(value as Record<string, unknown>, path)
      : [path]
  })
}

describe('i18n dictionaries', () => {
  it('id and en have exactly the same set of keys', () => {
    const idKeys = keyPaths(id).sort()
    const enKeys = keyPaths(en).sort()
    expect(enKeys).toEqual(idKeys)
  })

  it('no value is an empty string', () => {
    for (const dict of [id, en]) {
      for (const path of keyPaths(dict)) {
        const value = path.split('.').reduce((o: Record<string, unknown>, k) => o[k] as Record<string, unknown>, dict)
        expect(value, `${path} should not be empty`).not.toBe('')
      }
    }
  })
})
