import { describe, expect, it } from 'vitest'
import { cellKey, computeEngine } from '@/engine'
import { monthRange, newId } from '@/model'
import { CasaDb, Store, loadTables, setAccountActual, setCardBalanceBooked, unrecordedRowName } from '@/store'
import { DEMO_IDS } from '@/demo/demoHousehold'
import { loadDemo } from '@/demo/loadDemo'

const months = monthRange('2026-09', '2026-12')

async function world() {
  const store = new Store(new CasaDb(`test-${newId()}`))
  await loadDemo(store)
  const read = async () => {
    const tables = await loadTables(store)
    return { tables, out: computeEngine({ tables, months }) }
  }
  return { store, read }
}

describe('a card\'s real balance, with the difference counted as spending', () => {
  it('books what is owed beyond the plan as a done item on the card\'s own row, in one undoable step', async () => {
    const { store, read } = await world()
    const before = await read()
    const expected = before.out.accounts[DEMO_IDS.card].months['2026-10'].computed
    const spentBefore = before.out.totals['2026-10'].cashExpense

    expect(await setCardBalanceBooked(store, DEMO_IDS.card, '2026-10', expected + 400_00)).toBe(400_00)
    const { tables, out } = await read()
    const card = tables.accounts.find((a) => a.id === DEMO_IDS.card)!
    const row = tables.rows.find((r) => r.name === unrecordedRowName(card))!
    expect(row).toMatchObject({ name: 'Credit card – Not recorded', section: 'expense', kind: 'plain', accountId: DEMO_IDS.card, categoryId: null, currency: null, defaultStatus: 'committed' })
    expect(out.cells[cellKey(row.id, '2026-10')]).toMatchObject({ value: 400_00, status: 'done' })
    expect(out.cells[cellKey(row.id, '2026-10')].items.map((i) => [i.label, i.amount])).toEqual([['Not recorded', 400_00]])
    // the month's spending and the debt now agree: nothing is left unexplained
    expect(out.totals['2026-10'].cashExpense).toBe(spentBefore + 400_00)
    expect(out.accounts[DEMO_IDS.card].months['2026-10']).toMatchObject({ balance: expected + 400_00, computed: expected + 400_00, adjustment: 0 })
    // and the amount does not repeat in the months after
    expect(out.cells[cellKey(row.id, '2026-11')].value).toBe(0)
    expect(out.cells[cellKey(row.id, '2026-12')].value).toBe(0)

    // a second look at the same month adds to the same row
    expect(await setCardBalanceBooked(store, DEMO_IDS.card, '2026-10', expected + 450_00)).toBe(50_00)
    const again = await read()
    expect(again.tables.rows.filter((r) => r.name === 'Credit card – Not recorded' && !r.deletedAt)).toHaveLength(1)
    expect(again.out.cells[cellKey(row.id, '2026-10')].items.map((i) => i.amount)).toEqual([400_00, 50_00])
    expect(again.out.accounts[DEMO_IDS.card].months['2026-10'].adjustment).toBe(0)

    // one undo takes the last booking back, balance included
    await store.undo()
    const undone = await read()
    expect(undone.out.cells[cellKey(row.id, '2026-10')].value).toBe(400_00)
    expect(undone.out.accounts[DEMO_IDS.card].months['2026-10'].balance).toBe(expected + 400_00)
  })

  it('only pins the balance when it is not above the plan', async () => {
    const { store, read } = await world()
    const expected = (await read()).out.accounts[DEMO_IDS.card].months['2026-10'].computed
    expect(await setCardBalanceBooked(store, DEMO_IDS.card, '2026-10', expected - 10_00)).toBe(0)
    const { tables, out } = await read()
    expect(tables.rows.some((r) => r.name === 'Credit card – Not recorded')).toBe(false)
    expect(out.accounts[DEMO_IDS.card].months['2026-10']).toMatchObject({ balance: expected - 10_00, adjustment: -10_00 })
  })

  it('refuses a closed month and anything that is not a card recording its purchases', async () => {
    const { store, read } = await world()
    await expect(setCardBalanceBooked(store, DEMO_IDS.card, '2026-09', 500_00)).rejects.toThrow(/closed/)
    await expect(setCardBalanceBooked(store, DEMO_IDS.savings, '2026-10', 500_00)).rejects.toThrow(/Only a card whose purchases are expense rows/)
    // the plain way still works for every account
    await setAccountActual(store, DEMO_IDS.savings, '2026-10', 900_000)
    expect((await read()).out.accounts[DEMO_IDS.savings].months['2026-10'].balance).toBe(900_000)
  })
})
