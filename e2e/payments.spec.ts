import { expect, openMonth, saveAnyway, test, type Locator, type Page } from './test'

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

test.describe('Payments: the switch and the payment methods', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('off, nothing of it is there; on, the list of methods starts from the accounts', async ({ page }) => {
    await loadDemo(page)
    await openHousehold(page)
    await expect(planSwitch(page)).not.toBeChecked()
    await expect(page.getByRole('heading', { name: 'Payment methods' })).toHaveCount(0)

    await turnPayments(page, true)
    await expect(page.getByRole('heading', { name: 'Payment methods' })).toBeVisible()
    const starter = page.getByTestId('starter-methods')
    await expect(starter.getByRole('checkbox')).toHaveCount(4)
    await expect(starter.getByRole('checkbox', { name: /^Direct debit/ })).toBeChecked()
    await expect(starter.getByRole('checkbox', { name: /^Credit card · credit card on Credit card/ })).toBeChecked()
    await starter.getByRole('checkbox', { name: /^Transfer by hand/ }).uncheck()
    await starter.getByRole('button', { name: 'Add 3 methods' }).click()
    await expect(starter).toHaveCount(0)
    await expect(methods(page).getByRole('listitem')).toHaveCount(3)
    await expect(methods(page).getByRole('listitem').nth(0)).toContainText('direct debit')
    await expect(methods(page).getByRole('listitem').nth(0)).toContainText('Direct debit')
    await expect(methods(page).getByRole('listitem').nth(0)).toContainText('on Main account')
    // the card is Sam's in the demo household, and so is its method
    await expect(methods(page).getByRole('listitem').nth(2)).toContainText('on Credit card · Sam')

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

  test('a method is added, changed and removed; a kind only offers what it can draw on', async ({ page }) => {
    await loadDemo(page)
    await openHousehold(page)
    await turnPayments(page, true)
    await methods(page).getByRole('button', { name: 'Add method' }).click()
    const dialog = page.getByRole('dialog', { name: 'New payment method' })
    await expect(dialog.getByTestId('pm-kind-help')).toContainText('Collected from the account')
    // a direct debit cannot draw on a credit card
    await expect(dialog.getByLabel('Draws on', { exact: true }).getByRole('option', { name: /Credit card/ })).toHaveCount(0)
    await dialog.getByLabel('Kind', { exact: true }).selectOption('Wallet')
    await expect(dialog.getByTestId('pm-kind-help')).toContainText('PayPal')
    await dialog.getByLabel('Draws on', { exact: true }).selectOption({ label: 'Credit card (credit card)' })
    await expect(dialog.getByRole('button', { name: 'Save' })).toBeDisabled()
    await dialog.getByLabel('Name', { exact: true }).fill('PayPal')
    await dialog.getByLabel('Who pays with it', { exact: true }).selectOption({ label: 'Alex' })
    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect(dialog).toBeHidden()
    const line = methods(page).getByRole('listitem').filter({ hasText: 'PayPal' })
    await expect(line).toContainText('wallet')
    await expect(line).toContainText('on Credit card · Alex')

    await line.getByRole('button', { name: 'Edit' }).click()
    const edit = page.getByRole('dialog', { name: 'Edit payment method' })
    await edit.getByLabel('Name', { exact: true }).fill('PayPal (Alex)')
    await edit.getByRole('button', { name: 'Save' }).click()
    await expect(methods(page).getByRole('listitem').filter({ hasText: 'PayPal (Alex)' })).toBeVisible()

    // nothing uses it yet, so it can be deleted
    await methods(page).getByRole('listitem').filter({ hasText: 'PayPal (Alex)' }).getByRole('button', { name: 'Edit' }).click()
    await page.getByRole('dialog', { name: 'Edit payment method' }).getByRole('button', { name: 'Delete' }).click()
    await expect(methods(page).getByRole('listitem').filter({ hasText: 'PayPal' })).toHaveCount(0)
  })
})

/** The demo household with payments planned and the first list of methods: a direct debit, a standing order and a transfer on the main account, and the credit card. */
async function withMethods(page: Page) {
  await loadDemo(page)
  await openHousehold(page)
  await turnPayments(page, true)
  await page.getByTestId('starter-methods').getByRole('button', { name: 'Add 4 methods' }).click()
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
/** What is owed on the demo's card at the end of the month on screen. */
async function owedOnCard(page: Page): Promise<number> {
  const text = await page.locator('[data-line^="acc:"]').filter({ hasText: 'Credit card' }).first().innerText()
  const amounts = text.match(/-?€[\d,]+\.\d\d/g) ?? []
  return Number((amounts[amounts.length - 1] ?? '').replace(/[€,]/g, ''))
}

test.describe('Payments: "Paid on" and "Paid with"', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('"Usually paid…" in the row menu: a day and a method for the row, and a card the row was on reads as that card\'s method', async ({ page }) => {
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
    await paidWith(dlg).selectOption({ label: 'Standing order' })
    // on the main account: nothing follows for the figures
    await expect(dlg.getByTestId('method-effect')).toHaveCount(0)
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    await page.getByRole('button', { name: 'Row menu for The flat – Rent' }).click()
    await page.getByRole('menuitem', { name: 'Usually paid…' }).click()
    expect([await shown(paidOn(dlg)), await shown(paidWith(dlg))]).toEqual(['1st', 'Standing order'])
    await dlg.getByRole('button', { name: 'Cancel' }).click()

    // "Subscriptions" was put on the card with "Paid by card…": that choice is the card's method now
    const owed = await owedOnCard(page)
    await page.getByRole('button', { name: 'Row menu for Subscriptions' }).click()
    await expect(page.getByRole('menuitem', { name: 'Paid by card…' })).toHaveCount(0)
    await page.getByRole('menuitem', { name: 'Usually paid…' }).click()
    expect(await shown(paidWith(dlg))).toBe('Credit card')
    await expect(dlg.getByTestId('method-effect')).toHaveText('Bought on "Credit card": the amount is owed there until the card is paid.')
    // paid by direct debit instead: off the card, in every month, so the months that are over are asked about
    await paidWith(dlg).selectOption({ label: 'Direct debit' })
    await expect(dlg.getByTestId('method-effect')).toHaveCount(0)
    await dlg.getByRole('button', { name: 'Save' }).click()
    await saveAnyway(page)
    await expect(dlg).toBeHidden()
    expect(await owedOnCard(page)).toBeLessThan(owed)
    expect(await owedOnCard(page)).toBe(0)
  })

  test('the amount\'s dialog: "Usually paid" is saved with the amount, and a method on another account sets "Comes out of"', async ({ page }) => {
    await withMethods(page)
    await methods(page).getByRole('button', { name: 'Add method' }).click()
    const add = page.getByRole('dialog', { name: 'New payment method' })
    await add.getByLabel('Kind', { exact: true }).selectOption('Standing order')
    await add.getByLabel('Name', { exact: true }).fill('From savings')
    await add.getByLabel('Draws on', { exact: true }).selectOption({ label: 'Savings' })
    await add.getByRole('button', { name: 'Save' }).click()
    await expect(add).toBeHidden()
    await openStatement(page)

    await page.getByRole('button', { name: /^Groceries:/ }).click()
    const dlg = page.getByRole('dialog', { name: /^Groceries · / })
    const usual = dlg.getByTestId('usually-paid')
    await expect(usual).toContainText('For this row, in every month.')
    await paidOn(usual).selectOption('15th')
    await paidWith(usual).selectOption({ label: 'Direct debit' })
    await expect(usual).toContainText('saved with the amount')
    await expect(dlg.getByLabel('Comes out of', { exact: true })).toBeEnabled()
    await dlg.getByLabel('Amount in EUR').fill('720')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    await expect(page.getByRole('button', { name: /^Groceries:/ })).toHaveAccessibleName(/^Groceries: €720\.00/)

    // a method that pays from the savings account: the amount comes out of it, and the field says who set it
    await page.getByRole('button', { name: /^Groceries:/ }).click()
    expect([await shown(paidOn(usual)), await shown(paidWith(usual))]).toEqual(['15th', 'Direct debit'])
    await paidWith(usual).selectOption({ label: 'From savings' })
    await expect(usual.getByTestId('method-effect')).toHaveText('Paid from "Savings", so the amount comes out of that account too.')
    await expect(dlg.getByLabel('Comes out of', { exact: true })).toBeDisabled()
    expect(await shown(dlg.getByLabel('Comes out of', { exact: true }))).toContain('Savings')
    await expect(dlg.getByTestId('source-by-method')).toBeVisible()
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
    // nothing of its own yet: it follows the row, which is on the card
    expect([await shown(day), await shown(method)]).toEqual(['No day', 'Usual: Credit card'])
    await day.selectOption('5th')
    await method.selectOption({ label: 'Direct debit' })
    // it repeats, so the dialog asks how far the change goes
    await dlg.getByRole('radio', { name: 'This and following months' }).click()
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    // paid by direct debit from the main account: no longer bought on the card this month
    expect(await owedOnCard(page)).toBe(owed - 18)

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
  })
})


const rail = (page: Page) => page.getByRole('navigation', { name: 'Screens' })
async function openPayments(page: Page) {
  await rail(page).getByRole('link', { name: 'Payments' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Payments' })).toBeVisible()
}
/** "Usually paid…" from the row's menu on the Statement: a day and a method on the main account, which asks nothing. */
async function usuallyPaid(page: Page, row: string, day: string | null, method: string | null) {
  await page.getByRole('button', { name: `Row menu for ${row}`, exact: true }).click()
  await page.getByRole('menuitem', { name: 'Usually paid…' }).click()
  const dlg = page.getByRole('dialog', { name: 'Usually paid' })
  if (day) await paidOn(dlg).selectOption(day)
  if (method) await paidWith(dlg).selectOption({ label: method })
  await dlg.getByRole('button', { name: 'Save' }).click()
  await expect(dlg).toBeHidden()
}
/** The demo household with its methods, and three rows with a day: the 1st (past), the 15th (the tests' today) and the 25th. */
async function withDays(page: Page) {
  await withMethods(page)
  await openStatement(page)
  await usuallyPaid(page, 'The flat – Rent', '1st', 'Standing order')
  await usuallyPaid(page, 'The flat – Utilities', '15th', 'Direct debit')
  await usuallyPaid(page, 'Robin – Childcare', '25th', 'Transfer by hand')
}
const group = (page: Page, key: string) => page.locator(`[data-group="${key}"]`)
const lines = (scope: Page | Locator) => scope.locator('[data-payment]')
const euros = (text: string) => Number(text.replace(/[^\d.-]/g, ''))
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
    // no methods and no days yet: everything stands under "No day yet", and the page says where the methods are added
    await expect(page.getByTestId('payments-no-methods')).toBeVisible()
    await expect(page.locator('[data-group]')).toHaveCount(1)
    await expect(group(page, 'no-day').getByRole('heading')).toContainText('No day yet')
    await expect(page.getByTestId('payments-summary')).toContainText('to pay')
    await expect(page.getByTestId('payments-summary')).not.toContainText('overdue')
    // the address is the page's own, and a reload stays on it
    await page.reload()
    await expect(page.getByRole('heading', { level: 1, name: 'Payments' })).toBeVisible()

    await page.getByTestId('payments-no-methods').getByRole('button', { name: 'Add them under Household' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Household' })).toBeVisible()
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
    await expect(lines(group(page, 'coming'))).toHaveText([/Wed 25\s*Robin – Childcare\s*Transfer by hand\s*by hand/])
    await expect(group(page, 'no-day').getByRole('heading')).toContainText('No day yet')
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

    // a line opens its amount's dialog, the one the Statement opens
    await page.getByRole('button', { name: /^Robin – Childcare: €380\.00, on the 25th, Transfer by hand/ }).click()
    const amount = page.getByRole('dialog', { name: 'Robin – Childcare · November 2026' })
    await expect(amount.getByTestId('usually-paid')).toBeVisible()
    await amount.getByRole('button', { name: 'Cancel' }).click()

    // "Set…" on a line without a day: the row's usual day and method
    await page.getByRole('button', { name: 'Set the day and method of Groceries' }).click()
    const set = page.getByRole('dialog', { name: 'Usually paid' })
    await expect(set).toContainText('Row "Groceries"')
    await paidOn(set).selectOption('20th')
    await set.getByRole('button', { name: 'Save' }).click()
    await expect(set).toBeHidden()
    await expect(lines(group(page, 'coming'))).toHaveText([/Fri 20\s*Groceries\s*no method/, /Wed 25\s*Robin – Childcare/])
    await expect(page.getByRole('button', { name: 'Set the day and method of Groceries' })).toHaveCount(0)

    // another month has no "late" and no "today": what has a day is to pay, by day
    await openMonth(page, 'December 2026')
    await expect(page.locator('[data-group]')).toHaveCount(2)
    await expect(group(page, 'open').getByRole('heading')).toContainText('To pay')
    await expect(lines(group(page, 'open'))).toHaveText([/Tue 1\s*The flat – Rent/, /Tue 15\s*The flat – Utilities/, /Sun 20\s*Groceries/, /Fri 25\s*Robin – Childcare/])
    await expect(page.getByTestId('payments-summary')).not.toContainText('overdue')
  })

  test('the totals add up to the list, and a pressed total leaves only its payments', async ({ page }) => {
    await withDays(page)
    await openPayments(page)
    const totals = page.getByTestId('payment-totals')
    const all = await amounts(page)
    // an account's own sum is its first line; its methods follow
    const accountTotals = (await totals.locator('[data-account-total] > button:first-child').allInnerTexts()).map((t) => euros(t.split('\n').pop() ?? ''))
    expect(total(accountTotals)).toBe(total(all))
    // "to pay" is the list without what is bought on a card (the demo's subscriptions, 18)
    await expect(page.getByTestId('payments-summary')).toContainText(`€${(total(all) - 18).toLocaleString('en-GB', { minimumFractionDigits: 2 })} to pay`)

    // the main account: everything that leaves it, then one of its methods
    const main = totals.getByRole('button', { name: /^Main account: / })
    await main.click()
    await expect(main).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId('payments-filter')).toContainText('Only Main account')
    const ofMain = await amounts(page)
    await expect(main).toHaveAccessibleName(new RegExp(`^Main account: €${total(ofMain).toLocaleString('en-GB', { minimumFractionDigits: 2 })} leaves it`))
    const order = totals.getByRole('button', { name: /^Standing order on Main account: €1,650\.00, 1 payment$/ })
    await order.click()
    await expect(main).toHaveAttribute('aria-pressed', 'false')
    await expect(lines(page)).toHaveText([/The flat – Rent/])
    await expect(page.getByTestId('payments-filter')).toContainText('Only Standing order on Main account')
    // pressed again, or "Show all": the whole list
    await order.click()
    await expect(page.getByTestId('payments-filter')).toHaveCount(0)
    await expect(lines(page)).toHaveCount(all.length)

    // the card: what was bought on it, what is owed, and that nothing pays it off this month
    const card = totals.locator('[data-account-total="Credit card"]')
    await expect(card.getByRole('button', { name: /^Credit card: €18\.00 bought on it$/ })).toBeVisible()
    await expect(card.getByTestId('card-owed')).toContainText('Owed at the end of November 2026')
    await expect(card.getByTestId('card-paid-by')).toHaveText('Nothing pays it off in November 2026.')
    await card.getByRole('button', { name: /^Credit card: / }).click()
    await expect(lines(page)).toHaveText([/Subscriptions\s*Credit card\s*on card/])
    await page.getByTestId('payments-filter').getByRole('button', { name: 'Show all' }).click()

    // by person: the card is Sam's, so what is bought on it is Sam's to pay
    const people = page.getByTestId('payment-people')
    await people.getByRole('button', { name: /^Sam: €18\.00/ }).click()
    await expect(lines(page)).toHaveText([/Subscriptions/])
    await expect(page.getByTestId('payments-filter')).toContainText('Only Sam')
    // another month starts with the whole list again
    await openMonth(page, 'December 2026')
    await expect(page.getByTestId('payments-filter')).toHaveCount(0)
  })

  test('two things in one row, each paid its own way: two lines, and only the card\'s one is bought on the card', async ({ page }) => {
    await withMethods(page)
    await openStatement(page)
    const owed = await owedOnCard(page)
    await page.getByRole('button', { name: /^Subscriptions:/ }).click()
    const dlg = page.getByRole('dialog', { name: /^Subscriptions · / })
    await dlg.getByRole('button', { name: 'Add item' }).click()
    await dlg.getByLabel('Item label').last().fill('Music')
    await dlg.getByLabel('Item amount').last().fill('12')
    await dlg.getByLabel('Paid on, Music').selectOption('20th')
    await dlg.getByLabel('Paid with, Music').selectOption({ label: 'Direct debit' })
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    // the row is on the card, and the new item is not: what is owed on the card does not move
    expect(await owedOnCard(page)).toBe(owed)

    await openPayments(page)
    await expect(page.getByRole('button', { name: /^Subscriptions: Music: €12\.00, on the 20th, Direct debit$/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /^Subscriptions: Streaming: €18\.00, no day yet, Credit card$/ })).toBeVisible()
    const music = lines(page).filter({ hasText: 'Music' })
    await expect(music).toHaveText(/Fri 20\s*Music\s*Subscriptions\s*Direct debit/)
    await expect(music).not.toContainText('on card')
    await expect(lines(page).filter({ hasText: 'Streaming' })).toContainText('on card')
    // one item of several is set in the amount's dialog: no "Set…" on its line
    await expect(lines(page).filter({ hasText: 'Streaming' }).getByRole('button', { name: /^Set the day/ })).toHaveCount(0)
    const totals = page.getByTestId('payment-totals')
    await expect(totals.getByRole('button', { name: /^Credit card: €18\.00 bought on it$/ })).toBeVisible()
    await expect(totals.getByRole('button', { name: /^Direct debit on Main account: €12\.00, 1 payment$/ })).toBeVisible()

    // each has a tick of its own, and it is the item's tick on the Statement
    await page.getByRole('checkbox', { name: 'Subscriptions: Music done' }).click()
    await expect(group(page, 'done').getByRole('heading')).toContainText('1 · €12.00')
    await openStatement(page)
    await expect(page.getByRole('checkbox', { name: 'Subscriptions: Music done' })).toBeChecked()
    await expect(page.getByRole('checkbox', { name: 'Subscriptions: Streaming done' })).not.toBeChecked()
  })
})

