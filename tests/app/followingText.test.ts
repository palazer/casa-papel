import { describe, expect, it } from 'vitest'
import { followingEffects, followingText, listMonths, onlyThisMonthText } from '@/features/grid/followingText'

const L = 'en-IE'
const PLAIN = 'The amount stays in every later month until you change it.'

describe('the sentence under "This and following months"', () => {
  it('lists months by name, and counts the rest beyond four', () => {
    expect(listMonths([], L)).toBe('')
    expect(listMonths(['2026-07'], L)).toBe('Jul 2026')
    expect(listMonths(['2026-09', '2026-07'], L)).toBe('Jul 2026 and Sept 2026')
    expect(listMonths(['2026-07', '2026-08', '2026-09'], L)).toBe('Jul 2026, Aug 2026 and Sept 2026')
    expect(listMonths(['2026-07', '2026-08', '2026-09', '2026-10', '2026-11'], L)).toBe('Jul 2026, Aug 2026, Sept 2026, Oct 2026 and 1 more month')
    expect(listMonths(['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11'], L)).toBe('Jun 2026, Jul 2026, Aug 2026, Sept 2026 and 2 more months')
  })

  it('says nothing new while no later month is touched', () => {
    expect(followingText('2026-03', { replaced: [], kept: [] }, L, PLAIN)).toBe(PLAIN)
    expect(followingEffects({ replaced: [], kept: [] }, L)).toBe('')
  })

  it('names the months it replaces and the ticked months it leaves', () => {
    expect(followingText('2026-03', { replaced: ['2026-07', '2026-09'], kept: [] }, L, PLAIN)).toBe('Counts from March 2026 on. Replaces what you typed for Jul 2026 and Sept 2026.')
    expect(followingText('2026-03', { replaced: [], kept: ['2026-10'] }, L, PLAIN)).toBe('Counts from March 2026 on. Oct 2026 is ticked as done and keeps its amount.')
    expect(followingText('2026-03', { replaced: ['2026-07'], kept: ['2026-10', '2026-11'] }, L, PLAIN))
      .toBe('Counts from March 2026 on. Replaces what you typed for Jul 2026. Oct 2026 and Nov 2026 are ticked as done and keep their amounts.')
  })
})

describe('the sentence under "Only this month"', () => {
  it('says what the month after goes on with', () => {
    expect(onlyThisMonthText('2026-03', 1200_00, 'EUR', L)).toBe('Only March 2026. April goes on with €1,200.00.')
    expect(onlyThisMonthText('2026-03', 0, 'EUR', L)).toBe('Only March 2026. April goes on with €0.00.')
  })

  it('says so when the month after has no amount', () => {
    expect(onlyThisMonthText('2026-03', null, 'EUR', L)).toBe('Only March 2026. April stays empty.')
    expect(onlyThisMonthText('2026-03', null, 'EUR', L, 'has no estimate')).toBe('Only March 2026. April has no estimate.')
  })

  it('names the year when the month after is in the next one, and stops at the month when there is nothing to say', () => {
    expect(onlyThisMonthText('2026-12', 1200_00, 'EUR', L)).toBe('Only December 2026. January 2027 goes on with €1,200.00.')
    expect(onlyThisMonthText('2026-03', undefined, 'EUR', L)).toBe('Only March 2026.')
  })
})
