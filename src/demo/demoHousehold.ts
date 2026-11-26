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
  main: id(20), savings: id(22), invest: id(23), card: id(24),
  catHousing: id(30), catLiving: id(31), catTransport: id(32), catFamily: id(33), catFun: id(34), catPersonal: id(35), catTransfers: id(36),
  rowSamSalary: id(40), rowAlexSalary: id(41), rowChildBenefit: id(42), rowOtherIncome: id(43),
  rowRent: id(50), rowUtilities: id(51), rowGroceries: id(52), rowTransport: id(53), rowCarInsurance: id(54),
  rowDog: id(55), rowChildcare: id(56), rowSubscriptions: id(57), rowHealth: id(58), rowSamPersonal: id(59),
  rowAlexPersonal: id(60), rowTravel: id(61), rowClothing: id(62), rowCardPayment: id(63),
  rowToSavings: id(70), rowToInvestment: id(71), rowTravelAlloc: id(72), rowClothingAlloc: id(73),
  rowPocketSam: id(74), rowPocketAlex: id(75),
  poolTravel: id(80), poolClothing: id(81),
  recRent: id(90), recCarInsurance: id(91), recStreaming: id(92), recDogTax: id(93),
  payDebit: id(100), payStanding: id(101), payTransfer: id(102), payCard: id(103),
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

/**
 * A cell of a month that is over and all done: every item ticked. A third entry names the schedule that posted the
 * item, so the month agrees with its schedules and nothing is landed in it a second time.
 */
