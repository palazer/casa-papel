import { generateNKeysBetween } from 'fractional-indexing'
import { TablesSchema, poolRef, type Tables } from '@/model'

/**
 * A fictional household used for screenshots, tests and the ?demo=1 sandbox.
 * Nothing here is real. Ids are deterministic so fixtures stay stable.
 */
const T0 = Date.UTC(2026, 8, 1) // 2026-09-01

function id(n: number): string {
  return `0DEM0${String(n).padStart(21, '0')}`
}

const ID = {
  household: id(1),
  sam: id(10), alex: id(11), robin: id(12), biscuit: id(13), car: id(14), flat: id(15),
  main: id(20), joint: id(21), savings: id(22), invest: id(23), card: id(24),
  catHousing: id(30), catLiving: id(31), catTransport: id(32), catFamily: id(33), catFun: id(34), catPersonal: id(35), catTransfers: id(36),
  rowSamSalary: id(40), rowAlexSalary: id(41), rowChildBenefit: id(42), rowOtherIncome: id(43),
  rowRent: id(50), rowUtilities: id(51), rowGroceries: id(52), rowTransport: id(53), rowCarInsurance: id(54),
  rowDog: id(55), rowChildcare: id(56), rowSubscriptions: id(57), rowHealth: id(58), rowSamPersonal: id(59),
  rowAlexPersonal: id(60), rowTravel: id(61), rowClothing: id(62),
  rowToSavings: id(70), rowToInvestment: id(71), rowTravelAlloc: id(72), rowClothingAlloc: id(73),
  rowPocketSam: id(74), rowPocketAlex: id(75),
  poolTravel: id(80), poolClothing: id(81),
  recRent: id(90), recCarInsurance: id(91), recStreaming: id(92), recDogTax: id(93),
}

type Status = 'projected' | 'committed' | 'done'

const ORDER_KEYS = generateNKeysBetween(null, null, 200)
let orderCursor = 0
/** Sequential, valid fractional-index keys; the literal hints only document intent. */
const base = (recordId: string, _hint: string) => ({ id: recordId, createdAt: T0, updatedAt: T0, deletedAt: null, order: ORDER_KEYS[orderCursor++ % ORDER_KEYS.length] })

/** A plain value cell. Status is carried by the row default; items stay empty. */
const value = (rowId: string, month: string, amount: number) => ({
  rowId, month, mode: 'value', value: amount, updatedAt: T0, items: [],
})

/** An itemized cell with deterministic item ids. */
const items = (rowId: string, month: string, list: Array<[string, number, Status]>, fundedBy: string = 'cash') => ({
  rowId, month, mode: 'items', updatedAt: T0,
  items: list.map(([label, amount, status], i) => ({
    id: id(2000 + hash(rowId + month) * 10 + i), label, amount, status, fundedBy, kind: 'normal',
  })),
})

function hash(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 100_000
  return h
}

