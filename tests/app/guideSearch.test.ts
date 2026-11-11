import { describe, expect, it } from 'vitest'
import { GUIDE } from '@/app/guide'
import { HELP } from '@/app/help'
import { highlightRanges, queryWords, searchGuide, snippetFor, topicTexts } from '@/features/guide/search'

const keys = (q: string) => searchGuide(GUIDE, q, HELP).map((h) => h.topic.key)

describe('searching the guide', () => {
  it('an empty query leaves every topic; a word filters by paragraph, step, tip or fact', () => {
    expect(searchGuide(GUIDE, '', HELP)).toHaveLength(GUIDE.length)
    expect(searchGuide(GUIDE, '   ', HELP)).toHaveLength(GUIDE.length)
    expect(keys('lisbon')).toEqual(['virtual-accounts']) // a paragraph's example
    expect(keys('make recurring')).toEqual(['schedules']) // a step's control
    expect(keys('honest')).toEqual(['debts']) // only in a related tip's text
    expect(keys('wallet')).toEqual(['investments']) // only in the account-type facts
  })

  it('every word must match and case does not matter', () => {
    expect(keys('LISBON')).toEqual(['virtual-accounts'])
    expect(keys('lisbon travel')).toEqual(['virtual-accounts'])
    expect(keys('lisbon xyzzy')).toEqual([])
    expect(queryWords('  Pool   Account ')).toEqual(['pool', 'account'])
  })

  it('highlights every occurrence, longest word first, without overlaps', () => {
    expect(highlightRanges('Virtual accounts virtual', ['virtual'])).toEqual([[0, 7], [17, 24]])
    expect(highlightRanges('pools', ['pool', 'pools'])).toEqual([[0, 5]])
    expect(highlightRanges('nothing here', ['xyz'])).toEqual([])
    expect(highlightRanges('abc', [])).toEqual([])
    // a letter whose lowercase form is longer (İ → i̇) must not shift the marks after it
    expect(highlightRanges('İstanbul pool', ['pool'])).toEqual([[9, 13]])
  })

  it('ranks a hit in the title first, then the topics with the most hits, and counts them', () => {
    const hits = searchGuide(GUIDE, 'virtual', HELP)
    expect(hits[0].topic.key).toBe('virtual-accounts')
    expect(hits[0].inTitle).toBe(true)
    expect(hits[0].count).toBeGreaterThan(1)
    const rest = hits.slice(1)
    expect(rest.every((h) => !h.inTitle)).toBe(true)
    for (let i = 1; i < rest.length; i++) expect(rest[i - 1].count).toBeGreaterThanOrEqual(rest[i].count)
    expect(searchGuide(GUIDE, '', HELP).map((h) => h.topic.key)).toEqual(GUIDE.map((t) => t.key)) // guide order, nothing counted
  })

  it('the snippet is one line around the first hit, cut at word boundaries', () => {
    const texts = ['Title', 'Summary without the word.', 'A long paragraph that keeps going for a while before the word lisbon appears somewhere in the middle of it and then keeps going for a while after it too.']
    const s = snippetFor(texts, ['lisbon'], 20)
    expect(s).toMatch(/^…\S.*lisbon.*\S…$/)
    expect(s.length).toBeLessThan(70)
    expect(snippetFor(['T', 'Pool first, then the rest of a sentence that goes on and on and on.'], ['pool'], 20)).toMatch(/^Pool first, then.*…$/) // no leading cut at the start
    expect(snippetFor(['Virtual accounts', 'Set money aside inside a savings account.'], ['virtual'])).toBe('Set money aside inside a savings account.') // only the title matches: the summary
  })

  it('a topic is searched by its related tips too, so every (i) text can be found', () => {
    const goals = GUIDE.find((t) => t.key === 'goals')!
    expect(topicTexts(goals, HELP)).toContain(HELP['goal.status'].text)
  })
})
