import { describe, expect, it } from 'vitest'
import { buildDemoTables } from '@/demo/demoHousehold'
import { GoalSchema, RowSchema, newId, type Tables } from '@/model'
import { describeRemoval, monthSpan, planArchive, planRemoval, quoteNames } from '@/store'

/** The demo household as of November 2026: September is closed, October open with amounts, November the current month. */
const OPTS = { today: '2026-11', locale: 'en-IE' }
const T0 = Date.UTC(2026, 10, 1)

type Named = 'rows' | 'accounts' | 'pools' | 'entities' | 'recurringItems' | 'categories'
const idOf = (t: Tables, table: Named, name: string) => {
  const x = (t[table] as Array<{ id: string; name: string }>).find((r) => r.name === name)
  if (!x) throw new Error(`no ${table} named ${name}`)
  return x.id
}

describe('describeRemoval', () => {
  it('a row with amounts in a closed month can only be archived; one without can be deleted', () => {
    const t = buildDemoTables()
    const groceries = describeRemoval(t, { kind: 'row', id: idOf(t, 'rows', 'Groceries') }, OPTS)
    expect(groceries).toMatchObject({ kindLabel: 'Row', subject: 'Groceries', closedHistory: 'Sept 2026', closedUntil: '2026-09', canDelete: false, canArchive: true, archiveNotBefore: '2026-10', archiveFrom: '2026-11' })
    expect(groceries.archiveChanges).toEqual(['Hidden from Nov 2026 on; its amounts in 14 later months no longer count'])

    const other = describeRemoval(t, { kind: 'row', id: idOf(t, 'rows', 'Other income') }, OPTS)
    expect(other.closedHistory).toBeNull()
    expect(other.canDelete).toBe(true)
    expect(other.loses).toEqual(['Its amounts in 14 months (Nov 2026 – Dec 2027)'])
    expect(other.changes).toEqual([])
    // an earlier archive month is described from that month
    expect(describeRemoval(t, { kind: 'row', id: idOf(t, 'rows', 'Other income') }, { ...OPTS, archiveFrom: '2027-01' }).archiveChanges[0]).toBe('Hidden from Jan 2027 on; its amounts in 12 later months no longer count')
  })

  it('a row names its schedules, its followers and the pool account it fills', () => {
    const t = buildDemoTables()
    const rent = idOf(t, 'rows', 'The flat – Rent')
    t.rows.push(RowSchema.parse({ id: newId(), createdAt: T0, updatedAt: T0, name: 'Rent mirror', section: 'transfer', followsRowId: rent, order: 'z0' }))
    const d = describeRemoval(t, { kind: 'row', id: rent }, OPTS)
    expect(d.loses).toContain('Its schedule "Rent"')
    expect(d.changes).toEqual(['"Rent mirror" stops following it and keeps its own amounts'])
    expect(d.archiveChanges).toContain('Its schedule "Rent" stops after Oct 2026')
    expect(d.archiveChanges).toContain('"Rent mirror" stops following it and keeps the last amount as its own from Nov 2026')

    const alloc = describeRemoval(t, { kind: 'row', id: idOf(t, 'rows', 'Travel pool') }, OPTS)
    expect(alloc.changes).toEqual(['The pool account "Travel" is no longer filled each month'])
    const plug = describeRemoval(t, { kind: 'row', id: idOf(t, 'rows', 'To savings') }, OPTS)
    expect(plug.changes).toEqual(['"Savings" no longer receives the month\'s leftover'])
  })

  it('an income row names the rows deducted from it; removing or archiving it makes them ordinary spending', () => {
    const t = buildDemoTables()
    const other = idOf(t, 'rows', 'Other income')
    const health = idOf(t, 'rows', 'Health')
    t.rows.find((r) => r.id === health)!.deductedFromRowId = other
    const d = describeRemoval(t, { kind: 'row', id: other }, OPTS)
    expect(d.changes).toEqual(['"Health" is no longer deducted from it and counts as ordinary spending'])
    expect(d.archiveChanges).toContain('"Health" is no longer deducted from it and counts as ordinary spending from Nov 2026')
    const unlinked = (muts: ReturnType<typeof planRemoval>) => muts
      .map((m) => m as unknown as { table: string; record?: { id?: string; deductedFromRowId?: string | null } })
      .find((m) => m.table === 'rows' && m.record?.id === health)?.record?.deductedFromRowId
    expect(unlinked(planRemoval(t, { kind: 'row', id: other }, T0, OPTS))).toBeNull()
    // archiving leaves the link: the engine stops the deduction at the archive month, so earlier months keep their net
    expect(unlinked(planArchive(t, { kind: 'row', id: other }, '2026-11', T0, OPTS))).toBeUndefined()
  })

  it('accounts: typed rows and pool accounts block, plain rows and schedules are consequences, a tracked balance in a closed month is history', () => {
    const t = buildDemoTables()
    const savings = describeRemoval(t, { kind: 'account', id: idOf(t, 'accounts', 'Savings') }, OPTS)
    expect(savings.blockers.map((b) => b.text)).toEqual(['"To savings" sends money to it', 'The pool account "Travel" is held in it', 'The pool account "Clothing" is held in it'])
    expect(savings.blockers[1].where).toMatch(/Pool accounts/)
    expect(savings).toMatchObject({ kindLabel: 'Account', closedHistory: 'Sept 2026', canDelete: false, canArchive: true })
    expect(savings.archiveChanges).toEqual([
      'Its balance stops at Oct 2026; from Nov 2026 it is hidden and no longer counts towards net worth',
      '"To savings" keeps moving money, but the balance is no longer tracked from Nov 2026',
      'Its pool accounts "Travel" and "Clothing" are archived with it from Nov 2026',
    ])

    const main = describeRemoval(t, { kind: 'account', id: idOf(t, 'accounts', 'Main account') }, OPTS)
    expect(main).toMatchObject({ closedHistory: null, canDelete: true, blockers: [] })
    expect(main.changes).toEqual([
      '"The flat – Rent", "The flat – Utilities", "Public transport", "The car – Insurance" and 5 more no longer name it as the paying account',
      '3 schedules no longer name it',
    ])
    expect(main.archiveChanges[0]).toBe('Hidden from Nov 2026 on; rows that name it keep working')
  })

  it('pool accounts: closed allocations make them archive-only; archiving moves spending to savings from that month', () => {
    const t = buildDemoTables()
    const travel = describeRemoval(t, { kind: 'pool', id: idOf(t, 'pools', 'Travel') }, OPTS)
    expect(travel).toMatchObject({ kindLabel: 'Pool account', closedHistory: 'Sept 2026', canDelete: false, canArchive: true })
    expect(travel.loses[0]).toMatch(/^Its balance \(Sept 2026 – /)
    expect(travel.loses[1]).toMatch(/^The row "Travel pool" that fills it, with its amounts in \d+ months$/)
    expect(travel.changes).toEqual(['"Travel" comes out of the savings balance instead', 'Spending that came out of it in 1 month counts as spent from the savings balance'])
    expect(travel.archiveChanges).toEqual([
      'Its balance stops at Oct 2026',
      '"Travel pool" is archived from Nov 2026; nothing more is set aside',
      'From Nov 2026, "Travel" comes out of the savings balance; earlier months keep the pool account as their source',
    ])
  })

  it('people & things: rows with closed amounts make them archive-only; a thing without them can go', () => {
    const t = buildDemoTables()
    const robin = describeRemoval(t, { kind: 'entity', id: idOf(t, 'entities', 'Robin') }, OPTS)
    expect(robin).toMatchObject({ kindLabel: 'Child', closedHistory: 'Sept 2026', canDelete: false })
    expect(robin.changes).toEqual(['"Robin – Child benefit" and "Robin – Childcare" become shared'])
    expect(robin.archiveChanges).toEqual(['Hidden from People & things from Nov 2026; its rows and earlier months stay as they are'])
    const alex = describeRemoval(t, { kind: 'entity', id: idOf(t, 'entities', 'Alex') }, OPTS)
    expect(alex.changes).toEqual(['"Alex – Salary", "Alex – Personal" and "Alex – Pocket" become shared'])
    const car = describeRemoval(t, { kind: 'entity', id: idOf(t, 'entities', 'The car') }, OPTS)
    expect(car).toMatchObject({ kindLabel: 'Vehicle', closedHistory: null, canDelete: true, loses: [] })
    expect(car.changes).toEqual(['"The car – Insurance" loses its tag'])
  })

  it('schedules, goals and categories are always deletable and never archived', () => {
    const t = buildDemoTables()
    const sched = describeRemoval(t, { kind: 'schedule', id: idOf(t, 'recurringItems', 'Car insurance') }, OPTS)
    expect(sched).toMatchObject({ kindLabel: 'Schedule', canArchive: false, canDelete: true, loses: [], archiveChanges: [] })
    expect(sched.note).toMatch(/"End after"/)
    t.goals.push(GoalSchema.parse({ id: newId(), createdAt: T0, updatedAt: T0, name: 'Cushion', kind: 'account-balance', accountId: idOf(t, 'accounts', 'Savings'), target: 1000000, startMonth: '2026-11' }))
    const goal = describeRemoval(t, { kind: 'goal', id: t.goals[0].id }, OPTS)
    expect(goal).toMatchObject({ kindLabel: 'Goal', subject: 'Cushion', canArchive: false, canDelete: true, note: 'What it watched is not touched.' })
    // the account the goal watches now lists it
    expect(describeRemoval(t, { kind: 'account', id: idOf(t, 'accounts', 'Savings') }, OPTS).loses).toContain('The goal "Cushion", which watches it')
    const cat = describeRemoval(t, { kind: 'category', id: idOf(t, 'categories', 'Transport') }, OPTS)
    expect(cat).toMatchObject({ kindLabel: 'Category', canArchive: false, canDelete: true })
    expect(cat.changes).toEqual(['"Public transport" and "The car – Insurance" keep their place without a category'])
  })

  it('the plans refuse what the impact refuses', () => {
    const t = buildDemoTables()
    expect(() => planRemoval(t, { kind: 'row', id: idOf(t, 'rows', 'Groceries') }, T0, OPTS)).toThrow(/amounts in closed months \(Sept 2026\)\. Archive it instead/)
    expect(() => planRemoval(t, { kind: 'account', id: idOf(t, 'accounts', 'Main account') }, T0, OPTS)).not.toThrow()
    expect(() => planArchive(t, { kind: 'row', id: idOf(t, 'rows', 'Groceries') }, '2026-09', T0, OPTS)).toThrow(/Sept 2026 is closed and has amounts in it\. Archive from Oct 2026 or later/)
    expect(() => planArchive(t, { kind: 'schedule', id: idOf(t, 'recurringItems', 'Rent') }, '2026-11', T0, OPTS)).toThrow(/cannot be archived/)
    expect(() => describeRemoval(t, { kind: 'row', id: newId() }, OPTS)).toThrow(/That row no longer exists/)
  })
})

describe('words', () => {
  it('quotes and counts names', () => {
    expect(quoteNames([])).toBe('')
    expect(quoteNames(['A'])).toBe('"A"')
    expect(quoteNames(['A', 'B'])).toBe('"A" and "B"')
    expect(quoteNames(['A', 'B', 'C', 'D'])).toBe('"A", "B", "C" and "D"')
    expect(quoteNames(['A', 'B', 'C', 'D', 'E', 'F'])).toBe('"A", "B", "C", "D" and 2 more')
  })
  it('spans months', () => {
    expect(monthSpan([], 'en-IE')).toBe('')
    expect(monthSpan(['2026-09'], 'en-IE')).toBe('Sept 2026')
    expect(monthSpan(['2026-10', '2026-09'], 'en-IE')).toBe('Sept–Oct 2026')
    expect(monthSpan(['2026-11', '2027-03'], 'en-IE')).toBe('Nov 2026 – Mar 2027')
  })
})