const paid = (rowId: string, month: string, list: Array<[string, number, string?]>, fundedBy: string = 'cash') => ({
  rowId, month, mode: 'items', updatedAt: T0,
  items: list.map(([label, amount, of], i) => ({
    id: id(2000 + hash(rowId + month) * 10 + i), label, amount, status: 'done', fundedBy, kind: 'normal', recurringItemId: of ?? null,
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
    { ...base(ID.rowSamSalary, 'a0'), name: 'Sam – Salary', section: 'income', kind: 'salary', scope: ID.sam, defaultStatus: 'committed' },
    { ...base(ID.rowAlexSalary, 'a1'), name: 'Alex – Salary', section: 'income', kind: 'salary', scope: ID.alex, defaultStatus: 'committed' },
    { ...base(ID.rowChildBenefit, 'a2'), name: 'Robin – Child benefit', section: 'income', scope: ID.robin, entityTags: [ID.robin], defaultStatus: 'committed' },
    { ...base(ID.rowOtherIncome, 'a3'), name: 'Other income', section: 'income' },
    // expenses
    { ...base(ID.rowRent, 'b0'), name: 'The flat – Rent', section: 'expense', categoryId: ID.catHousing, entityTags: [ID.flat], accountId: ID.main, defaultStatus: 'committed' },
    { ...base(ID.rowUtilities, 'b1'), name: 'The flat – Utilities', section: 'expense', categoryId: ID.catHousing, entityTags: [ID.flat], accountId: ID.main, payDay: 12, payMethodId: ID.payDebit },
    { ...base(ID.rowGroceries, 'b2'), name: 'Groceries', section: 'expense', categoryId: ID.catLiving, accountId: ID.main },
    { ...base(ID.rowTransport, 'b3'), name: 'Public transport', section: 'expense', categoryId: ID.catTransport, accountId: ID.main },
    { ...base(ID.rowCarInsurance, 'b4'), name: 'The car – Insurance', section: 'expense', categoryId: ID.catTransport, entityTags: [ID.car], accountId: ID.main, defaultStatus: 'committed' },
    { ...base(ID.rowDog, 'b5'), name: 'Biscuit – Costs', section: 'expense', categoryId: ID.catFamily, entityTags: [ID.biscuit], accountId: ID.main },
    { ...base(ID.rowChildcare, 'b6'), name: 'Robin – Childcare', section: 'expense', categoryId: ID.catFamily, entityTags: [ID.robin], scope: ID.robin, accountId: ID.main, defaultStatus: 'committed', payDay: 25, payMethodId: ID.payTransfer },
    { ...base(ID.rowSubscriptions, 'b7'), name: 'Subscriptions', section: 'expense', categoryId: ID.catFun, payDay: null, payMethodId: ID.payCard },
    { ...base(ID.rowHealth, 'b8'), name: 'Health', section: 'expense', categoryId: ID.catLiving, accountId: ID.main },
    { ...base(ID.rowSamPersonal, 'b9'), name: 'Sam – Personal', section: 'expense', categoryId: ID.catPersonal, scope: ID.sam, accountId: ID.main },
    { ...base(ID.rowAlexPersonal, 'ba'), name: 'Alex – Personal', section: 'expense', categoryId: ID.catPersonal, scope: ID.alex, accountId: ID.main },
    { ...base(ID.rowTravel, 'bb'), name: 'Travel', section: 'expense', categoryId: ID.catFun, defaultFundedBy: poolRef(ID.poolTravel) },
    { ...base(ID.rowClothing, 'bc'), name: 'Clothing', section: 'expense', categoryId: ID.catFun, defaultFundedBy: poolRef(ID.poolClothing) },
    // Sam carries a debt on the card and pays it down: an expense of the month that brings what is owed down (rule C2)
    { ...base(ID.rowCardPayment, 'bd'), name: 'Credit card – Payment', section: 'expense', kind: 'card-payment', categoryId: ID.catPersonal, scope: ID.sam, accountId: ID.card, defaultStatus: 'committed' },
    // transfers
    { ...base(ID.rowToSavings, 'c0'), name: 'To savings', section: 'transfer', kind: 'to-savings', categoryId: ID.catTransfers, accountId: ID.savings, defaultStatus: 'committed', payDay: 28, payMethodId: ID.payStanding },
    { ...base(ID.rowToInvestment, 'c1'), name: 'To investments', section: 'transfer', kind: 'to-investment', categoryId: ID.catTransfers, accountId: ID.invest, defaultStatus: 'committed' },
    { ...base(ID.rowTravelAlloc, 'c2'), name: 'To Travel', section: 'transfer', kind: 'pool-allocation', categoryId: ID.catTransfers, accountId: ID.savings, defaultStatus: 'committed' },
    { ...base(ID.rowClothingAlloc, 'c3'), name: 'To Clothing', section: 'transfer', kind: 'pool-allocation', categoryId: ID.catTransfers, accountId: ID.savings, defaultStatus: 'committed' },
    { ...base(ID.rowPocketSam, 'c4'), name: 'Sam – Pocket', section: 'transfer', kind: 'pocket-money', categoryId: ID.catTransfers, scope: ID.sam, pocketMode: 'fixed', defaultStatus: 'committed' },
    { ...base(ID.rowPocketAlex, 'c5'), name: 'Alex – Pocket', section: 'transfer', kind: 'pocket-money', categoryId: ID.catTransfers, scope: ID.alex, pocketMode: 'fixed', defaultStatus: 'committed' },
  ]

  const cells = [
    // September 2026: over, and all of it ticked as done ("Count everything in September as done")
    paid(ID.rowSamSalary, '2026-09', [['', 420000]]), paid(ID.rowAlexSalary, '2026-09', [['', 280000]]), paid(ID.rowChildBenefit, '2026-09', [['', 25500]]),
    paid(ID.rowRent, '2026-09', [['Rent', 165000, ID.recRent]]), paid(ID.rowUtilities, '2026-09', [['', 21000]]), paid(ID.rowGroceries, '2026-09', [['', 72000]]),
    paid(ID.rowTransport, '2026-09', [['', 9800]]), paid(ID.rowDog, '2026-09', [['', 6500]]), paid(ID.rowChildcare, '2026-09', [['', 38000]]),
    paid(ID.rowSubscriptions, '2026-09', [['Streaming', 1800, ID.recStreaming], ['Cloud storage', 2400]]), paid(ID.rowHealth, '2026-09', [['', 3000]]),
    items(ID.rowSamPersonal, '2026-09', [['Concert tickets', 4500, 'done'], ['Books', 1700, 'done']]),
    items(ID.rowAlexPersonal, '2026-09', [['Gym', 4000, 'done']]), paid(ID.rowCardPayment, '2026-09', [['', 6000]]),
    paid(ID.rowToInvestment, '2026-09', [['', 50000]]), paid(ID.rowTravelAlloc, '2026-09', [['', 20000]]), paid(ID.rowClothingAlloc, '2026-09', [['', 10000]]),
    // pocket money: a fixed amount per adult, carried forward
    paid(ID.rowPocketSam, '2026-09', [['', 50000]]), paid(ID.rowPocketAlex, '2026-09', [['', 50000]]),
    // the rest that went to savings is worked out, so its tick stands beside it
    { rowId: ID.rowToSavings, month: '2026-09', mode: 'inherit', value: null, items: [], markedDone: true, updatedAt: T0 },
    // October 2026
    value(ID.rowSamSalary, '2026-10', 420000), value(ID.rowAlexSalary, '2026-10', 280000), value(ID.rowChildBenefit, '2026-10', 25500),
    value(ID.rowGroceries, '2026-10', 70000), value(ID.rowTransport, '2026-10', 9800),
    items(ID.rowTravel, '2026-10', [['Weekend in Lisbon', 48000, 'done']], poolRef(ID.poolTravel)),
    items(ID.rowSamPersonal, '2026-10', [['Running shoes', 5000, 'done']]), value(ID.rowCardPayment, '2026-10', 6000),
    value(ID.rowToInvestment, '2026-10', 50000), value(ID.rowTravelAlloc, '2026-10', 20000), value(ID.rowClothingAlloc, '2026-10', 10000),
    // November 2026 (current)
    items(ID.rowOtherIncome, '2026-11', [['Sold old bike', 15000, 'projected']]),
    items(ID.rowClothing, '2026-11', [['Winter coat', 18000, 'projected']], poolRef(ID.poolClothing)),
  ]

  const tables = {
    household: [{
      ...base(ID.household, 'a0'), name: 'Demo household', baseCurrency: 'EUR', locale: 'en-IE', startMonth: '2026-09',
      closingRule: 'savings-plug', cashBuffer: 0, displayExpensesNegative: true, fxDriftDefault: 0, fxMonthRate: 'first', askMainAccount: false,
    }],
    entities: [
      { ...base(ID.sam, 'a0'), kind: 'adult', name: 'Sam', attributes: {} },
      { ...base(ID.alex, 'a1'), kind: 'adult', name: 'Alex', attributes: {} },
      { ...base(ID.robin, 'a2'), kind: 'child', name: 'Robin', attributes: { born: '2021' } },
      { ...base(ID.biscuit, 'a3'), kind: 'pet', name: 'Biscuit', attributes: { species: 'dog' } },
      { ...base(ID.car, 'a4'), kind: 'vehicle', name: 'The car', attributes: {} },
      { ...base(ID.flat, 'a5'), kind: 'property', name: 'The flat', attributes: { tenure: 'rent' } },
    ],
    accounts: [
      { ...base(ID.main, 'a0'), name: 'Main account', type: 'checking', currency: 'EUR', ownerEntityId: null, openingBalance: 0, openingMonth: '2026-09', tracked: false },
      { ...base(ID.savings, 'a2'), name: 'Savings', type: 'savings', currency: 'EUR', ownerEntityId: null, openingBalance: 800000, openingMonth: '2026-09', tracked: true },
      {
        ...base(ID.invest, 'a3'), name: 'Index fund', type: 'investment', currency: 'EUR', ownerEntityId: null, openingBalance: 1200000, openingMonth: '2026-09', tracked: true,
        investment: { projectionMode: 'fixed-rate', annualRate: 0.05, depositTiming: 'start', depositFxMode: 'monthly-rate', fixedRate: null },
      },
      { ...base(ID.card, 'a4'), name: 'Credit card', type: 'credit-card', currency: 'EUR', ownerEntityId: ID.sam, openingBalance: 180000, openingMonth: '2026-09', tracked: true },
    ],
    accountMonths: [
      // what the card's statement said at the start of November: 15.00 more than the plan worked out for the end of October
      { accountId: ID.card, month: '2026-10', actualBalance: 169500, actualDeposit: null, actualSpend: null, note: '', updatedAt: T0 },
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
      { ...base(ID.recRent, 'a0'), name: 'Rent', rowId: ID.rowRent, amount: 165000, cadence: { intervalMonths: 1, anchorMonth: 1 }, accountId: ID.main, startMonth: '2026-09', notes: '', payDay: 1, methodId: ID.payStanding },
      { ...base(ID.recCarInsurance, 'a1'), name: 'Car insurance', rowId: ID.rowCarInsurance, amount: 21000, cadence: { intervalMonths: 3, anchorMonth: 1 }, accountId: ID.main, startMonth: '2026-09', notes: 'Quarterly: Jan, Apr, Jul, Oct', payDay: 15, methodId: ID.payDebit },
      { ...base(ID.recStreaming, 'a2'), name: 'Streaming', rowId: ID.rowSubscriptions, amount: 1800, cadence: { intervalMonths: 1, anchorMonth: 1 }, accountId: ID.main, startMonth: '2026-09', notes: '' },
      { ...base(ID.recDogTax, 'a3'), name: 'Dog tax', rowId: ID.rowDog, amount: 12000, cadence: { intervalMonths: 12, anchorMonth: 3 }, accountId: ID.main, startMonth: '2026-09', notes: 'Yearly in March', payDay: 10, methodId: ID.payDebit },
    ],
    pools: [
      { ...base(ID.poolTravel, 'a0'), name: 'Travel', accountId: ID.savings, allocationRowId: ID.rowTravelAlloc, openingBalance: 60000 },
      { ...base(ID.poolClothing, 'a1'), name: 'Clothing', accountId: ID.savings, allocationRowId: ID.rowClothingAlloc, openingBalance: 15000 },
    ],
    // Payments by day and method: the household has not switched it on (`payments` is not set), so none of this shows
    // until someone does. Then the page is not empty: the rent goes by standing order on the 1st, the utilities by
    // direct debit on the 12th, childcare by hand on the 25th, the savings by standing order on the 28th, the
    // subscriptions are paid with Sam's credit card on no set day, and the quarterly insurance and the yearly dog tax
    // say theirs. The rest is untracked. A method is a label: it moves no figure.
    paymentMethods: [
      { ...base(ID.payDebit, 'a0'), name: 'Direct debit', kind: 'direct-debit', ownerEntityId: null, note: 'Main account' },
      { ...base(ID.payStanding, 'a1'), name: 'Standing order', kind: 'standing-order', ownerEntityId: null, note: 'Main account' },
      { ...base(ID.payTransfer, 'a2'), name: 'Transfer by hand', kind: 'transfer', ownerEntityId: null, note: 'Main account' },
      { ...base(ID.payCard, 'a3'), name: 'Credit card', kind: 'credit-card', ownerEntityId: ID.sam, note: '' },
    ],
    fxRates: [],
    monthStates: [],
  }
  return TablesSchema.parse(tables)
}

export const DEMO_IDS = ID
