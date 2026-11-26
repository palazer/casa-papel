import { expect, openMonth, test, type Locator, type Page } from './test'

async function loadDemo(page: Page) {
  await page.goto('?demo=1')
  await page.getByRole('button', { name: 'Load the demo household' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Statement' })).toBeVisible()
}
async function openHousehold(page: Page) {
  await page.getByRole('navigation', { name: 'Screens' }).getByRole('link', { name: 'Household' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Household' })).toBeVisible()
}
const planSwitch = (page: Page) => page.getByRole('checkbox', { name: 'Plan payments by day and method' })
const methods = (page: Page) => page.getByTestId('payment-methods')
/** The box follows what is stored, so it changes once the save is through: a click, then the wait. */
async function turnPayments(page: Page, on: boolean) {
  await planSwitch(page).click()
  await expect(planSwitch(page)).toBeChecked({ checked: on })
}

/**
 * A household made on the first screen, with a current account, a credit card that is Sam's and one expense: it has
 * no payment methods yet, which is where the first list of them is offered. (The demo household brings its own.)
 */
async function newHousehold(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: 'Start on this device' }).click()
  await page.getByLabel('Household name').fill('Sam and Alex')
  await page.getByLabel('Adult 1 name').fill('Sam')
  await page.getByLabel('Adult 2 name').fill('Alex')
  await page.getByRole('button', { name: 'Open the Statement' }).click()
  await expect(page.getByRole('heading', { level: 2, name: 'November 2026' })).toBeVisible()
  await page.getByTestId('setup-guide').getByRole('button', { name: 'Leave setup' }).click()
  const dlg = page.getByRole('dialog')
  await page.getByRole('region', { name: 'Assets' }).getByRole('button', { name: 'Add account' }).click()
  await dlg.getByLabel('Name', { exact: true }).fill('Current account')
  await dlg.getByLabel('Type').selectOption({ label: 'Main account' })
  await dlg.getByRole('button', { name: 'Save' }).click()
  await expect(dlg).toBeHidden()
  await page.getByRole('button', { name: 'Add a card or loan' }).click()
  await dlg.getByLabel('Name', { exact: true }).fill('Visa')
  await dlg.getByLabel('Type').selectOption({ label: 'Credit card' })
  // a card account is a debt that is carried: it says what is owed
  await dlg.getByLabel(/^Owed at the start of/).fill('300')
  await dlg.getByRole('button', { name: /^More options/ }).click()
  await dlg.getByLabel('Owner', { exact: true }).selectOption({ label: 'Sam' })
  await dlg.getByRole('button', { name: 'Save' }).click()
  // a card comes with the row that pays it off, which asks for its first amount: not yet
  await expect(page.getByRole('dialog', { name: /^Visa – Payment · / })).toBeVisible()
  await dlg.getByRole('button', { name: 'Cancel' }).click()
  await expect(dlg).toBeHidden()
  const out = page.getByRole('region', { name: 'Money out' })
  await out.getByRole('button', { name: 'Add expense row' }).click()
  await out.getByLabel('New expense row name').fill('Rent')
  await out.getByLabel('New expense row name').press('Enter')
  await dlg.getByLabel('Amount in EUR').fill('1200')
  await dlg.getByRole('button', { name: 'Save' }).click()
  await expect(dlg).toBeHidden()
}

test.describe('Payments: the switch and the payment methods', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('off, nothing of it is there; on, the list of methods starts from the accounts', async ({ page }) => {
    await newHousehold(page)
    await openHousehold(page)
    await expect(planSwitch(page)).not.toBeChecked()
    await expect(page.getByRole('heading', { name: 'Payment methods' })).toHaveCount(0)

    await turnPayments(page, true)
    await expect(page.getByRole('heading', { name: 'Payment methods' })).toBeVisible()
    const starter = page.getByTestId('starter-methods')
    // three noted with the main account's name, one for the card, and cash
    await expect(starter.getByRole('checkbox')).toHaveCount(5)
    await expect(starter.getByRole('checkbox', { name: /^Direct debit · direct debit · Current account/ })).toBeChecked()
    await expect(starter.getByRole('checkbox', { name: /^Visa · credit card$/ })).toBeChecked()
    // before there is a method, the Payments page says where they are added
    await openPayments(page)
    // nothing has a day or a method yet: no day stands in the list, no sum beside it, and the rent is untracked
    await expect(page.locator('[data-group]')).toHaveCount(0)
    await expect(page.getByTestId('payments-none-tracked')).toContainText('Nothing is tracked in November 2026 yet.')
    await expect(page.getByTestId('payment-totals')).toHaveCount(0)
    await expect(page.getByTestId('payments-summary')).toHaveText(/€0\.00 to pay · €0\.00 done · 1 untracked/)
    await expect(page.locator('[data-payment]')).toHaveText([/^Rent\s*Track…\s*€1,200\.00$/])
    await page.getByTestId('payments-no-methods').getByRole('button', { name: 'Add them under Household' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Household' })).toBeVisible()

    await starter.getByRole('checkbox', { name: /^Transfer by hand/ }).uncheck()
    await starter.getByRole('checkbox', { name: /^Cash/ }).uncheck()
    await starter.getByRole('button', { name: 'Add 3 methods' }).click()
    await expect(starter).toHaveCount(0)
    await expect(methods(page).getByRole('listitem')).toHaveCount(3)
    await expect(methods(page).getByRole('listitem').nth(0)).toContainText('direct debit')
    await expect(methods(page).getByRole('listitem').nth(0)).toContainText('Direct debit')
    await expect(methods(page).getByRole('listitem').nth(0)).toContainText('Current account')
    // the card is Sam's, and so is the method named after it
    await expect(methods(page).getByRole('listitem').nth(2)).toHaveText(/credit card\s*Visa\s*Sam/)
    await openPayments(page)
    await expect(page.getByTestId('payments-no-methods')).toHaveCount(0)
    await openHousehold(page)

    // one undo takes the three back, and the list is offered again
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect(page.getByTestId('starter-methods')).toBeVisible()
    await page.getByRole('button', { name: 'Redo' }).click()
    await expect(methods(page).getByRole('listitem')).toHaveCount(3)

    // off: hidden, and not lost
    await turnPayments(page, false)
    await expect(page.getByRole('heading', { name: 'Payment methods' })).toHaveCount(0)
    await page.reload()
    await openHousehold(page)
    await turnPayments(page, true)
    await expect(methods(page).getByRole('listitem')).toHaveCount(3)
  })

  test('the demo household brings four methods of its own, shown once it is switched on', async ({ page }) => {
    await loadDemo(page)
    await openHousehold(page)
    await expect(planSwitch(page)).not.toBeChecked()
    await expect(page.getByRole('heading', { name: 'Payment methods' })).toHaveCount(0)
    await turnPayments(page, true)
    await expect(page.getByTestId('starter-methods')).toHaveCount(0)
    await expect(methods(page).getByRole('listitem')).toHaveText([/direct debit\s*Direct debit\s*Main account/, /Standing order\s*Main account/, /Transfer by hand\s*Main account/, /credit card\s*Credit card\s*Sam/])
  })

  test('a method is a name, a kind, who pays and a note: added with a name alone, changed and removed', async ({ page }) => {
    await loadDemo(page)
    await openHousehold(page)
    await turnPayments(page, true)
    await methods(page).getByRole('button', { name: 'Add method' }).click()
    const dialog = page.getByRole('dialog', { name: 'New payment method' })
    // nothing asks for an account
    await expect(dialog.getByLabel('Draws on')).toHaveCount(0)
    await expect(dialog.getByRole('button', { name: 'Save' })).toBeDisabled()
    await dialog.getByLabel('Name', { exact: true }).fill('Bills automation')
    await expect(dialog.getByRole('button', { name: 'Save' })).toBeEnabled()
    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect(dialog).toBeHidden()
    await expect(methods(page).getByRole('listitem').filter({ hasText: 'Bills automation' })).toHaveText(/direct debit\s*Bills automation\s*Edit/)

    await methods(page).getByRole('button', { name: 'Add method' }).click()
    await expect(dialog.getByTestId('pm-kind-help')).toContainText('Collected from the account')
    await dialog.getByLabel('Kind', { exact: true }).selectOption('Wallet')
    await expect(dialog.getByTestId('pm-kind-help')).toContainText('PayPal')
    await dialog.getByLabel('Name', { exact: true }).fill('PayPal')
    await dialog.getByLabel('Who pays with it', { exact: true }).selectOption({ label: 'Alex' })
    await dialog.getByLabel('Note (optional)', { exact: true }).fill('main account')
    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect(dialog).toBeHidden()
    const line = methods(page).getByRole('listitem').filter({ hasText: 'PayPal' })
    await expect(line).toContainText('wallet')
    await expect(line).toContainText('main account · Alex')

    await line.getByRole('button', { name: 'Edit' }).click()
    const edit = page.getByRole('dialog', { name: 'Edit payment method' })
    await expect(edit.getByLabel('Note (optional)', { exact: true })).toHaveValue('main account')
    await edit.getByLabel('Name', { exact: true }).fill('PayPal (Alex)')
    await edit.getByLabel('Note (optional)', { exact: true }).fill('')
    await edit.getByRole('button', { name: 'Save' }).click()
    await expect(methods(page).getByRole('listitem').filter({ hasText: 'PayPal (Alex)' })).toHaveText(/wallet\s*PayPal \(Alex\)\s*Alex\s*Edit/)

    // nothing uses it yet, so it can be deleted; the standing order is in use (the rent), so it is archived
    await methods(page).getByRole('listitem').filter({ hasText: 'PayPal (Alex)' }).getByRole('button', { name: 'Edit' }).click()
    await page.getByRole('dialog', { name: 'Edit payment method' }).getByRole('button', { name: 'Delete' }).click()
    await expect(methods(page).getByRole('listitem').filter({ hasText: 'PayPal' })).toHaveCount(0)
    await methods(page).getByRole('listitem').filter({ hasText: 'Standing order' }).getByRole('button', { name: 'Edit' }).click()
    await page.getByRole('dialog', { name: 'Edit payment method' }).getByRole('button', { name: 'Archive' }).click()
    await expect(methods(page).getByRole('listitem').filter({ hasText: 'Standing order' }).getByRole('button', { name: 'Use again' })).toBeVisible()
  })
})

/** The demo household with payments planned. It has its methods: a direct debit, a standing order and a transfer on the main account, and the credit card. */
async function withMethods(page: Page) {
  await loadDemo(page)
  await openHousehold(page)
  await turnPayments(page, true)
  await expect(methods(page).getByRole('listitem')).toHaveCount(4)
}
async function openStatement(page: Page) {
  await page.getByRole('navigation', { name: 'Screens' }).getByRole('link', { name: 'Statement' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Statement' })).toBeVisible()
  await page.getByRole('button', { name: 'Expand all' }).click()
}
/** The text of the option a select shows. */
const shown = (select: Locator) => select.evaluate((el: HTMLSelectElement) => el.selectedOptions[0]?.textContent ?? '')
const paidOn = (dlg: Locator) => dlg.getByLabel('Paid on', { exact: true })
const paidWith = (dlg: Locator) => dlg.getByLabel('Paid with', { exact: true })
/** A method of the demo household as a list of choices names it: with its note. */
const choice = (name: string) => (name === 'Credit card' ? name : `${name} · Main account`)
/** What is owed on the demo's card at the end of the month on screen. */
async function owedOnCard(page: Page): Promise<number> {
  const text = await page.locator('[data-line^="acc:"]').filter({ hasText: 'Credit card' }).first().innerText()
  const amounts = text.match(/-?€[\d,]+\.\d\d/g) ?? []
  return Number((amounts[amounts.length - 1] ?? '').replace(/[€,]/g, ''))
}

test.describe('Payments: "Paid on" and "Paid with"', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('"Usually paid…" in the row menu: a day and a method for the row, a credit card among the methods, and no figure moves', async ({ page }) => {
    await withMethods(page)
    await openStatement(page)
    await page.getByRole('button', { name: 'Row menu for The flat – Rent' }).click()
    await page.getByRole('menuitem', { name: 'Usually paid…' }).click()
    const dlg = page.getByRole('dialog', { name: 'Usually paid' })
    await expect(dlg).toContainText('Row "The flat – Rent"')
    expect(await shown(paidOn(dlg))).toBe('No day')
    await paidOn(dlg).selectOption('31st')
    await expect(dlg).toContainText('In a shorter month the 31st is its last day.')
    await paidOn(dlg).selectOption('1st')
    await paidWith(dlg).selectOption({ label: choice('Standing order') })
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    await page.getByRole('button', { name: 'Row menu for The flat – Rent' }).click()
    await page.getByRole('menuitem', { name: 'Usually paid…' }).click()
    expect([await shown(paidOn(dlg)), await shown(paidWith(dlg))]).toEqual(['1st', choice('Standing order')])
    await dlg.getByRole('button', { name: 'Cancel' }).click()

    // "Subscriptions" is paid with the credit card: that is its method, and nothing in the menu puts the row on a card
    const owed = await owedOnCard(page)
    await page.getByRole('button', { name: 'Row menu for Subscriptions' }).click()
    await expect(page.getByRole('menuitem', { name: 'Paid by card…' })).toHaveCount(0)
    await expect(page.getByRole('menuitem', { name: 'Paid from…' })).toHaveCount(0)
    await page.getByRole('menuitem', { name: 'Usually paid…' }).click()
    expect(await shown(paidWith(dlg))).toBe('Credit card')
    // paid by direct debit instead: a label changes, and no month that is over is asked about
    await paidWith(dlg).selectOption({ label: choice('Direct debit') })
    await paidOn(dlg).selectOption('7th')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    await expect(page.getByTestId('past-question')).toHaveCount(0)
    // once the page has the change (the day after the row's name), what is owed on the card is what it was
    await expect(page.locator('[data-line]').filter({ hasText: 'Subscriptions' }).first().locator('[data-day]')).toHaveText('7th')
    expect(await owedOnCard(page)).toBe(owed)
  })

  test('the amount\'s dialog: "Usually paid" is saved with the amount, and leaves "Comes out of" alone', async ({ page }) => {
    await withMethods(page)
    await openStatement(page)

    await page.getByRole('button', { name: /^Groceries:/ }).click()
    const dlg = page.getByRole('dialog', { name: /^Groceries · / })
    const usual = dlg.getByTestId('usually-paid')
    const source = dlg.getByLabel('Comes out of', { exact: true })
    const from = await shown(source)
    await expect(usual).toContainText('For this row, in every month.')
    await paidOn(usual).selectOption('15th')
    await paidWith(usual).selectOption({ label: choice('Direct debit') })
    await expect(usual).toContainText('saved with the amount')
    await dlg.getByLabel('Amount in EUR').fill('720')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    await expect(page.getByRole('button', { name: /^Groceries:/ })).toHaveAccessibleName(/^Groceries: €720\.00/)

    // whatever the method, where the amount comes out of is its own choice: free, and as it was
    await page.getByRole('button', { name: /^Groceries:/ }).click()
    expect([await shown(paidOn(usual)), await shown(paidWith(usual))]).toEqual(['15th', choice('Direct debit')])
    await paidWith(usual).selectOption({ label: 'Credit card' })
    await expect(source).toBeEnabled()
    expect(await shown(source)).toBe(from)
    await expect(dlg.getByTestId('method-effect')).toHaveCount(0)
    await dlg.getByRole('button', { name: 'Cancel' }).click()

    // one undo takes the amount and the row's day and method back together
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect(page.getByRole('button', { name: /^Groceries:/ })).toHaveAccessibleName(/^Groceries: €700\.00/)
    await page.getByRole('button', { name: /^Groceries:/ }).click()
    expect([await shown(paidOn(usual)), await shown(paidWith(usual))]).toEqual(['No day', 'No method'])
  })

  test('an item has a day and a method of its own; on something that repeats they go to its schedule from this month on', async ({ page }) => {
    await withMethods(page)
    await openStatement(page)
    const owed = await owedOnCard(page)
    await page.getByRole('button', { name: /^Subscriptions:/ }).click()
    const dlg = page.getByRole('dialog', { name: /^Subscriptions · / })
    const day = dlg.getByLabel('Paid on, Streaming')
    const method = dlg.getByLabel('Paid with, Streaming')
    // nothing of its own yet: it follows the row, which is usually paid with the credit card
    expect([await shown(day), await shown(method)]).toEqual(['No day', 'Usual: Credit card'])
    await day.selectOption('5th')
    await method.selectOption({ label: choice('Direct debit') })
    // it repeats, so the dialog asks how far the change goes
    await dlg.getByRole('radio', { name: 'This and following months' }).click()
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    await page.getByRole('button', { name: /^Subscriptions:/ }).click()
    expect([await shown(day), await shown(method)]).toEqual(['As scheduled: 5th', 'As scheduled: Direct debit'])
    // only this month, on the 9th: the item names it, the schedule keeps the 5th
    await day.selectOption('9th')
    await dlg.getByRole('radio', { name: 'Only this month' }).click()
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    await page.getByRole('button', { name: /^Subscriptions:/ }).click()
    expect(await shown(day)).toBe('9th')
    await expect(day.getByRole('option').first()).toHaveText('As scheduled: 5th')
    await dlg.getByRole('button', { name: 'Cancel' }).click()
    // a method is a label: what is owed on the card has not moved
    expect(await owedOnCard(page)).toBe(owed)
  })
})


const rail = (page: Page) => page.getByRole('navigation', { name: 'Screens' })
async function openPayments(page: Page) {
  await rail(page).getByRole('link', { name: 'Payments' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Payments' })).toBeVisible()
}
/** "Usually paid…" from the row's menu on the Statement: a day and a method. It asks nothing, in any month. */
async function usuallyPaid(page: Page, row: string, day: string | null, method: string | null) {
  await page.getByRole('button', { name: `Row menu for ${row}`, exact: true }).click()
  await page.getByRole('menuitem', { name: 'Usually paid…' }).click()
  const dlg = page.getByRole('dialog', { name: 'Usually paid' })
  if (day) await paidOn(dlg).selectOption(day)
  if (method) await paidWith(dlg).selectOption({ label: choice(method) })
  await dlg.getByRole('button', { name: 'Save' }).click()
  await expect(dlg).toBeHidden()
}
/**
 * The demo household with payments planned. Its rent goes on the 1st (its schedule says so), childcare on the 25th and
 * the savings on the 28th; the utilities are moved from the 12th to the 15th, the day the tests run on.
 */
async function withDays(page: Page) {
  await withMethods(page)
  await openStatement(page)
  await usuallyPaid(page, 'The flat – Utilities', '15th', null)
}
const group = (page: Page, key: string) => page.locator(`[data-group="${key}"]`)
const lines = (scope: Page | Locator) => scope.locator('[data-payment]')
const euros = (text: string) => Number(text.replace(/[^\d.-]/g, ''))
const inEuros = (v: number) => `€${v.toLocaleString('en-GB', { minimumFractionDigits: 2 })}`
const untracked = (page: Page) => page.getByTestId('payments-untracked')
const payment = (page: Page) => page.getByRole('dialog', { name: 'Payment' })
const countsFor = (dlg: Locator) => dlg.getByRole('radiogroup', { name: 'Counts for' })
/** The amounts of the lines in view, in euros. */
const amounts = async (scope: Page | Locator) => (await lines(scope).getByTestId('payment-amount').allInnerTexts()).map(euros)
const total = (list: number[]) => Math.round(list.reduce((s, v) => s + v, 0) * 100) / 100

test.describe('Payments: the page', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('the page is in the rail only while the switch is on, and its address opens the Statement while it is off', async ({ page }) => {
    await loadDemo(page)
    await expect(rail(page).getByRole('link')).toHaveText(['DH', 'Statement', 'Grid', 'Trends', 'Household', 'Data', 'Guide'])
    await page.goto('?demo=1&screen=payments')
    await expect(page.getByRole('heading', { level: 1, name: 'Statement' })).toBeVisible()

    await openHousehold(page)
    await turnPayments(page, true)
    await expect(rail(page).getByRole('link')).toHaveText(['DH', 'Statement', 'Grid', 'Payments', 'Trends', 'Household', 'Data', 'Guide'])
    await openPayments(page)
    await expect(rail(page).getByRole('link', { name: 'Payments' })).toHaveAttribute('aria-current', 'page')
    await expect(page.getByRole('heading', { level: 2, name: 'November 2026' })).toBeVisible()
    // the demo household's own days: the rent (the 1st) and the utilities (the 12th) are late on the 15th
    await expect(page.getByTestId('payments-no-methods')).toHaveCount(0)
    await expect(lines(group(page, 'overdue'))).toHaveText([/Sun 1\s*The flat – Rent\s*Standing order/, /Thu 12\s*The flat – Utilities\s*Direct debit/])
    await expect(lines(group(page, 'coming'))).toHaveText([/Wed 25\s*Robin – Childcare\s*Transfer by hand\s*by hand/, /Sat 28\s*To savings\s*Standing order\s*calculated/])
    // the subscriptions name a method and no day; everything else of the month is untracked, below
    await expect(group(page, 'no-day').getByRole('heading')).toHaveText(/^No day\s*1 · €18\.00$/)
    await expect(lines(group(page, 'no-day'))).toHaveText([/–\s*Subscriptions\s*Credit card/])
    await expect(page.getByTestId('payments-summary')).toHaveText(/€4,627\.00 to pay · €0\.00 done · 2 overdue · 13 untracked/)
    // the address is the page's own, and a reload stays on it
    await page.reload()
    await expect(page.getByRole('heading', { level: 1, name: 'Payments' })).toBeVisible()

    await openHousehold(page)
    await turnPayments(page, false)
    await expect(rail(page).getByRole('link', { name: 'Payments' })).toHaveCount(0)
    await page.goto('?demo=1&screen=payments')
    await expect(page.getByRole('heading', { level: 1, name: 'Statement' })).toBeVisible()
  })

  test('the month day by day: what is late, today, what is coming, what has no day; a tick is the Statement\'s tick', async ({ page }) => {
    await withDays(page)
    await openPayments(page)
    await expect(page.locator('[data-group]')).toHaveCount(4)
    await expect(group(page, 'overdue').getByRole('heading')).toContainText('Overdue')
    await expect(lines(group(page, 'overdue'))).toHaveText([/Sun 1\s*The flat – Rent\s*Standing order/])
    // the tests run on Sunday 15 November 2026
    await expect(group(page, 'today').getByRole('heading')).toContainText('Today, Sun 15')
    await expect(lines(group(page, 'today'))).toHaveText([/The flat – Utilities\s*Direct debit/])
    await expect(lines(group(page, 'coming'))).toHaveText([/Wed 25\s*Robin – Childcare\s*Transfer by hand\s*by hand/, /Sat 28\s*To savings\s*Standing order\s*calculated/])
    await expect(group(page, 'no-day').getByRole('heading')).toContainText('No day')
    await expect(page.getByTestId('payments-summary')).toContainText('1 overdue')
    await page.screenshot({ path: 'e2e/output/payments.png', fullPage: true })

    // ticked, the rent is done: nothing is late any more, and "Done" holds it, folded until it is pressed
    const before = await page.getByTestId('payments-summary').innerText()
    await page.getByRole('checkbox', { name: 'The flat – Rent done' }).click()
    await expect(group(page, 'overdue')).toHaveCount(0)
    await expect(page.getByTestId('payments-summary')).not.toContainText('overdue')
    await expect(page.getByTestId('payments-summary')).toContainText('€1,650.00 done')
    expect(before).toContain('€0.00 done')
    const done = group(page, 'done')
    await expect(lines(done)).toHaveCount(0)
    await done.getByRole('button', { name: /^Done/ }).click()
    await expect(lines(done)).toHaveText([/The flat – Rent/])
    await expect(done.getByRole('checkbox', { name: 'The flat – Rent done' })).toBeChecked()

    // the same tick on the Statement, and taken back there it is late again here
    await openStatement(page)
    const tick = page.getByRole('checkbox', { name: 'The flat – Rent done' })
    await expect(tick).toBeChecked()
    await tick.click()
    await expect(tick).not.toBeChecked()
    await openPayments(page)
    await expect(lines(group(page, 'overdue'))).toHaveText([/The flat – Rent/])

    // a line opens "Payment", its day and method; "Amount…" there is the amount's dialog, the one the Statement opens
    await page.getByRole('button', { name: /^Robin – Childcare: €380\.00, on the 25th, Transfer by hand$/ }).click()
    const dlg = payment(page)
    await expect(dlg).toContainText('Robin – Childcare')
    await expect(dlg.getByTestId('payment-of')).toContainText('€380.00 in November 2026')
    expect([await shown(paidOn(dlg)), await shown(paidWith(dlg))]).toEqual(['25th', choice('Transfer by hand')])
    await dlg.getByRole('button', { name: 'Amount…' }).click()
    await expect(dlg).toBeHidden()
    const amount = page.getByRole('dialog', { name: 'Robin – Childcare · November 2026' })
    await expect(amount.getByTestId('usually-paid')).toBeVisible()
    await amount.getByRole('button', { name: 'Cancel' }).click()

    // another month has no "late" and no "today": what has a day is to pay, by day
    await openMonth(page, 'December 2026')
    await expect(page.locator('[data-group]')).toHaveCount(2)
    await expect(group(page, 'open').getByRole('heading')).toContainText('To pay')
    await expect(lines(group(page, 'open'))).toHaveText([/Tue 1\s*The flat – Rent/, /Tue 15\s*The flat – Utilities/, /Fri 25\s*Robin – Childcare/, /Mon 28\s*To savings/])
    await expect(page.getByTestId('payments-summary')).not.toContainText('overdue')
  })

  test('what has no day and no method is untracked: listed below, in no sum, until "Track…" gives it one', async ({ page }) => {
    await withDays(page)
    await openPayments(page)
    const summary = page.getByTestId('payments-summary')
    const list = page.getByTestId('payments-list')
    const totals = page.getByTestId('payment-totals')
    // twelve amounts of the demo's November name neither: a quiet list with no ticks
    await expect(untracked(page).getByRole('heading')).toHaveText('Untracked')
    await expect(untracked(page)).toContainText('13 · €3,438.00')
    await expect(lines(untracked(page))).toHaveCount(13)
    await expect(lines(untracked(page)).first()).toHaveText(/^Groceries\s*Track…\s*€700\.00$/)
    await expect(untracked(page).getByRole('checkbox')).toHaveCount(0)
    // "to pay" is what is tracked, and the two lists together are the month's "Money out" rows
    const tracked = total(await amounts(list))
    await expect(summary).toHaveText(new RegExp(`${inEuros(tracked).replace('.', '\\.')} to pay · €0\\.00 done · 1 overdue · 13 untracked`))
    expect(tracked).toBe(4627)

    // "Track…" with a method alone: it has no day to stand on
    await untracked(page).getByRole('button', { name: 'Track Groceries: €700.00' }).click()
    const dlg = payment(page)
    await expect(dlg).toContainText('Groceries')
    await expect(dlg.getByTestId('payment-of')).toContainText('€700.00 in November 2026')
    await expect(dlg.getByTestId('payment-reach')).toHaveText('For this row, in every month, past ones included.')
    await expect(countsFor(dlg)).toHaveCount(0)
    await expect(dlg.getByTestId('payment-untracked')).toBeVisible()
    await paidWith(dlg).selectOption({ label: choice('Direct debit') })
    await expect(dlg.getByTestId('payment-untracked')).toHaveCount(0)
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    await expect(lines(group(page, 'no-day'))).toHaveText([/–\s*Groceries\s*Direct debit/, /–\s*Subscriptions\s*Credit card/])
    await expect(untracked(page)).toContainText('12 · €2,738.00')
    await expect(summary).toContainText('€5,327.00 to pay')
    await expect(summary).toContainText('12 untracked')
    await expect(totals.getByRole('button', { name: /^Direct debit: €910\.00, 2 payments, €910\.00 not done yet$/ })).toBeVisible()
    // the keyboard stays in the list it was in: on the line that stood after the one that left
    await expect(untracked(page).getByRole('button', { name: /^Track Health: / })).toBeFocused()
    // no month that is over was asked about, though the row now says it for every month
    await expect(page.getByTestId('past-question')).toHaveCount(0)

    // a day puts it on its day, and its tick is here now
    await page.getByRole('button', { name: /^Groceries: €700\.00, no day, Direct debit$/ }).click()
    expect([await shown(paidOn(dlg)), await shown(paidWith(dlg))]).toEqual(['No day', choice('Direct debit')])
    await paidOn(dlg).selectOption('31st')
    await expect(dlg.getByTestId('payment-reach')).toContainText('In a shorter month the 31st is its last day.')
    await paidOn(dlg).selectOption('20th')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    await expect(lines(group(page, 'coming'))).toHaveText([/Fri 20\s*Groceries\s*Direct debit/, /Wed 25\s*Robin – Childcare/, /Sat 28\s*To savings/])
    // it moved under another heading, and the keyboard went with it
    await expect(page.getByRole('button', { name: /^Groceries: €700\.00, on the 20th, Direct debit$/ })).toBeFocused()
    await page.getByRole('checkbox', { name: 'Groceries done' }).click()
    await expect(summary).toContainText('€700.00 done')
    await page.getByRole('checkbox', { name: 'Robin – Childcare done' }).focus()
    await group(page, 'done').getByRole('button', { name: /^Done/ }).click()
    await page.getByRole('checkbox', { name: 'Groceries done' }).click()
    await expect(summary).toContainText('€0.00 done')

    // "No day" and "No method" take it back: untracked, and out of every sum
    await page.getByRole('button', { name: /^Groceries: €700\.00, on the 20th, Direct debit$/ }).click()
    await paidOn(dlg).selectOption('No day')
    await paidWith(dlg).selectOption('No method')
    await expect(dlg.getByTestId('payment-untracked')).toContainText('it is not tracked')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    await expect(untracked(page)).toContainText('13 · €3,438.00')
    await expect(summary).toContainText('€4,627.00 to pay')
    await expect(totals.getByRole('button', { name: /^Direct debit: €210\.00, 1 payment, / })).toBeVisible()

    // the list folds, and the device remembers it
    await untracked(page).getByRole('button', { name: 'Untracked', exact: true }).click()
    await expect(lines(untracked(page))).toHaveCount(0)
    await expect(untracked(page)).toContainText('13 · €3,438.00')
    await page.reload()
    await expect(untracked(page).getByRole('button', { name: 'Untracked', exact: true })).toHaveAttribute('aria-expanded', 'false')
    await untracked(page).getByRole('button', { name: 'Untracked', exact: true }).click()
    await expect(lines(untracked(page))).toHaveCount(13)
  })

  test('something that repeats: "This and following months" changes its schedule from here, "Only this month" the month alone', async ({ page }) => {
    await withMethods(page)
    await openPayments(page)
    const rent = () => lines(page).filter({ hasText: 'The flat – Rent' })
    const dlg = payment(page)
    // the rent repeats, and its schedule says the 1st by standing order
    await page.getByRole('button', { name: /^The flat – Rent: €1,650\.00, on the 1st, Standing order$/ }).click()
    await expect(countsFor(dlg).getByRole('radio')).toHaveText(['This and following months', 'Only this month'])
    await expect(countsFor(dlg).getByRole('radio', { name: 'This and following months' })).toBeChecked()
    expect([await shown(paidOn(dlg)), await shown(paidWith(dlg))]).toEqual(['1st', choice('Standing order')])
    await expect(dlg.getByTestId('payment-reach')).toHaveText('From November 2026 on, wherever it repeats. Earlier months keep how they were paid.')

    // only this month: the fields show what the month says for itself, and their first choice what it follows
    await countsFor(dlg).getByRole('radio', { name: 'Only this month' }).click()
    expect([await shown(paidOn(dlg)), await shown(paidWith(dlg))]).toEqual(['As scheduled: 1st', 'As scheduled: Standing order'])
    await expect(dlg.getByTestId('payment-reach')).toHaveText('For November 2026 alone. The other months keep what its schedule says.')
    await paidOn(dlg).selectOption('3rd')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    await expect(rent()).toHaveText(/Tue 3\s*The flat – Rent\s*Standing order/)
    await openMonth(page, 'December 2026')
    await expect(rent()).toHaveText(/Tue 1\s*The flat – Rent/)
    await openMonth(page, 'November 2026')

    // the month says a day of its own now, so the dialog opens on it; for this and the following months it gives way
    await page.getByRole('button', { name: /^The flat – Rent: €1,650\.00, on the 3rd, Standing order$/ }).click()
    await expect(countsFor(dlg).getByRole('radio', { name: 'Only this month' })).toBeChecked()
    expect(await shown(paidOn(dlg))).toBe('3rd')
    await countsFor(dlg).getByRole('radio', { name: 'This and following months' }).click()
    expect(await shown(paidOn(dlg))).toBe('1st')
    await paidOn(dlg).selectOption('5th')
    await paidWith(dlg).selectOption({ label: choice('Direct debit') })
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    await expect(page.getByTestId('past-question')).toHaveCount(0)
    await expect(rent()).toHaveText(/Thu 5\s*The flat – Rent\s*Direct debit/)
    await openMonth(page, 'December 2026')
    await expect(rent()).toHaveText(/Sat 5\s*The flat – Rent\s*Direct debit/)
    // the month before keeps how it was paid
    await openMonth(page, 'October 2026')
    await expect(rent()).toHaveText(/Thu 1\s*The flat – Rent\s*Standing order/)
    // and no figure moved: the Statement's November still has the rent it had
    await openStatement(page)
    await expect(page.getByRole('button', { name: /^The flat – Rent:/ })).toHaveAccessibleName(/^The flat – Rent: €1,650\.00/)
  })

  test('the sums by method and by person add up to what is tracked, and a pressed sum leaves only its payments', async ({ page }) => {
    await withDays(page)
    await openPayments(page)
    const totals = page.getByTestId('payment-totals')
    const list = page.getByTestId('payments-list')
    const all = await amounts(list)
    await expect(totals.locator('[data-method-total]')).toHaveText([/^Direct debit\s*Main account/, /^Standing order\s*Main account/, /^Transfer by hand\s*Main account/, /^Credit card\s*Sam/])
    const sums = (await totals.locator('[data-method-total] > button').allInnerTexts()).map((t) => euros(t.split('\n').pop() ?? ''))
    expect(total(sums)).toBe(total(all))
    await expect(page.getByTestId('payments-summary')).toContainText(`${inEuros(total(all))} to pay`)
    // nothing on the page speaks of an account's balance or of what a card owes
    await expect(totals).not.toContainText('Owed')
    await expect(page.getByTestId('payments-list')).not.toContainText('on card')

    // the rent and what goes to savings
    const order = totals.getByRole('button', { name: /^Standing order: €4,019\.00, 2 payments, €4,019\.00 not done yet$/ })
    await order.click()
    await expect(order).toHaveAttribute('aria-pressed', 'true')
    await expect(lines(page)).toHaveText([/The flat – Rent/, /To savings/])
    await expect(page.getByTestId('payments-filter')).toContainText('Only Standing order')
    // what is untracked is in no sum, so it is not there while one is picked out
    await expect(untracked(page)).toHaveCount(0)
    // a tick shows in the sum: what of it is still open
    await page.getByRole('checkbox', { name: 'The flat – Rent done' }).click()
    await expect(totals.getByRole('button', { name: /^Standing order: €4,019\.00, 2 payments, €2,369\.00 not done yet$/ })).toContainText('€2,369.00 open')
    // pressed again, or "Show all": the whole list
    await totals.getByRole('button', { name: /^Standing order: / }).click()
    await expect(page.getByTestId('payments-filter')).toHaveCount(0)
    await expect(untracked(page)).toBeVisible()
    await expect(lines(list)).toHaveCount(all.length - 1)

    // tracked by a day alone: "No method", the last sum
    await untracked(page).getByRole('button', { name: 'Track Health: €30.00' }).click()
    await paidOn(payment(page)).selectOption('8th')
    await payment(page).getByRole('button', { name: 'Save' }).click()
    await expect(payment(page)).toBeHidden()
    await expect(totals.locator('[data-method-total]').last()).toHaveText(/^No method\s*€30\.00$/)
    await totals.getByRole('button', { name: /^No method: €30\.00, 1 payment, / }).click()
    await expect(lines(page)).toHaveText([/Sun 8\s*Health\s*no method/])
    await page.getByTestId('payments-filter').getByRole('button', { name: 'Show all' }).click()

    // by person: the credit card method is Sam's, so what is paid with it is Sam's to pay
    const people = page.getByTestId('payment-people')
    await people.getByRole('button', { name: /^Sam: €18\.00, 1 payment, / }).click()
    await expect(lines(page)).toHaveText([/Subscriptions/])
    await expect(page.getByTestId('payments-filter')).toContainText('Only Sam')
    // another month starts with the whole list again
    await openMonth(page, 'December 2026')
    await expect(page.getByTestId('payments-filter')).toHaveCount(0)
  })

  test('two things in one row, each paid its own way: two lines, each with its own tick, day and method', async ({ page }) => {
    await withMethods(page)
    await openStatement(page)
    const owed = await owedOnCard(page)
    await page.getByRole('button', { name: /^Subscriptions:/ }).click()
    const dlg = page.getByRole('dialog', { name: /^Subscriptions · / })
    await dlg.getByRole('button', { name: 'Add item' }).click()
    await dlg.getByLabel('Item label').last().fill('Music')
    await dlg.getByLabel('Item amount').last().fill('12')
    await dlg.getByLabel('Paid on, Music').selectOption('20th')
    await dlg.getByLabel('Paid with, Music').selectOption({ label: choice('Direct debit') })
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    // once the page has the new item (18.00 and 12.00): whatever the items are paid with, nothing is put on the card
    await expect(page.getByRole('button', { name: /^Subscriptions:/ })).toHaveAccessibleName(/^Subscriptions: €30\.00/)
    expect(await owedOnCard(page)).toBe(owed)

    await openPayments(page)
    await expect(page.getByRole('button', { name: /^Subscriptions: Streaming: €18\.00, no day, Credit card$/ })).toBeVisible()
    const music = lines(page).filter({ hasText: 'Music' })
    await expect(music).toHaveText(/Fri 20\s*Music\s*Subscriptions\s*Direct debit/)
    await expect(lines(page).filter({ hasText: 'Streaming' })).toHaveText(/Streaming\s*Subscriptions\s*Credit card/)
    const totals = page.getByTestId('payment-totals')
    await expect(totals.getByRole('button', { name: /^Credit card: €18\.00, 1 payment, / })).toBeVisible()
    // with the utilities (210.00), which the demo household pays by direct debit
    await expect(totals.getByRole('button', { name: /^Direct debit: €222\.00, 2 payments, / })).toBeVisible()

    // one item of several is this month's alone: "Payment" offers no other place to save in
    await page.getByRole('button', { name: /^Subscriptions: Music: €12\.00, on the 20th, Direct debit$/ }).click()
    const pay = payment(page)
    await expect(pay).toContainText('Subscriptions: Music')
    await expect(countsFor(pay)).toHaveCount(0)
    await expect(pay.getByTestId('payment-reach')).toHaveText('For this amount, in November 2026 alone.')
    // behind it stands its row, which is usually paid with the credit card
    await expect(paidWith(pay).getByRole('option').first()).toHaveText('Usual: Credit card')
    await paidOn(pay).selectOption('21st')
    await pay.getByRole('button', { name: 'Save' }).click()
    await expect(pay).toBeHidden()
    await expect(music).toHaveText(/Sat 21\s*Music\s*Subscriptions\s*Direct debit/)

    // each has a tick of its own, and it is the item's tick on the Statement
    await page.getByRole('checkbox', { name: 'Subscriptions: Music done' }).click()
    await expect(group(page, 'done').getByRole('heading')).toContainText('1 · €12.00')
    await openStatement(page)
    await expect(page.getByRole('checkbox', { name: 'Subscriptions: Music done' })).toBeChecked()
    await expect(page.getByRole('checkbox', { name: 'Subscriptions: Streaming done' })).not.toBeChecked()
    // a day and a method changed since: what is owed on the card is what it was
    expect(await owedOnCard(page)).toBe(owed)
  })
})

test.describe('Payments: with the keyboard', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('the lists come before the sums; after a tick the keyboard is on the next line, and a closed dialog gives it back', async ({ page }) => {
    await withMethods(page)
    await openPayments(page)
    const utilities = page.getByRole('checkbox', { name: 'The flat – Utilities done' })
    const rent = page.getByRole('checkbox', { name: 'The flat – Rent done' })
    const rentLine = page.getByRole('button', { name: /^The flat – Rent: €1,650\.00, on the 1st, Standing order$/ })
    // from the list's (i): the first line's tick, its name, the next line's tick
    await page.getByRole('button', { name: 'About By day' }).focus()
    await page.keyboard.press('Tab')
    await expect(rent).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(rentLine).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(utilities).toBeFocused()
    // the untracked list follows the days, and the sums follow both
    const after = async (a: Locator, b: Locator) => b.evaluate((el, other) => !!(other!.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING), await a.elementHandle())
    const firstTotal = page.getByTestId('payment-totals').getByRole('button', { name: 'By method', exact: true })
    const firstUntracked = untracked(page).getByRole('button', { name: /^Track / }).first()
    expect(await after(page.getByTestId('payments-list').getByRole('checkbox').last(), firstUntracked)).toBe(true)
    expect(await after(untracked(page).getByRole('button', { name: /^Track / }).last(), firstTotal)).toBe(true)
    // an untracked line is one stop: Tab goes from one to the next
    await firstUntracked.focus()
    await page.keyboard.press('Tab')
    await expect(untracked(page).getByRole('button', { name: /^Track Health: / })).toBeFocused()

    // Enter on a line opens "Payment"; Escape closes it, and the line has the keyboard again
    await rentLine.focus()
    await page.keyboard.press('Enter')
    await expect(payment(page)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(payment(page)).toBeHidden()
    await expect(rentLine).toBeFocused()

    // Space ticks the rent: it leaves for "Done", and the utilities, the line after it, have the focus
    await rent.focus()
    await page.keyboard.press('Space')
    await expect(group(page, 'done').getByRole('heading')).toContainText('1 · €1,650.00')
    await expect(utilities).toBeFocused()
    await page.keyboard.press('Space')
    await expect(group(page, 'overdue')).toHaveCount(0)
    await expect(page.getByRole('checkbox', { name: 'Robin – Childcare done' })).toBeFocused()
    // Enter on a sum is the press
    await page.getByTestId('payment-totals').getByRole('button', { name: /^Transfer by hand: / }).focus()
    await page.keyboard.press('Enter')
    await expect(lines(page)).toHaveText([/Robin – Childcare/])
  })
})

test.describe('Payments on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

  test('a fifth tab, the sums above the lists where they fold away, and nothing scrolls sideways', async ({ page }) => {
    await loadDemo(page)
    const tabs = rail(page)
    await tabs.getByRole('link', { name: 'Settings' }).click()
    await turnPayments(page, true)
    await expect(tabs.getByRole('link')).toHaveText(['Statement', 'Grid', 'Payments', 'Trends', 'Settings'])
    await tabs.getByRole('link', { name: 'Payments' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Payments' })).toBeVisible()
    const sideways = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(await sideways()).toBe(0)

    // the totals stand above the list
    const totals = page.getByTestId('payment-totals')
    const list = page.getByTestId('payments-list')
    expect((await totals.boundingBox())!.y).toBeLessThan((await list.boundingBox())!.y)
    // folded, the list comes up; the device remembers it
    const top = (await list.boundingBox())!.y
    await totals.getByRole('button', { name: 'By method', exact: true }).click()
    await expect(totals.getByRole('button', { name: /^Direct debit: / })).toHaveCount(0)
    expect((await list.boundingBox())!.y).toBeLessThan(top)
    await page.reload()
    await expect(page.getByTestId('payment-totals').getByRole('button', { name: 'By method', exact: true })).toHaveAttribute('aria-expanded', 'false')
    await page.getByTestId('payment-totals').getByRole('button', { name: 'By method', exact: true }).click()

    // a tick, a sum and an untracked line are finger-sized
    const tick = page.getByRole('checkbox', { name: 'Robin – Childcare done' })
    expect((await tick.boundingBox())!.height).toBeGreaterThanOrEqual(44)
    expect((await page.getByTestId('payment-totals').getByRole('button', { name: /^Direct debit: / }).boundingBox())!.height).toBeGreaterThanOrEqual(44)
    expect((await lines(untracked(page)).first().boundingBox())!.height).toBeGreaterThanOrEqual(44)
    await tick.click()
    await expect(page.getByTestId('payments-summary')).toContainText('€380.00 done')
    // an untracked line is pressed anywhere: "Payment" fits the screen
    await lines(untracked(page)).first().click({ position: { x: 20, y: 22 } })
    await expect(payment(page)).toBeVisible()
    expect(await sideways()).toBe(0)
    await payment(page).getByRole('button', { name: 'Cancel' }).click()
    expect(await sideways()).toBe(0)
    await page.screenshot({ path: 'e2e/output/payments-phone.png', fullPage: true })
  })
})

test.describe('Payments: the day on the Statement', () => {
  test.use({ viewport: { width: 1440, height: 900 } })
  const dayOn = (page: Page, row: string) => page.locator('[data-line]').filter({ hasText: row }).first().locator('[data-day]')

  test('a line says its day, quietly, only while payments are planned; pressed, it opens the month\'s payments at that line', async ({ page }) => {
    await loadDemo(page)
    await page.getByRole('button', { name: 'Expand all' }).click()
    await expect(page.locator('[data-day]')).toHaveCount(0)
    await page.getByRole('button', { name: 'Colours and marks' }).click()
    await expect(page.getByText('The day an amount goes out')).toHaveCount(0)
    await page.keyboard.press('Escape')

    await openHousehold(page)
    await turnPayments(page, true)
    await openStatement(page)
    // the demo household's four amounts with a day say it after their name; nothing else on the page has one
    await expect(page.locator('[data-day]')).toHaveText(['1st', '12th', '25th', '28th'])
    await expect(dayOn(page, 'The flat – Rent')).toHaveAccessibleName('Paid on the 1st: show in Payments')
    await page.getByRole('button', { name: 'Colours and marks' }).click()
    await expect(page.getByText('The day an amount goes out')).toBeVisible()
    await page.keyboard.press('Escape')
    await page.screenshot({ path: 'e2e/output/payments-statement-days.png' })

    // pressed: the Payments page, on this month, with the line marked for a moment
    await dayOn(page, 'Robin – Childcare').click()
    await expect(page.getByRole('heading', { level: 1, name: 'Payments' })).toBeVisible()
    await expect(page.getByRole('heading', { level: 2, name: 'November 2026' })).toBeVisible()
    await expect(page.locator('[data-marked]')).toHaveText(/Wed 25\s*Robin – Childcare/)
    await expect(page.locator('[data-marked]')).toHaveCount(0)
    // the day did not open the row's dialog on the way
    await expect(page.getByRole('dialog')).toHaveCount(0)

    // from another month of the Statement the page opens on that month; a line that is done is shown all the same
    await openStatement(page)
    await openMonth(page, 'October 2026')
    const paid = page.getByRole('checkbox', { name: 'The flat – Rent done' })
    await paid.click()
    await expect(paid).toBeChecked()
    await dayOn(page, 'The flat – Rent').click()
    await expect(page.getByRole('heading', { level: 1, name: 'Payments' })).toBeVisible()
    await expect(page.getByRole('heading', { level: 2, name: 'October 2026' })).toBeVisible()
    await expect(page.locator('[data-marked]')).toHaveText(/Thu 1\s*The flat – Rent/)
    await expect(group(page, 'done').getByRole('button', { name: /^Done/ })).toHaveAttribute('aria-expanded', 'true')
    // a later visit starts on the current month again
    await openStatement(page)
    await openPayments(page)
    await expect(page.getByRole('heading', { level: 2, name: 'November 2026' })).toBeVisible()
  })

  test('items that go out on different days each say their own, and the row says none', async ({ page }) => {
    await withMethods(page)
    await openStatement(page)
    await usuallyPaid(page, 'Health', '8th', null)
    await page.getByRole('button', { name: /^Subscriptions:/ }).click()
    const dlg = page.getByRole('dialog', { name: /^Subscriptions · / })
    await dlg.getByRole('button', { name: 'Add item' }).click()
    await dlg.getByLabel('Item label').last().fill('Music')
    await dlg.getByLabel('Item amount').last().fill('12')
    await dlg.getByLabel('Paid on, Music').selectOption('20th')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    await page.getByRole('button', { name: 'Items of Subscriptions' }).click()
    const subs = page.locator('[data-line]').filter({ hasText: 'Subscriptions' }).first()
    await expect(subs.locator('[data-day]')).toHaveCount(0)
    await expect(page.locator('[data-line]').filter({ hasText: 'Streaming' }).locator('[data-day]')).toHaveCount(0)
    const music = page.locator('[data-line]').filter({ hasText: 'Music' }).locator('[data-day]')
    await expect(music).toHaveText('20th')
    await music.click()
    await expect(page.locator('[data-marked]')).toHaveText(/Fri 20\s*Music\s*Subscriptions/)
    await expect(page.locator('[data-marked]')).toHaveCount(1)
  })
})
