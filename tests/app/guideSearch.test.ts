import { describe, expect, it } from 'vitest'
import { GUIDE } from '@/app/guide'
import { HELP } from '@/app/help'
import { highlightRanges, queryWords, searchGuide, topicTexts } from '@/features/guide/search'

const keys = (q: string) => searchGuide(GUIDE, q, HELP).map((t) => t.key)

describe('searching the guide', () => {
  it('an empty query leaves every topic; a word filters by paragraph, step, tip or fact', () => {
    expect(searchGuide(GUIDE, '', HELP)).toHaveLength(GUIDE.length)
    expect(searchGuide(GUIDE, '   ', HELP)).toHaveLength(GUIDE.length)
    expect(keys('lisbon')).toEqual(['pools']) // a paragraph's example
    expect(keys('make recurring')).toEqual(['schedules']) // a step's control
    expect(keys('honest')).toEqual(['debts']) // only in a related tip's text
    expect(keys('wallet')).toEqual(['investments']) // only in the account-type facts
  })

  it('every word must match and case does not matter', () => {
    expect(keys('LISBON')).toEqual(['pools'])
    expect(keys('lisbon travel')).toEqual(['pools'])
    expect(keys('lisbon xyzzy')).toEqual([])
    expect(queryWords('  Pool   Account ')).toEqual(['pool', 'account'])
  })

  it('highlights every occurrence, longest word first, without overlaps', () => {
    expect(highlightRanges('Pool accounts pool', ['pool'])).toEqual([[0, 4], [14, 18]])
    expect(highlightRanges('pools', ['pool', 'pools'])).toEqual([[0, 5]])
    expect(highlightRanges('nothing here', ['xyz'])).toEqual([])
    expect(highlightRanges('abc', [])).toEqual([])
  })

  it('a topic is searched by its related tips too, so every (i) text can be found', () => {
    const goals = GUIDE.find((t) => t.key === 'goals')!
    expect(topicTexts(goals, HELP)).toContain(HELP['goal.status'].text)
  })
})
