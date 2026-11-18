import { describe, expect, it } from 'vitest'
import { cellKey, computeEngine, type EngineOutput } from '@/engine'
import { monthRange, newId, type Cell, type CellItem, type MonthKey } from '@/model'
import { CasaDb, Store, clearCell, itemsFromCurrent, loadTables, quickCreateHousehold, saveRowMonth, setCellDone, setCellItems, setCellValue, type EditScope } from '@/store'

/**
 * The two choices under an amount, tried on rows with a random history. Whatever a row's months held before:
 * - "Only this month" changes that month and no other;
 * - "This and following months" leaves the months before alone, and with a new amount every month after it shows
 *   that amount, except a month in which something is ticked as done, which shows what it showed;
 * - Undo puts the stored months back exactly.
 * The histories come from a seeded generator, so a failure names its seed and can be run again.
 */
const months = monthRange('2026-01', '2026-12')
/** Where the histories happen: few enough months that they meet (an exception beside a list, a tick on a list). */
const busy = monthRange('2026-02', '2026-07')
const SEEDS = 200

/** A small seeded generator (mulberry32): the same seed gives the same history on every machine. */
function random(seed: number) {
  let a = seed >>> 0
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return { next, int: (n: number) => Math.floor(next() * n), pick: <T,>(list: readonly T[]): T => list[Math.floor(next() * list.length)] }
}

const item = (amount: number, over: Partial<CellItem> = {}): CellItem =>
  ({ id: newId(), label: '', amount, status: 'committed', fundedBy: 'cash', date: null, note: null, recurringItemId: null, kind: 'normal', skipped: false, ...over })
const AMOUNTS = [0, 100_00, 250_00, 400_00, 400_00, 900_00]
const SCOPES: EditScope[] = ['this-month', 'from-now-on']

async function household() {
  const store = new Store(new CasaDb(`test-${newId()}`))
  await quickCreateHousehold(store, { name: 'Test', baseCurrency: 'EUR', locale: 'en-IE', startMonth: '2026-01' })
  const rent = (await loadTables(store)).rows.find((r) => r.name === 'Rent')!
  return { store, rowId: rent.id }
}

const engineOf = async (store: Store): Promise<EngineOutput> => computeEngine({ tables: await loadTables(store), months })
const shown = (out: EngineOutput, rowId: string): number[] => months.map((m) => out.cells[cellKey(rowId, m)].value)
/** The row's stored months without their time stamps: what Undo has to bring back. */
const storedOf = async (store: Store, rowId: string): Promise<string[]> =>
  (await loadTables(store)).cells.filter((c) => c.rowId === rowId).sort((a, b) => (a.month < b.month ? -1 : 1))
    .map((c) => JSON.stringify({ ...c, updatedAt: 0, items: c.items.map((i) => ({ ...i })) }))
const ticked = (c: Cell | null): boolean => !!c && c.mode === 'items' && c.items.some((i) => !i.skipped && i.status === 'done')

/** One random thing done to the row, of the kinds its dialog and the done dot can do. */
async function anything(store: Store, rowId: string, r: ReturnType<typeof random>): Promise<void> {
  const month = r.pick(busy)
  const kind = r.int(6)
  if (kind <= 1) return setCellValue(store, rowId, month, r.pick(AMOUNTS), r.pick(SCOPES))
  if (kind === 2) return setCellItems(store, rowId, month, [item(r.pick(AMOUNTS), { status: r.pick(['projected', 'committed', 'done'] as const) })], r.pick(SCOPES))
  if (kind === 3) {
    // an item beside what the month shows, as "Add item" does it: a month that carries keeps a carried item
    const out = await engineOf(store)
    const list = [...itemsFromCurrent(out.cells[cellKey(rowId, month)], 'cash', 'committed'), item(r.pick(AMOUNTS), { label: 'Extra', status: r.pick(['committed', 'done'] as const) })]
    return saveRowMonth(store, rowId, month, { items: list, scope: r.pick(SCOPES) })
  }
  if (kind === 4) return setCellDone(store, rowId, month, r.next() < 0.8)
  return clearCell(store, rowId, month)
}

describe('the two choices under an amount, on rows with a random history', () => {
  it(`hold on ${SEEDS} seeded histories`, async () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const r = random(seed)
      const { store, rowId } = await household()
      for (let i = 0, n = 2 + r.int(7); i < n; i++) await anything(store, rowId, r)

      const month: MonthKey = r.pick(r.next() < 0.8 ? busy : months)
      const at = months.indexOf(month)
      const amount = r.pick(AMOUNTS)
      const scope = r.pick(SCOPES)
      const before = await engineOf(store)
      const was = shown(before, rowId)
      const stored = await storedOf(store, rowId)
      const said = `seed ${seed}: ${amount / 100} for ${month}, ${scope}; before ${was.map((v) => v / 100).join(' ')}`

      await setCellValue(store, rowId, month, amount, scope)
      const now = shown(await engineOf(store), rowId)
      expect(now[at], said).toBe(amount)
      expect(now.slice(0, at), said).toEqual(was.slice(0, at))
      if (scope === 'this-month') {
        expect(now.slice(at + 1), said).toEqual(was.slice(at + 1))
      } else {
        // only a new amount replaces: the month handed this amount on already, and nothing after it is looked at
        const same = before.cells[cellKey(rowId, month)].handsOn === amount
        months.forEach((m, i) => {
          if (i <= at) return
          const keeps = same || ticked(before.cells[cellKey(rowId, m)].cell)
          expect(now[i], `${said}; ${m}`).toBe(keeps ? was[i] : amount)
        })
      }

      // one step, and one Undo takes it back to the record
      await store.undo()
      expect(await storedOf(store, rowId), said).toEqual(stored)
    }
  }, 120_000)
})
