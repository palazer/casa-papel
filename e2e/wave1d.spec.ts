import { expect, test, type Page } from '@playwright/test'

async function loadDemo(page: Page) {
  await page.goto('?demo=1&screen=grid')
  await page.getByRole('button', { name: 'Load the demo household' }).click()
  await expect(page.getByRole('button', { name: /^The flat – Rent Nov 2026/ })).toBeVisible()
}

test.describe('wave 1d', () => {
  test.use({ viewport: { width: 1400, height: 900 } })

  test('per-person view, pocket money on its own line, a loan and a card in Balances, net worth', async ({ page }) => {
    await loadDemo(page)

    // what each adult brings, spends on themselves and takes closes the Statement; there is one way of sharing, so nothing to choose
    await page.getByRole('link', { name: 'Statement' }).click()
    const perPerson = page.getByTestId('per-person')
    await expect(perPerson.getByRole('heading', { name: 'Per person' })).toBeVisible()
    await expect(perPerson.getByRole('columnheader')).toHaveText(['Sam', 'Alex'])
    await expect(perPerson.getByRole('rowheader')).toHaveText(['Income', 'Own spending', 'Pocket money', 'Leaves for the household'])
    // Sam brings 4,200, spends 110 on Sam and takes 500: 3,590 is left for the household
    await expect(perPerson.getByRole('row', { name: /^Leaves for the household/ })).toContainText('+€3,590.00')
    await expect(page.getByText('Who pays what')).toHaveCount(0)
    await perPerson.scrollIntoViewIfNeeded()
    await page.screenshot({ path: 'e2e/output/statement-per-person.png' })

    // pocket money is set on each adult's own line, not under Household: 750 for Sam from this month on
    await page.getByRole('link', { name: 'Household' }).click()
    await expect(page.getByLabel(/^Pocket money per month/)).toHaveCount(0)
    await expect(page.getByLabel('Cash buffer changes apply to')).toBeVisible()
    await expect(page.getByLabel('How you share money')).toHaveCount(0)
    await expect(page.getByText('Shares come from')).toHaveCount(0)
    await expect(page.getByLabel('Who pays for Robin')).toHaveCount(0)
    await page.screenshot({ path: 'e2e/output/household-settings.png' })
    await page.getByRole('link', { name: 'Grid' }).click()
    await page.getByRole('button', { name: 'Row menu for Sam – Pocket' }).click()
    await page.getByRole('menuitem', { name: 'Rule…' }).click()
    const rule = page.getByRole('dialog')
    await expect(rule.getByRole('heading', { name: 'How much pocket money does Sam get?' })).toBeVisible()
    await expect(rule.getByRole('radio', { name: 'The rest' })).toHaveCount(0)
    await rule.getByLabel('Amount per month in EUR').fill('750')
    await rule.getByRole('button', { name: 'Save' }).click()
    await expect(rule).toBeHidden()
    await page.getByRole('button', { name: 'Earlier months (2)' }).click()
    const samPocket = page.getByRole('row', { name: /^Sam – Pocket/ })
    await expect(samPocket).toContainText('€500.00')
    await expect(samPocket).toContainText('€750.00')
    await expect(page.getByRole('row', { name: /^Alex – Pocket/ })).not.toContainText('€750.00')

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
