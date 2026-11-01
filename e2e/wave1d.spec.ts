import { expect, test, type Page } from '@playwright/test'

async function loadDemo(page: Page) {
  await page.goto('?demo=1')
  await page.getByRole('button', { name: 'Load the demo household' }).click()
  await expect(page.getByRole('button', { name: /^Rent Nov 2026/ })).toBeVisible()
}

test.describe('wave 1d', () => {
  test.use({ viewport: { width: 1400, height: 900 } })

  test('per-person view, proportional split, a loan and a card in Balances, net worth', async ({ page }) => {
    await loadDemo(page)

    // pooled mode: what each adult leaves for the household
    await page.getByRole('button', { name: 'Moves' }).click()
    await expect(page.getByText('Per person', { exact: true })).toBeVisible()
    await expect(page.getByRole('cell', { name: 'Leaves for the household' })).toBeVisible()
    await expect(page.getByText('Net worth', { exact: true })).toBeVisible()

    // switch to proportional contributions
    await page.getByRole('button', { name: 'Household' }).click()
    await page.getByLabel('How you share money').selectOption('proportional')
    await expect(page.getByText('Shares come from')).toBeVisible()
    await expect(page.getByRole('cell', { name: 'Keeps' })).toBeVisible()
    await page.screenshot({ path: 'e2e/output/shares-card.png', fullPage: true })

    await page.getByRole('button', { name: 'Moves' }).click()
    await expect(page.getByText(/Shared lines are split/)).toBeVisible()
    await expect(page.getByRole('columnheader', { name: 'Sam' })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: 'Alex' })).toBeVisible()
    await expect(page.getByText('Transfers per person')).toBeVisible()
    await page.screenshot({ path: 'e2e/output/who-pays-what.png', fullPage: true })

    // a loan and a credit card
    await page.getByRole('button', { name: 'Household' }).click()
    const dlg = page.getByRole('dialog')
    await page.getByRole('button', { name: 'Add account' }).click()
    await dlg.getByLabel('Name', { exact: true }).fill('Car loan')
    await dlg.getByLabel('Type').selectOption('loan')
    await expect(dlg.getByText('Opening balance is the amount still owed')).toBeVisible()
    await dlg.getByLabel('Opening balance').fill('5000')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    await page.getByRole('button', { name: 'Add account' }).click()
    await dlg.getByLabel('Name', { exact: true }).fill('Visa')
    await dlg.getByLabel('Type').selectOption('credit-card')
    await expect(dlg.getByLabel('How you record card spending')).toBeVisible()
    await dlg.getByLabel('Opening balance').fill('300')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()

    // grid: debts in Balances, net worth at the bottom
    await page.getByRole('button', { name: 'Grid' }).click()
    await expect(page.getByRole('button', { name: /^Car loan · outstanding Nov 2026/ })).toContainText('5,000')
    await expect(page.getByRole('button', { name: /^Visa · owed Nov 2026/ })).toContainText('300')
    await expect(page.getByRole('rowheader', { name: 'Net worth' })).toBeVisible()
    await page.screenshot({ path: 'e2e/output/balances-debts.png' })
  })
})
