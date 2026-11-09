/**
 * Pure mapping from the v1 workbook's register sheets to a Casa Papel export file.
 * No I/O here so it can be unit-tested with synthetic rows; the CLI in
 * scripts/import-v1-register.ts reads the workbook and calls mapV1.
 */
import { generateNKeysBetween } from 'fractional-indexing'
import {
  AccountSchema, EntitySchema, ExportFileSchema, HouseholdSchema, PoolSchema, RecurringItemSchema, RowSchema, SCHEMA_VERSION,
  EMPTY_TABLES, newId, poolRef, toMinor,
  type Account, type AccountType, type Entity, type ExportFile, type MonthKey, type RecurringItem, type Row, type Section,
} from '../../src/model'

export interface RegisterLine { name: string; category: string; amount: number; from: string; notes: string }
export interface JointLine { category: string; amount: number; account: string }
export interface SavingLine { purpose: string; category: string; amount: number; account: string; notes: string }

export interface V1Input {
  householdName: string
  startMonth: MonthKey
  pocketTotal?: number
  locale?: string
  expenses: RegisterLine[]
  joint: JointLine[]
  savings: SavingLine[]
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

export interface ParsedCadence { intervalMonths: 3 | 6 | 12; anchorMonth: number; amount: number; currency: string }

/** "Quarterly (Jan-Apr-Jul-Oct) = 420", "Yearly (Sep) = 699 TL", "Half-yearly (Mar, Sep) = 100" */
export function parseCadenceNote(notes: string): ParsedCadence | null {
  const m = /(quarterly|yearly|annual(?:ly)?|half-?yearly|bi-?quarterly)\s*\(([^)]*)\)\s*=\s*([\d.,]+)\s*([A-Za-z]{2,3})?/i.exec(notes)
  if (!m) return null
  const word = m[1].toLowerCase()
  const intervalMonths: 3 | 6 | 12 = word.startsWith('quarter') ? 3 : word.startsWith('year') || word.startsWith('annual') ? 12 : 6
  const first = m[2].split(/[-,/\s]+/).map((s) => s.trim().slice(0, 3).toLowerCase()).find((s) => MONTHS.includes(s))
  const anchorMonth = first ? MONTHS.indexOf(first) + 1 : 1
  const amount = Number(m[3].replace(',', '.'))
  const unit = (m[4] ?? '').toUpperCase()
  const currency = unit === 'TL' ? 'TRY' : unit.length === 3 ? unit : 'EUR'
  return { intervalMonths, anchorMonth, amount, currency }
}

/** "Erkin - N26 Metal" → owner Erkin, account "N26 Metal". Cards are recognised by name. */
export function parseAccount(from: string): { owner: string | null; name: string; type: AccountType } {
  const [a, b] = from.split(/\s[-–]\s/).map((s) => s.trim())
  const name = b ?? a
  const owner = b ? a : null
  const type: AccountType = /amex|visa|mastercard|\bcc\b|credit|ykb|world/i.test(name) ? 'credit-card' : 'checking'
  return { owner, name, type }
}

const CATEGORY_ROW: Record<string, string> = {
  accomodation: 'Rent', accommodation: 'Rent', transportation: 'Transport', insurance: 'Insurance', membership: 'Memberships',
  subscription: 'Subscriptions', utility: 'Utilities', tax: 'Tax',
}
const SKIP_CATEGORIES = new Set(['one-time fee', 'cancelled'])

