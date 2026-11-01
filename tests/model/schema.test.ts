import { describe, expect, it } from 'vitest'
import { CellSchema, EventSchema, HouseholdSchema, RowSchema, newId, poolIdOf, poolRef } from '@/model'

const now = Date.now()

describe('schemas', () => {
  it('applies defaults to a household', () => {
    const h = HouseholdSchema.parse({
      id: newId(), createdAt: now, updatedAt: now,
      name: 'Demo', baseCurrency: 'EUR', locale: 'de-DE', startMonth: '2026-11',
    })
    expect(h.closingRule).toBe('savings-plug')
    expect(h.moneyMode).toBe('pooled')
    expect(h.pocketTotal).toBe(0)
    expect(h.deletedAt).toBeNull()
  })
  it('rejects bad money and months', () => {
    expect(() => HouseholdSchema.parse({ id: newId(), createdAt: now, updatedAt: now, name: 'x', baseCurrency: 'eur', locale: 'en', startMonth: '2026-11' })).toThrow()
    expect(() => CellSchema.parse({ rowId: newId(), month: '2026-13', updatedAt: now })).toThrow()
    expect(() => CellSchema.parse({ rowId: newId(), month: '2026-11', mode: 'value', value: 12.5, updatedAt: now })).toThrow()
  })
  it('validates funded-by references', () => {
    const pool = newId()
    const row = RowSchema.parse({ id: newId(), createdAt: now, updatedAt: now, name: 'Travel', section: 'expense', defaultFundedBy: poolRef(pool) })
    expect(poolIdOf(row.defaultFundedBy)).toBe(pool)
    expect(() => RowSchema.parse({ id: newId(), createdAt: now, updatedAt: now, name: 'x', section: 'expense', defaultFundedBy: 'pool:nope' })).toThrow()
  })
  it('accepts a put event', () => {
    const e = EventSchema.parse({ id: newId(), ts: now, deviceId: 'dev', schemaVersion: 1, txId: newId(), type: 'put', table: 'rows', key: 'abc', record: {}, inverse: null })
    expect(e.table).toBe('rows')
  })
})
