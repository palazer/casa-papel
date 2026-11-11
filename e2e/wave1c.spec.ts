import { expect, test, type Page } from '@playwright/test'

async function loadDemo(page: Page) {
  await page.goto('?demo=1&screen=grid')
  await page.getByRole('button', { name: 'Load the demo household' }).click()
  await expect(page.getByRole('button', { name: /^The flat – Rent Nov 2026/ })).toBeVisible()
}

test.describe('wave 1c', () => {
  // service workers are blocked so page.route can stand in for the rate service
  test.use({ viewport: { width: 1400, height: 900 }, serviceWorkers: 'block' })

  test('a USD investment account, a manual rate, a pool, and a real value pinned from the grid', async ({ page }) => {
    // the rate service cannot be reached: a new currency then has no rate until one is typed
    await page.route('https://api.frankfurter.dev/**', (r) => r.abort())
    await loadDemo(page)
    await page.getByRole('link', { name: 'Household' }).click()

    // investment account in another currency
    await page.getByRole('button', { name: 'Add account' }).click()
    const dlg = page.getByRole('dialog')
    await dlg.getByLabel('Name', { exact: true }).fill('Broker')
    await dlg.getByLabel('Type').selectOption('investment')
    // the short form asks the name, the type and what it holds; the rest waits behind "More options"
    await expect(dlg.getByLabel('Growth per year (%)')).toHaveCount(0)
    await dlg.getByRole('button', { name: /^More options/ }).click()
    await expect(dlg.getByLabel('Currency').locator('option').first()).toHaveText('EUR (household currency)')
    await dlg.getByLabel('Currency').selectOption('USD')
    await expect(dlg).toContainText('The rates come from the European Central Bank by themselves')
    await dlg.getByLabel('Holds at the start of September 2026 (USD)').fill('10000')
    await expect(dlg.getByLabel('Growth per year (%)')).toBeVisible()
    await dlg.getByLabel('Growth per year (%)').fill('6')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()

    // the rates card now needs EUR/USD; November gets a manual rate
    await expect(page.getByRole('columnheader', { name: '1 EUR in USD' })).toBeVisible()
    const nov = page.getByLabel('1 EUR in USD for Nov 2026')
    await nov.fill('1.10')
    await nov.press('Tab')
    await expect(page.getByText('manual', { exact: true }).first()).toBeVisible()
    await page.screenshot({ path: 'e2e/output/fx-card.png', fullPage: true })

    // a pool with a monthly amount and a spending row
    await page.getByRole('button', { name: 'Add virtual account' }).click()
    await page.getByRole('dialog').getByLabel('Name', { exact: true }).fill('Gifts')
    await page.getByRole('dialog').getByLabel(/^Set aside each month/).fill('50')
    await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click()
    await expect(page.getByRole('dialog')).toBeHidden()
    await expect(page.getByText(/filled by the row "Gifts pool"/)).toBeVisible()

    // grid: balances show the broker and the pool; pin a real value and watch December project from it
    await page.getByRole('link', { name: 'Grid' }).click()
    await expect(page.getByText('Virtual account · Gifts')).toBeVisible()
    await expect(page.getByRole('button', { name: /^Gifts pool Nov 2026/ })).toContainText('50')
    const brokerNov = page.getByRole('button', { name: /^Broker · value Nov 2026/ })
    await expect(brokerNov).toBeVisible()
    await brokerNov.click()
    await expect(page.getByText('Deposited so far')).toBeVisible()
    await page.getByLabel('Real balance in USD').fill('10500')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByRole('dialog')).toBeHidden()
    await expect(brokerNov).toContainText('10,500')
    // 6% a year is 0.4868% a month: 10,500 → 10,551
    await expect(page.getByRole('button', { name: /^Broker · value Dec 2026/ })).toContainText('10,551')
    await page.screenshot({ path: 'e2e/output/balances.png' })
  })
})