export function mapV1(input: V1Input): ExportFile {
  const ts = Date.now()
  const base = () => ({ id: newId(), createdAt: ts, updatedAt: ts, deletedAt: null })
  const start = input.startMonth
  const household = HouseholdSchema.parse({
    ...base(), name: input.householdName, baseCurrency: 'EUR', locale: input.locale ?? 'de-DE', startMonth: start,
    closingRule: 'savings-plug', moneyMode: 'pooled', pocketTotal: Math.round((input.pocketTotal ?? 0) * 100),
  })

  // --- people and things, inferred from the register
  const ownerNames = new Set<string>()
  for (const l of input.expenses) { const o = parseAccount(l.from).owner; if (o) ownerNames.add(o) }
  const adultNames = [...ownerNames].filter((n) => !/dog|hund|cat/i.test(n))
  const entities: Entity[] = []
  const eOrders = generateNKeysBetween(null, null, 16)
  let eo = 0
  const addEntity = (kind: Entity['kind'], name: string, paidBy: string | null = null) => {
    const e = EntitySchema.parse({ ...base(), kind, name, paidBy, order: eOrders[eo++ % eOrders.length] })
    entities.push(e)
    return e
  }
  const adults = adultNames.map((n) => addEntity('adult', n))
  const adultByName = new Map(adults.map((a) => [a.name.toLowerCase(), a]))
  const hasDog = input.expenses.some((l) => /dog|hund|tier/i.test(l.name)) ; const dog = hasDog ? addEntity('pet', 'Dog') : null
  const vehicles = new Map<string, Entity>()
  for (const l of [...input.expenses.map((x) => x.name), ...input.joint.map((x) => x.category)]) {
    const v = /volvo|tesla|bmw|audi|vw|toyota|renault|skoda|ford|opel|peugeot|fiat|hyundai|kia/i.exec(l)?.[0]
    if (v && !vehicles.has(v.toLowerCase())) vehicles.set(v.toLowerCase(), addEntity('vehicle', v[0].toUpperCase() + v.slice(1)))
  }
  const rentLine = input.expenses.find((l) => /rent/i.test(l.name))
  const home = addEntity('property', /\(([^)]+)\)/.exec(rentLine?.name ?? '')?.[1] ?? 'Home')
  const childLine = input.savings.find((l) => /kindergeld|child/i.test(l.purpose + l.notes))
  const childName = /^([A-Z][a-z]+)\s+LT/i.exec(childLine?.category ?? '')?.[1]
  const child = childLine ? addEntity('child', childName ?? 'Child', null) : null

  // --- accounts
  const accounts: Account[] = []
  const accByName = new Map<string, Account>()
  const aOrders = generateNKeysBetween(null, null, 24)
  let ao = 0
  const ensureAccount = (name: string, type: AccountType, owner: string | null) => {
    const key = name.toLowerCase()
    const existing = accByName.get(key)
    if (existing) return existing
    const a = AccountSchema.parse({
      ...base(), name, type, currency: 'EUR', openingMonth: start, openingBalance: 0,
      tracked: ['savings', 'investment', 'credit-card', 'loan'].includes(type),
      ownerEntityId: owner ? adultByName.get(owner.toLowerCase())?.id ?? null : null, order: aOrders[ao++ % aOrders.length],
    })
    accounts.push(a)
    accByName.set(key, a)
    return a
  }
  for (const l of input.expenses) if (l.from) { const p = parseAccount(l.from); ensureAccount(p.owner ? `${p.name} (${p.owner})` : p.name, p.type, p.owner) }
  for (const l of input.joint) if (l.account) ensureAccount(l.account, 'joint', null)
  for (const l of input.savings) if (l.account) ensureAccount(l.account, /etoro|invest|depot|broker|nsdq|etf/i.test(l.account) ? 'investment' : 'savings', parseAccount(l.account).owner)
  const savings = accounts.find((a) => a.type === 'savings') ?? ensureAccount('Savings', 'savings', null)

  // --- rows and recurring items
  const rows: Row[] = []
  const items: RecurringItem[] = []
  const rowByKey = new Map<string, Row>()
  const rOrders = generateNKeysBetween(null, null, 200)
  let ro = 0
  const ensureRow = (key: string, init: Partial<Row> & { name: string; section: Section }) => {
    const existing = rowByKey.get(key)
    if (existing) return existing
    const r = RowSchema.parse({ ...base(), defaultStatus: 'committed', ...init, order: rOrders[ro++ % rOrders.length] })
    rows.push(r)
    rowByKey.set(key, r)
    return r
  }
  const addItem = (row: Row, name: string, amountMajor: number, currency: string, extra: Partial<RecurringItem> = {}) => {
    items.push(RecurringItemSchema.parse({ ...base(), name, rowId: row.id, amount: toMinor(amountMajor, currency), currency: currency === 'EUR' ? null : currency, startMonth: start, ...extra }))
  }

  for (const l of input.expenses) {
    if (!l.name || SKIP_CATEGORIES.has(l.category.toLowerCase()) || /cancel/i.test(l.notes)) continue
    const cad = parseCadenceNote(l.notes)
    const amount = cad ? cad.amount : l.amount
    if (!amount) continue
    const currency = cad?.currency ?? 'EUR'
    const personal = adultByName.get(l.category.toLowerCase())
    const scopedTo = /\(([A-Z][a-z]+)\)/.exec(l.name)?.[1]
    const scope = personal ? personal.id : scopedTo && adultByName.get(scopedTo.toLowerCase()) ? adultByName.get(scopedTo.toLowerCase())!.id : 'shared'
    const tags: string[] = []
    if (dog && /dog|hund|tier/i.test(l.name)) tags.push(dog.id)
    for (const [k, v] of vehicles) if (new RegExp(k, 'i').test(l.name) || /car |parking|kfz/i.test(l.name) && k === 'volvo') tags.push(v.id)
    if (/rent|miete/i.test(l.name)) tags.push(home.id)
    const rowName = personal ? `${personal.name} – Personal` : (CATEGORY_ROW[l.category.toLowerCase()] ?? l.category)
    const row = ensureRow(`${rowName}|${currency}`, { name: currency === 'EUR' ? rowName : `${rowName} (${currency})`, section: 'expense', currency: currency === 'EUR' ? null : currency, scope: personal ? personal.id : 'shared' })
    const acc = l.from ? parseAccount(l.from) : null
    const account = acc ? accByName.get((acc.owner ? `${acc.name} (${acc.owner})` : acc.name).toLowerCase()) : undefined
    addItem(row, l.name, amount, currency, {
      cadence: cad ? { intervalMonths: cad.intervalMonths, anchorMonth: cad.anchorMonth } : { intervalMonths: 1, anchorMonth: 1 },
      accountId: account?.id ?? null, scope, notes: l.notes,
    })
    if (tags.length && !row.entityTags.length) row.entityTags = [...new Set(tags)]
  }

  for (const l of input.joint) {
    if (!l.category || !l.amount) continue
    const vehicle = [...vehicles.entries()].find(([k]) => new RegExp(k, 'i').test(l.category))?.[1]
    const row = ensureRow(`${l.category}|EUR`, { name: l.category, section: 'expense', entityTags: vehicle ? [vehicle.id] : [], defaultStatus: 'projected' })
    addItem(row, `${l.category} (joint)`, l.amount, 'EUR', { cadence: { intervalMonths: 1, anchorMonth: 1 }, accountId: accByName.get(l.account.toLowerCase())?.id ?? null })
  }

  ensureRow('to-savings', { name: 'To savings', section: 'transfer', kind: 'to-savings', accountId: savings.id })
  const pools = []
  for (const l of input.savings) {
    if (!l.purpose) continue
    const cat = l.category.toLowerCase()
    if (cat === 'saving') {
      if (/travel|holiday|urlaub|tatil/i.test(l.purpose)) {
        const pool = PoolSchema.parse({ ...base(), name: 'Travel', accountId: savings.id, openingBalance: 0, order: 'a0' })
        const alloc = ensureRow('pool-travel-alloc', { name: 'Travel pool', section: 'transfer', kind: 'pool-allocation', accountId: savings.id })
        pool.allocationRowId = alloc.id
        pools.push(pool)
        ensureRow('pool-travel', { name: 'Travel', section: 'expense', defaultFundedBy: poolRef(pool.id), defaultStatus: 'projected' })
        if (l.amount) addItem(alloc, 'Travel pool', l.amount, 'EUR', { cadence: { intervalMonths: 1, anchorMonth: 1 }, accountId: savings.id })
      }
      continue
    }
    const account = accByName.get(l.account.toLowerCase())
    if (child && /lt\b|long|kindergeld/i.test(l.category + l.notes)) {
      const row = ensureRow('child-lt', { name: `${child.name} – Long-term savings`, section: 'transfer', kind: 'to-investment', accountId: account?.id ?? null, scope: child.id, entityTags: [child.id] })
      addItem(row, l.purpose, l.amount, 'EUR', { cadence: { intervalMonths: 1, anchorMonth: 1 }, accountId: account?.id ?? null, scope: child.id })
      if (/kindergeld/i.test(l.purpose + l.notes)) {
        const income = ensureRow('kindergeld', { name: 'Kindergeld', section: 'income', scope: child.id, entityTags: [child.id] })
        addItem(income, 'Kindergeld', l.amount, 'EUR', { cadence: { intervalMonths: 1, anchorMonth: 1 }, scope: child.id })
      }
      continue
    }
    const row = ensureRow('to-investments', { name: 'To investments', section: 'transfer', kind: 'to-investment', accountId: account?.id ?? null })
    if (l.amount) addItem(row, l.purpose, l.amount, 'EUR', { cadence: { intervalMonths: 1, anchorMonth: 1 }, accountId: account?.id ?? null })
  }
  for (const a of adults) {
    ensureRow(`salary-${a.id}`, { name: `${a.name} – Salary`, section: 'income', kind: 'salary', scope: a.id, inShareBasis: true, entityTags: [a.id] })
    ensureRow(`pocket-${a.id}`, { name: `${a.name} – Pocket`, section: 'transfer', kind: 'pocket-money', scope: a.id, pocketMode: 'share-of-pocket-total', pocketShare: 1 / adults.length })
  }
  ensureRow('other', { name: 'Other', section: 'expense', defaultStatus: 'projected' })

  return ExportFileSchema.parse({
    format: 'casa-papel', schemaVersion: SCHEMA_VERSION, exportedAt: ts, deviceId: 'import-v1',
    tables: { ...EMPTY_TABLES, household: [household], entities, accounts, rows, recurringItems: items, pools },
    events: [],
  })
}