export function buildDemoTables(): Tables {
  orderCursor = 0
  const rows = [
    // income
    { ...base(ID.rowSamSalary, 'a0'), name: 'Sam – Salary', section: 'income', kind: 'salary', scope: ID.sam, inShareBasis: true, defaultStatus: 'committed' },
    { ...base(ID.rowAlexSalary, 'a1'), name: 'Alex – Salary', section: 'income', kind: 'salary', scope: ID.alex, inShareBasis: true, defaultStatus: 'committed' },
    { ...base(ID.rowChildBenefit, 'a2'), name: 'Child benefit', section: 'income', scope: ID.robin, entityTags: [ID.robin], defaultStatus: 'committed' },
    { ...base(ID.rowOtherIncome, 'a3'), name: 'Other income', section: 'income' },
    // expenses
    { ...base(ID.rowRent, 'b0'), name: 'Rent', section: 'expense', categoryId: ID.catHousing, entityTags: [ID.flat], accountId: ID.main, defaultStatus: 'committed' },
    { ...base(ID.rowUtilities, 'b1'), name: 'Utilities', section: 'expense', categoryId: ID.catHousing, entityTags: [ID.flat], accountId: ID.main },
    { ...base(ID.rowGroceries, 'b2'), name: 'Groceries', section: 'expense', categoryId: ID.catLiving, accountId: ID.joint },
    { ...base(ID.rowTransport, 'b3'), name: 'Public transport', section: 'expense', categoryId: ID.catTransport, accountId: ID.main },
    { ...base(ID.rowCarInsurance, 'b4'), name: 'Car insurance', section: 'expense', categoryId: ID.catTransport, entityTags: [ID.car], accountId: ID.main, defaultStatus: 'committed' },
    { ...base(ID.rowDog, 'b5'), name: 'Biscuit (dog)', section: 'expense', categoryId: ID.catFamily, entityTags: [ID.biscuit], accountId: ID.main },
    { ...base(ID.rowChildcare, 'b6'), name: 'Childcare', section: 'expense', categoryId: ID.catFamily, entityTags: [ID.robin], scope: ID.robin, accountId: ID.main, defaultStatus: 'committed' },
    { ...base(ID.rowSubscriptions, 'b7'), name: 'Subscriptions', section: 'expense', categoryId: ID.catFun, accountId: ID.card },
    { ...base(ID.rowHealth, 'b8'), name: 'Health', section: 'expense', categoryId: ID.catLiving, accountId: ID.main },
    { ...base(ID.rowSamPersonal, 'b9'), name: 'Sam – Personal', section: 'expense', categoryId: ID.catPersonal, scope: ID.sam, accountId: ID.main },
    { ...base(ID.rowAlexPersonal, 'ba'), name: 'Alex – Personal', section: 'expense', categoryId: ID.catPersonal, scope: ID.alex, accountId: ID.main },
    { ...base(ID.rowTravel, 'bb'), name: 'Travel', section: 'expense', categoryId: ID.catFun, defaultFundedBy: poolRef(ID.poolTravel) },
    { ...base(ID.rowClothing, 'bc'), name: 'Clothing', section: 'expense', categoryId: ID.catFun, defaultFundedBy: poolRef(ID.poolClothing) },
    // transfers
    { ...base(ID.rowToSavings, 'c0'), name: 'To savings', section: 'transfer', kind: 'to-savings', categoryId: ID.catTransfers, accountId: ID.savings, defaultStatus: 'committed' },
    { ...base(ID.rowToInvestment, 'c1'), name: 'To investments', section: 'transfer', kind: 'to-investment', categoryId: ID.catTransfers, accountId: ID.invest, defaultStatus: 'committed' },
    { ...base(ID.rowTravelAlloc, 'c2'), name: 'Travel pool', section: 'transfer', kind: 'pool-allocation', categoryId: ID.catTransfers, accountId: ID.savings, defaultStatus: 'committed' },
    { ...base(ID.rowClothingAlloc, 'c3'), name: 'Clothing pool', section: 'transfer', kind: 'pool-allocation', categoryId: ID.catTransfers, accountId: ID.savings, defaultStatus: 'committed' },
    { ...base(ID.rowPocketSam, 'c4'), name: 'Pocket – Sam', section: 'transfer', kind: 'pocket-money', categoryId: ID.catTransfers, scope: ID.sam, pocketMode: 'share-of-pocket-total', pocketShare: 0.5, defaultStatus: 'committed' },
    { ...base(ID.rowPocketAlex, 'c5'), name: 'Pocket – Alex', section: 'transfer', kind: 'pocket-money', categoryId: ID.catTransfers, scope: ID.alex, pocketMode: 'share-of-pocket-total', pocketShare: 0.5, defaultStatus: 'committed' },
  ]

  const cells = [
    // September 2026 (closed)
    value(ID.rowSamSalary, '2026-09', 420000), value(ID.rowAlexSalary, '2026-09', 280000), value(ID.rowChildBenefit, '2026-09', 25500),
    value(ID.rowRent, '2026-09', 165000), value(ID.rowUtilities, '2026-09', 21000), value(ID.rowGroceries, '2026-09', 72000),
    value(ID.rowTransport, '2026-09', 9800), value(ID.rowDog, '2026-09', 6500), value(ID.rowChildcare, '2026-09', 38000),
    value(ID.rowSubscriptions, '2026-09', 4200), value(ID.rowHealth, '2026-09', 3000),
    items(ID.rowSamPersonal, '2026-09', [['Concert tickets', 9000, 'done'], ['Books', 3200, 'done']]),
    items(ID.rowAlexPersonal, '2026-09', [['Gym', 4000, 'done']]),
    value(ID.rowToInvestment, '2026-09', 50000), value(ID.rowTravelAlloc, '2026-09', 20000), value(ID.rowClothingAlloc, '2026-09', 10000),
    // October 2026
    value(ID.rowSamSalary, '2026-10', 420000), value(ID.rowAlexSalary, '2026-10', 280000), value(ID.rowChildBenefit, '2026-10', 25500),
    value(ID.rowGroceries, '2026-10', 70000), value(ID.rowTransport, '2026-10', 9800),
    items(ID.rowTravel, '2026-10', [['Weekend in Lisbon', 48000, 'done']], poolRef(ID.poolTravel)),
    items(ID.rowSamPersonal, '2026-10', [['Running shoes', 11000, 'done']]),
    value(ID.rowToInvestment, '2026-10', 50000), value(ID.rowTravelAlloc, '2026-10', 20000), value(ID.rowClothingAlloc, '2026-10', 10000),
    // November 2026 (current)
    items(ID.rowOtherIncome, '2026-11', [['Sold old bike', 15000, 'projected']]),
    items(ID.rowClothing, '2026-11', [['Winter coat', 18000, 'projected']], poolRef(ID.poolClothing)),
  ]

  const tables = {
    household: [{
      ...base(ID.household, 'a0'), name: 'Demo household', baseCurrency: 'EUR', locale: 'en-IE', startMonth: '2026-09',
      closingRule: 'savings-plug', pocketTotal: 100000, cashBuffer: 0, moneyMode: 'pooled', shareBasis: 'basis-rows',
      manualShares: {}, displayExpensesNegative: true, fxDriftDefault: 0, fxMonthRate: 'last',
    }],
    entities: [
      { ...base(ID.sam, 'a0'), kind: 'adult', name: 'Sam', attributes: {}, paidBy: null },
      { ...base(ID.alex, 'a1'), kind: 'adult', name: 'Alex', attributes: {}, paidBy: null },
      { ...base(ID.robin, 'a2'), kind: 'child', name: 'Robin', attributes: { born: '2021' }, paidBy: ID.alex },
      { ...base(ID.biscuit, 'a3'), kind: 'pet', name: 'Biscuit', attributes: { species: 'dog' }, paidBy: null },
      { ...base(ID.car, 'a4'), kind: 'vehicle', name: 'The car', attributes: {}, paidBy: null },
      { ...base(ID.flat, 'a5'), kind: 'property', name: 'The flat', attributes: { tenure: 'rent' }, paidBy: null },
    ],
    accounts: [
      { ...base(ID.main, 'a0'), name: 'Main account', type: 'checking', currency: 'EUR', ownerEntityId: null, openingBalance: 0, openingMonth: '2026-09', tracked: false },
      { ...base(ID.joint, 'a1'), name: 'Joint account', type: 'joint', currency: 'EUR', ownerEntityId: null, openingBalance: 0, openingMonth: '2026-09', tracked: false },
      { ...base(ID.savings, 'a2'), name: 'Savings', type: 'savings', currency: 'EUR', ownerEntityId: null, openingBalance: 800000, openingMonth: '2026-09', tracked: true },
      {
        ...base(ID.invest, 'a3'), name: 'Index fund', type: 'investment', currency: 'EUR', ownerEntityId: null, openingBalance: 1200000, openingMonth: '2026-09', tracked: true,
        investment: { projectionMode: 'fixed-rate', annualRate: 0.05, depositTiming: 'start', depositFxMode: 'monthly-rate', fixedRate: null },
      },
      { ...base(ID.card, 'a4'), name: 'Credit card', type: 'credit-card', currency: 'EUR', ownerEntityId: ID.sam, openingBalance: 0, openingMonth: '2026-09', tracked: true, card: { cardMode: 'itemized' } },
    ],
    accountMonths: [
      { accountId: ID.invest, month: '2026-09', actualBalance: 1262000, actualDeposit: null, actualSpend: null, note: '', updatedAt: T0 },
    ],
    categories: [
      { ...base(ID.catHousing, 'a0'), name: 'Housing', section: 'expense' },
      { ...base(ID.catLiving, 'a1'), name: 'Living', section: 'expense' },
      { ...base(ID.catTransport, 'a2'), name: 'Transport', section: 'expense' },
      { ...base(ID.catFamily, 'a3'), name: 'Family & pets', section: 'expense' },
      { ...base(ID.catFun, 'a4'), name: 'Fun', section: 'expense' },
      { ...base(ID.catPersonal, 'a5'), name: 'Personal', section: 'expense' },
      { ...base(ID.catTransfers, 'a6'), name: 'Transfers', section: 'transfer' },
    ],
    rows,
    cells,
    recurringItems: [
      { ...base(ID.recRent, 'a0'), name: 'Rent', rowId: ID.rowRent, amount: 165000, cadence: { intervalMonths: 1, anchorMonth: 1 }, accountId: ID.main, startMonth: '2026-09', notes: 'Due on the 1st' },
      { ...base(ID.recCarInsurance, 'a1'), name: 'Car insurance', rowId: ID.rowCarInsurance, amount: 21000, cadence: { intervalMonths: 3, anchorMonth: 1 }, accountId: ID.main, startMonth: '2026-09', notes: 'Quarterly: Jan, Apr, Jul, Oct' },
      { ...base(ID.recStreaming, 'a2'), name: 'Streaming', rowId: ID.rowSubscriptions, amount: 1800, cadence: { intervalMonths: 1, anchorMonth: 1 }, accountId: ID.card, startMonth: '2026-09', notes: '' },
      { ...base(ID.recDogTax, 'a3'), name: 'Dog tax', rowId: ID.rowDog, amount: 12000, cadence: { intervalMonths: 12, anchorMonth: 3 }, accountId: ID.main, startMonth: '2026-09', notes: 'Yearly in March' },
    ],
    pools: [
      { ...base(ID.poolTravel, 'a0'), name: 'Travel', accountId: ID.savings, allocationRowId: ID.rowTravelAlloc, openingBalance: 60000 },
      { ...base(ID.poolClothing, 'a1'), name: 'Clothing', accountId: ID.savings, allocationRowId: ID.rowClothingAlloc, openingBalance: 15000 },
    ],
    fxRates: [],
    monthStates: [
      { month: '2026-09', closed: true, closedAt: Date.UTC(2026, 9, 2), pocketTotalOverride: null, cashBufferOverride: null, updatedAt: T0 },
    ],
  }
  return TablesSchema.parse(tables)
}

export const DEMO_IDS = ID
