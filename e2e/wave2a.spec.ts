import { expect, test, type Page } from '@playwright/test'

async function loadDemo(page: Page) {
  await page.goto('?demo=1&screen=grid')
  await page.getByRole('button', { name: 'Load the demo household' }).click()
  await expect(page.getByRole('button', { name: /^The flat – Rent Nov 2026/ })).toBeVisible()
}

test.describe('wave 2a', () => {
  test.use({ viewport: { width: 1400, height: 900 } })

  test('goals: a pool target and a loan to clear, edit and delete, colour screenshots', async ({ page }) => {
    await loadDemo(page)
    await page.screenshot({ path: 'e2e/output/wave2a-grid.png' })

    // a goal starts on the line it watches; there is no list of goals to start one from
    await page.getByRole('link', { name: 'Statement' }).click()
    const assets = page.getByRole('region', { name: 'Assets' })
    const claims = page.getByRole('region', { name: 'Debts and net worth' })
    const dlg = page.getByRole('dialog')

    // a virtual account goal with a target month; validation stays inside the dialog
    await assets.getByRole('button', { name: 'Set a goal for Travel' }).click()
    await expect(dlg.getByRole('heading', { name: 'Goal for Travel' })).toBeVisible()
    await expect(dlg.getByText('Fills Travel to an amount.')).toBeVisible()
    await dlg.getByLabel('Name').fill('Travel fund')
    await dlg.getByLabel(/^Target \(EUR\)/).fill('abc')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg.getByRole('alert')).toContainText('not a number')
    await dlg.getByLabel(/^Target \(EUR\)/).fill('1000')
    await dlg.getByLabel('Target month: month').selectOption('6')
    await dlg.getByLabel('Target month: year').selectOption('2027')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    // the line carries the goal's mark and opens to its bar
    await assets.getByRole('button', { name: 'Travel', exact: true }).click()
    const travel = page.getByRole('progressbar', { name: 'Travel fund' })
    await expect(travel).toBeVisible()
    const pct = Number(await travel.getAttribute('aria-valuenow'))
    expect(pct).toBeGreaterThan(0)
    expect(pct).toBeLessThanOrEqual(100)
    await expect(assets.getByText(/of €1,000\.00/)).toBeVisible()

    // a loan, then a goal to clear it
    await page.getByRole('link', { name: 'Household' }).click()
    await page.getByRole('button', { name: 'Add account' }).click()
    await dlg.getByLabel('Name', { exact: true }).fill('Car loan')
    await dlg.getByLabel('Type').selectOption('loan')
    await dlg.getByLabel(/^Owed at the start of/).fill('5000')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    await page.screenshot({ path: 'e2e/output/wave2a-household.png', fullPage: true })

    await page.getByRole('link', { name: 'Statement' }).click()
    await claims.getByRole('button', { name: 'Set a goal for Car loan' }).click()
    await expect(dlg.getByRole('heading', { name: 'Goal for Car loan' })).toBeVisible()
    await dlg.getByLabel('Name').fill('Clear the car loan')
    // a debt is brought down to an amount, zero unless another is typed
    await expect(dlg.getByLabel(/^Target \(/)).toHaveCount(0)
    await expect(dlg.getByLabel('Bring it down to (EUR)')).toHaveValue('0')
    await expect(dlg.getByText('Zero means nothing is owed on Car loan.', { exact: false })).toBeVisible()
    await page.screenshot({ path: 'e2e/output/wave2a-goal-new.png' })
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    await claims.getByRole('button', { name: 'Car loan', exact: true }).click()
    const loan = page.getByRole('progressbar', { name: 'Clear the car loan' })
    await expect(loan).toHaveAttribute('aria-valuenow', '0')
    await expect(claims.getByText(/still owed, down from €5,000\.00/)).toBeVisible()
    await page.screenshot({ path: 'e2e/output/wave2a-statement.png', fullPage: true })

    // editing asks for the amount only: what a goal watches is settled. The loan now comes down to 2,000
    await claims.getByRole('button', { name: 'Edit goal Clear the car loan' }).click()
    await expect(dlg.getByRole('heading', { name: 'Edit goal' })).toBeVisible()
    await expect(dlg.getByRole('radiogroup', { name: 'Kind' })).toHaveCount(0)
    await expect(dlg.getByLabel('Tracks')).toHaveCount(0)
    await dlg.getByLabel('Bring it down to (EUR)').fill('2000')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    await expect(claims.getByText(/still owed, going down from €5,000\.00 to €2,000\.00/)).toBeVisible()

    // rename the other one
    await assets.getByRole('button', { name: 'Travel', exact: true }).click()
    await assets.getByRole('button', { name: 'Edit goal Travel fund' }).click()
    await expect(dlg.getByRole('heading', { name: 'Edit goal' })).toBeVisible()
    await expect(dlg.getByLabel(/^Target \(EUR\)/)).toHaveValue('1000')
    await dlg.getByLabel('Name').fill('Travel fund 2027')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    await expect(page.getByRole('progressbar', { name: 'Travel fund 2027' })).toBeVisible()

    // "Delete…" hands over to the remove dialog, which names the goal and deletes it; the line can take a goal again
    await assets.getByRole('button', { name: 'Edit goal Travel fund 2027' }).click()
    await dlg.getByRole('button', { name: 'Delete…' }).click()
    await expect(dlg.getByRole('heading', { name: 'Goal "Travel fund 2027"' })).toBeVisible()
    await expect(dlg.getByText('What it watched is not touched.')).toBeVisible()
    await dlg.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(dlg).toBeHidden()
    await expect(page.getByRole('progressbar', { name: 'Travel fund 2027' })).toHaveCount(0)
    await expect(assets.getByRole('button', { name: 'Set a goal for Travel' })).toHaveCount(1)
    await expect(loan).toBeVisible()
  })
})

test.describe('wave 2a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

  test('a net worth goal is set from its own line and shows its bar there', async ({ page }) => {
    await page.goto('?demo=1')
    await page.getByRole('button', { name: 'Load the demo household' }).click()
    // the Statement opens first, on a phone too
    await expect(page.getByRole('heading', { level: 1, name: 'Statement' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'November 2026' })).toBeVisible()
    await expect(page.getByRole('progressbar')).toHaveCount(0)

    // nothing needs choosing: the line says what the goal watches
    const claims = page.getByRole('region', { name: 'Debts and net worth' })
    await claims.getByRole('button', { name: 'Set a goal for Net worth' }).click()
    const dlg = page.getByRole('dialog')
    await expect(dlg.getByRole('heading', { name: 'Goal for net worth' })).toBeVisible()
    await expect(dlg.getByRole('radiogroup', { name: 'Kind' })).toHaveCount(0)
    await expect(dlg.getByLabel('Tracks')).toHaveCount(0)
    await expect(dlg.getByLabel('Name')).toHaveValue('Net worth')
    await expect(dlg).toHaveCSS('opacity', '1')
    await page.screenshot({ path: 'e2e/output/wave2a-goal-phone.png' })
    await dlg.getByLabel('Name').fill('Net worth 30k')
    await dlg.getByLabel(/^Target \(EUR\)/).fill('30000')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()

    await expect(claims.locator('[data-line="net-worth"]')).toContainText('Goal Net worth 30k:')
    await expect(page.getByRole('progressbar', { name: 'Net worth 30k' })).toBeVisible()
    await expect(claims.getByRole('button', { name: 'Set a goal for Net worth' })).toHaveCount(0)
    await page.screenshot({ path: 'e2e/output/wave2a-statement-phone.png', fullPage: true })
  })
})
