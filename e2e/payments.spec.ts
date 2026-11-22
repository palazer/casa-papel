import { expect, saveAnyway, test, type Locator, type Page } from './test'

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

