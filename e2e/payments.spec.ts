import { expect, test, type Page } from './test'

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
