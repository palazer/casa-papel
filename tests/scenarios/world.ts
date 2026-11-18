import { vi } from 'vitest'
import { buildStatement, computeEngine, type EngineOutput, type Statement } from '@/engine'
import { newId, type Account, type Category, type Entity, type Household, type MonthKey, type Pool, type Row, type Tables } from '@/model'
import { CasaDb, Store, defaultMonths, keepHouse, loadTables, type Mutation } from '@/store'
import { figuresOf, type Figures } from './figures'
import { monthName } from './registry'

/** A mistake in a scenario itself (a name that does not exist, a step used the wrong way). Never excused as a finding. */
export class ScenarioError extends Error {}

/** What the app shows right now: the stored data, the months it plans today, and every figure worked out from them. */
export interface View {
  tables: Tables
  household: Household
  /** The months the app plans, given today's date. */
  months: MonthKey[]
  engine: EngineOutput
  statement(month: MonthKey): Statement
  figures: Figures
}

/**
 * One scenario's app: an empty in-memory database, a date, and the store the screens use. Steps call the same store
 * functions the dialogs call; after each step the runner lets the app settle (`settle`), as the running app does.
 */
export class World {
  store: Store
  /** Today as the scenario set it (YYYY-MM-DD); null until a step says, or a household is made. */
  day: string | null = null
  /** What the last "When" was refused with; the next step has to be the one that expects it. */
  refusal: string | null = null
  /** The figures before the last "When": what "nothing has changed" is measured against. */
  mark: Figures | null = null
  /** The last step that saved exactly one thing the user can undo: the figures before and after it, and the app's state then (`stamp`). */
  lastAction: { before: Figures; after: Figures; stamp: string } | null = null
  /** What the app said after the last action that says something (a restore): the sentence the screen shows. */
  said: string | null = null
  /** The month of the last "net worth changes by …" step: what "of that, … is …" speaks of. */
  bridgeMonth: MonthKey | null = null
  /** A second device of the same household, once a scenario has one: see the steps "a second device that has synced". */
  second: Store | null = null
  /** How many undoable saves the step that is running has made so far, per device. */
  private saves = new Map<Store, number>()
  private stores: Store[] = []
  /** Counts what was written past the store's own saves (a merged file): see `touch`. */
  private touched = 0
  private cache = new Map<Store, { key: string; view: View }>()

  constructor() {
    this.store = this.open()
  }

  /** A new empty app. The scenario moves into it when it imports its data there. */
  open(): Store {
    const store = new Store(new CasaDb(`scenario-${newId()}`))
    // count what the user could undo, without changing what a save does
    const commit = store.commit.bind(store)
    store.commit = async (mutations: Mutation[]) => {
      this.saves.set(store, (this.saves.get(store) ?? 0) + 1)
      return commit(mutations)
    }
    this.stores.push(store)
    return store
  }

  use(store: Store): void {
    this.store = store
    this.lastAction = null
  }

  /** How many undoable saves the running step has made on the device the scenario is on. */
  get commits(): number {
    return this.saves.get(this.store) ?? 0
  }

  /** A new step begins: nothing saved yet. */
  resetCommits(): void {
    this.saves.clear()
  }

  /** What the app's state is, to tell whether a step changed anything: what is stored, and the date. */
  get stamp(): string {
    return `${this.stores.indexOf(this.store)}|${this.store.getVersion()}|${this.touched}|${this.day}`
  }

  /** Say that the stored data changed without a save of the store: merging a file writes straight into the database. */
  touch(): void {
    this.touched += 1
  }

  /** Give the scenario its day. Only the date is replaced (and it stands still); timers stay real for the database. */
  setToday(day: string): void {
    this.day = day
    vi.setSystemTime(new Date(`${day}T12:00:00`))
  }

  get today(): string {
    if (!this.day) throw new ScenarioError('The scenario has no date yet: say "Given today is 15 March 2026", or make the household first.')
    return this.day
  }

  /** The current calendar month. */
  get thisMonth(): MonthKey {
    return this.today.slice(0, 7)
  }

  /** What the app shows; of another store when one is given (the empty app an export was imported into). */
  async view(store: Store = this.store): Promise<View> {
    const key = `${store.getVersion()}|${this.touched}|${this.today}`
    const cached = this.cache.get(store)
    if (cached?.key === key) return cached.view
    const tables = await loadTables(store)
    const household = tables.household.find((h) => !h.deletedAt)
    if (!household) throw new ScenarioError('There is no household yet: start with "Given a household in EUR that starts in January 2026".')
    const months = defaultMonths(household, tables, this.thisMonth)
    const engine = computeEngine({ tables, months })
    const statements = new Map<MonthKey, Statement>()
    const view: View = {
      tables, household, months, engine,
      figures: figuresOf(tables, engine),
      statement: (month) => {
        let s = statements.get(month)
        if (!s) {
          const built = months.includes(month) ? buildStatement(tables, engine, month) : null
          if (!built) throw new ScenarioError(`${monthName(month)} is not in the plan (${monthName(months[0])} to ${monthName(months.at(-1)!)}).`)
          statements.set(month, (s = built))
        }
        return s
      },
    }
    this.cache.set(store, { key, view })
    return view
  }

  /**
   * Let the app come to rest, as the running app does after every change: its own pass over the data (`App.tsx`,
   * `planHousekeeping`). Returns how many passes wrote something; more than one means it did not settle at once.
   */
  async settle(): Promise<number> {
    let passes = 0
    for (let i = 0; i < 6; i++) {
      if ((await keepHouse(this.store)) === 0) return passes
      passes += 1
    }
    return passes
  }

  // ---------- finding things by the name the scenario uses ----------

  private pick<T extends { name: string; deletedAt: number | null }>(list: T[], name: string, what: string): T {
    const found = list.filter((x) => !x.deletedAt && x.name === name)
    if (found.length === 1) return found[0]
    const names = list.filter((x) => !x.deletedAt).map((x) => `"${x.name}"`).join(', ') || 'none'
    throw new ScenarioError(found.length ? `There are ${found.length} ${what}s called "${name}".` : `There is no ${what} called "${name}". There are: ${names}.`)
  }

  async row(name: string): Promise<Row> {
    return this.pick((await this.view()).tables.rows, name, 'row')
  }

  async account(name: string): Promise<Account> {
    return this.pick((await this.view()).tables.accounts, name, 'account')
  }

  async pool(name: string): Promise<Pool> {
    return this.pick((await this.view()).tables.pools, name, 'virtual account')
  }

  async entity(name: string): Promise<Entity> {
    return this.pick((await this.view()).tables.entities, name, 'person or thing')
  }

  async category(name: string): Promise<Category> {
    return this.pick((await this.view()).tables.categories, name, 'category')
  }

  /** The figures as they stand, or null while there is no household to work them out for. */
  async figures(): Promise<Figures | null> {
    const tables = await loadTables(this.store)
    return tables.household.some((h) => !h.deletedAt) && this.day ? (await this.view()).figures : null
  }

  /** Close the databases the scenario opened. */
  dispose(): void {
    for (const s of this.stores) s.db.close()
  }
}
