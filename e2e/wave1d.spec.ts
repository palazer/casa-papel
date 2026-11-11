import { expect, test, type Page } from '@playwright/test'

async function loadDemo(page: Page) {
  await page.goto('?demo=1')
  await page.getByRole('button', { name: 'Load the demo household' }).click()
  await expect(page.getByRole('button', { name: /^The flat – Rent Nov 2026/ })).toBeVisible()
}

test.describe('wave 1d', () => {
  test.use({ viewport: { width: 1400, height: 900 } })

  test('per-person view, proportional split, a loan and a card in Balances, net worth', async ({ page }) => {
    await loadDemo(page)

    // pooled mode: what each adult leaves for the household
    await page.getByRole('link', { name: 'Moves' }).click()
    await expect(page.getByText('Per person', { exact: true })).toBeVisible()
    await expect(page.getByRole('cell', { name: 'Leaves for the household' })).toBeVisible()
    await expect(page.getByText('Net worth', { exact: true })).toBeVisible()

    // pocket money is set on each adult's own line, not under Household: 750 for Sam from this month on
    await page.getByRole('link', { name: 'Household' }).click()
    await expect(page.getByLabel(/^Pocket money per month/)).toHaveCount(0)
    await expect(page.getByLabel('Cash buffer changes apply to')).toBeVisible()
    await page.getByRole('link', { name: 'Grid' }).click()
    await page.getByRole('button', { name: 'Row menu for Sam – Pocket' }).click()
    await page.getByRole('menuitem', { name: 'Rule…' }).click()
    const rule = page.getByRole('dialog')
    await expect(rule.getByRole('heading', { name: 'How much pocket money does Sam get?' })).toBeVisible()
    await expect(rule.getByRole('radio', { name: 'The rest' })).toHaveCount(0)
    await rule.getByLabel('Amount per month in EUR').fill('750')
    await rule.getByRole('button', { name: 'Save' }).click()
    await expect(rule).toBeHidden()
    const samPocket = page.getByRole('row', { name: /^Sam – Pocket/ })
    await expect(samPocket).toContainText('€500.00')
    await expect(samPocket).toContainText('€750.00')
    await expect(page.getByRole('row', { name: /^Alex – Pocket/ })).not.toContainText('€750.00')

    // switch to proportional contributions
    await page.getByRole('link', { name: 'Household' }).click()
    await page.getByLabel('How you share money', { exact: true }).selectOption('proportional')
    await expect(page.getByText('Shares come from')).toBeVisible()
    await expect(page.getByRole('cell', { name: 'Keeps' })).toBeVisible()
    await page.screenshot({ path: 'e2e/output/shares-card.png', fullPage: true })

    await page.getByRole('link', { name: 'Moves' }).click()
    await expect(page.getByText(/Shared lines are split/)).toBeVisible()
    await expect(page.getByRole('columnheader', { name: 'Sam' })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: 'Alex' })).toBeVisible()
    await expect(page.getByText('Transfers per person')).toBeVisible()
    await page.screenshot({ path: 'e2e/output/who-pays-what.png', fullPage: true })

    // a loan and a credit card
    await page.getByRole('link', { name: 'Household' }).click()
    const dlg = page.getByRole('dialog')
    await page.getByRole('button', { name: 'Add account' }).click()
    await dlg.getByLabel('Name', { exact: true }).fill('Car loan')
    await dlg.getByLabel('Type').selectOption('loan')
    await expect(dlg.getByText('What is still owed. A payment row that names this loan brings it down.')).toBeVisible()
    await dlg.getByLabel('Owed at the start of September 2026 (EUR)').fill('5000')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    await page.getByRole('button', { name: 'Add account' }).click()
    await dlg.getByLabel('Name', { exact: true }).fill('Visa')
    await dlg.getByLabel('Type').selectOption('credit-card')
    // the card question in plain words; everything bought with it is the usual answer
    await expect(dlg.getByRole('radiogroup', { name: 'What do you record for this card?' }).getByRole('radio')).toHaveText(['Everything I buy with it', 'Only what I pay to it'])
    await expect(dlg.getByRole('radio', { name: 'Everything I buy with it' })).toBeChecked()
    await dlg.getByLabel(/^Owed at the start of/).fill('300')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()

    // grid: debts in Balances, net worth at the bottom
    await page.getByRole('link', { name: 'Grid' }).click()
    await expect(page.getByRole('button', { name: /^Car loan · outstanding Nov 2026/ })).toContainText('5,000')
    await expect(page.getByRole('button', { name: /^Visa · owed Nov 2026/ })).toContainText('300')
    await expect(page.getByRole('rowheader', { name: 'Net worth' })).toBeVisible()
    await page.screenshot({ path: 'e2e/output/balances-debts.png' })
  })
})
