import { exportSnapshot, importReplace, parseExportFile, postRecurring } from '@/store'
import { all, expectAddsUp, expectBalanced, expectSums } from '../../engine/sound'
import { diffFigures } from '../figures'
import { moneyText, monthName } from '../registry'
import type { World } from '../world'
import { bridgeOf } from './bridge'
import { carriedProblems } from './continuity'

/**
 * What must hold whatever a scenario does. The first six and "settled" are looked at after every step that changed
 * something; "undo" and "round-trip" once, at the end of the scenario. The names are what a scenario's `@breaks-…`
 * tag uses to say that an open finding shows as one of these.
 */
export const CHECKS = {
  balanced: 'Both halves of the Statement balance in every month',
  sums: 'Every heading is the sum of the lines it counts',
  carried: 'Every account starts a month with what it ended the month before',
  'adds-up': "The month's money adds up: what comes in is what goes out plus what is left",
  explained: 'The change in net worth is explained',
  'virtual-accounts': 'A virtual account is never below zero',
  undo: 'Undo gives back the figures from before the last action',
  settled: 'Letting the app settle a second time changes nothing',
  'round-trip': 'Export and import into an empty app gives the same figures',
} as const
export type CheckName = keyof typeof CHECKS

export interface CheckProblem {
  check: CheckName
  message: string
}

const few = (lines: string[], n = 4): string => `${lines.slice(0, n).join(' ')}${lines.length > n ? ` (and ${lines.length - n} more)` : ''}`
const said = (e: unknown): string => (e instanceof Error ? e.message.split('\n')[0] : String(e))

/** Checks 1 to 6 and 8, on the app as it stands. `passes` is how many times letting it settle wrote something. */
export async function standingChecks(world: World, passes: number): Promise<CheckProblem[]> {
  const out: CheckProblem[] = []
  const view = await world.view()
  const fail = (check: CheckName, message: string) => out.push({ check, message: `${CHECKS[check]}. ${message}` })
  /** One of the three Statement checks over every month; the first month that fails says it. */
  const everyMonth = (check: CheckName, run: (m: string) => void) => {
    for (const m of view.months) {
      try {
        run(m)
      } catch (e) {
        fail(check, `${monthName(m)}: ${said(e)}`)
        return
      }
    }
  }
  everyMonth('balanced', (m) => expectBalanced(view.statement(m), m))
  everyMonth('sums', (m) => expectSums(view.statement(m), m))
  everyMonth('adds-up', (m) => expectAddsUp(view.statement(m), view.engine, m))

  const carried = carriedProblems(view)
  if (carried.length) fail('carried', few(carried))

  const unexplained = view.months.flatMap((m) => bridgeOf(view, m).problems)
  if (unexplained.length) fail('explained', few(unexplained))

  const below: string[] = []
  for (const m of view.months) {
    for (const line of all(view.statement(m))) if (line.kind === 'pool' && line.amount < 0) below.push(`"${line.label}" shows ${moneyText(line.amount)} in ${monthName(m)}.`)
    for (const [id, series] of Object.entries(view.engine.pools)) {
      const r = series.months[m]
      if (r && r.balance < 0) below.push(`"${view.tables.pools.find((p) => p.id === id)?.name ?? id}" holds ${moneyText(r.balance)} in ${monthName(m)}.`)
    }
  }
  if (below.length) fail('virtual-accounts', few(below))

  if (passes > 1) fail('settled', `The schedules were posted ${passes} times before nothing changed any more.`)
  return out
}

/** Checks 7 and 9, once the scenario has run. They leave the app as they found it. */
export async function closingChecks(world: World): Promise<CheckProblem[]> {
  const out: CheckProblem[] = []
  const fail = (check: CheckName, message: string) => out.push({ check, message: `${CHECKS[check]}. ${message}` })
  const now = await world.figures()
  if (!now) return out

  // 9: what is exported is everything; an empty app that imports it shows the same, and has nothing left to settle
  const file = parseExportFile(JSON.parse(JSON.stringify(await exportSnapshot(world.store))))
  const fresh = world.open()
  await importReplace(fresh, file)
  const there = await world.view(fresh)
  const differs = diffFigures(now, there.figures)
  if (differs.length) fail('round-trip', few(differs))
  else if ((await postRecurring(fresh, there.months)) > 0) fail('round-trip', 'The app that imported the data posted schedules again, though the exported plan was at rest.')

  // 7: the last thing the user did, taken back and done again
  const last = world.lastAction
  if (last && last.stamp === world.stamp && world.store.canUndo) {
    await world.store.undo()
    await world.settle()
    const undone = diffFigures(last.before, (await world.view()).figures)
    if (undone.length) fail('undo', few(undone))
    await world.store.redo()
    await world.settle()
    const redone = diffFigures(last.after, (await world.view()).figures)
    if (redone.length) fail('undo', `Redo does not bring the action back: ${few(redone)}`)
  }
  return out
}
