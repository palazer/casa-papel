import { describe, expect, it } from 'vitest'
import { doneLabel, doneness } from '@/app/display'
import type { ResolvedItem } from '@/engine'
import type { ItemStatus } from '@/model'

const item = (status: ItemStatus, skipped = false): ResolvedItem => ({
  id: status + String(skipped), label: '', amount: 100, effectiveAmount: 100, status, fundedBy: 'cash', date: null, note: null, recurringItemId: null, kind: 'normal', skipped,
})

describe('doneness', () => {
  it('counts a single amount as one item', () => {
    expect(doneness({ status: 'committed', items: [] })).toEqual({ done: 0, total: 1, state: 'none' })
    expect(doneness({ status: 'projected', items: [] })).toEqual({ done: 0, total: 1, state: 'none' })
    expect(doneness({ status: 'done', items: [] })).toEqual({ done: 1, total: 1, state: 'all' })
  })
  it('counts items one by one and ignores skipped ones', () => {
    expect(doneness({ status: 'committed', items: [item('done'), item('committed'), item('projected')] })).toEqual({ done: 1, total: 3, state: 'partial' })
    expect(doneness({ status: 'done', items: [item('done'), item('done'), item('committed', true)] })).toEqual({ done: 2, total: 2, state: 'all' })
    expect(doneness({ status: 'committed', items: [item('committed'), item('done', true)] })).toEqual({ done: 0, total: 1, state: 'none' })
  })
  it('says it in words', () => {
    expect(doneLabel({ done: 1, total: 1, state: 'all' })).toBe('Done')
    expect(doneLabel({ done: 0, total: 3, state: 'none' })).toBe('Not done yet')
    expect(doneLabel({ done: 2, total: 3, state: 'partial' })).toBe('2 of 3 done')
  })
})