test.describe('Payments on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

  test('a fifth tab, the totals above the list where they fold away, and nothing scrolls sideways', async ({ page }) => {
    await loadDemo(page)
    const tabs = rail(page)
    await tabs.getByRole('link', { name: 'Settings' }).click()
    await turnPayments(page, true)
    await page.getByTestId('starter-methods').getByRole('button', { name: 'Add 4 methods' }).click()
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
    await totals.getByRole('button', { name: 'By account and method', exact: true }).click()
    await expect(totals.getByRole('button', { name: /^Main account: / })).toHaveCount(0)
    expect((await list.boundingBox())!.y).toBeLessThan(top)
    await page.reload()
    await expect(page.getByTestId('payment-totals').getByRole('button', { name: 'By account and method', exact: true })).toHaveAttribute('aria-expanded', 'false')
    await page.getByTestId('payment-totals').getByRole('button', { name: 'By account and method', exact: true }).click()

    // a tick and a line are finger-sized, and a total too
    const tick = page.getByRole('checkbox', { name: 'Groceries done' })
    expect((await tick.boundingBox())!.height).toBeGreaterThanOrEqual(44)
    expect((await page.getByTestId('payment-totals').getByRole('button', { name: /^Main account: / }).boundingBox())!.height).toBeGreaterThanOrEqual(44)
    await tick.click()
    await expect(page.getByTestId('payments-summary')).toContainText('€700.00 done')
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
    await page.getByTestId('starter-methods').getByRole('button', { name: 'Add 4 methods' }).click()
    await openStatement(page)
    await usuallyPaid(page, 'The flat – Rent', '1st', 'Standing order')
    await usuallyPaid(page, 'Robin – Childcare', '25th', 'Transfer by hand')
    // the two rows with a day say it after their name; nothing else on the page has one
    await expect(page.locator('[data-day]')).toHaveText(['1st', '25th'])
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
