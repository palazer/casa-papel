import { expect, test, type Page } from '@playwright/test'

async function loadDemo(page: Page) {
  await page.goto('?demo=1')
  await page.getByRole('button', { name: 'Load the demo household' }).click()
  await expect(page.getByRole('button', { name: /^The flat – Rent Nov 2026/ })).toBeVisible()
}

test.describe('wave 2a', () => {
  test.use({ viewport: { width: 1400, height: 900 } })

  test('goals: a pool target and a loan to clear, edit and delete, colour screenshots', async ({ page }) => {
    await loadDemo(page)
    await page.screenshot({ path: 'e2e/output/wave2a-grid.png' })

    await page.getByRole('link', { name: 'Moves' }).click()
    await expect(page.getByText('No goals yet.', { exact: false })).toBeVisible()
    const dlg = page.getByRole('dialog')

    // a pool account goal with a target month
    await page.getByRole('button', { name: 'Add goal' }).click()
    await expect(dlg.getByRole('heading', { name: 'New goal' })).toBeVisible()
    await dlg.getByLabel('Name').fill('Travel fund')
    // two kinds; "Fill an account" lists accounts and pool accounts together
    await expect(dlg.getByRole('radiogroup', { name: 'Kind' }).getByRole('radio')).toHaveText(['Fill an account', 'Pay down a debt'])
    await expect(dlg.getByRole('radio', { name: 'Fill an account' })).toBeChecked()
    await expect(dlg.getByText('or a pool account, reaches an amount')).toBeVisible()
    await dlg.getByLabel('Tracks').selectOption({ label: 'Travel' })
    await dlg.getByLabel(/^Target \(EUR\)/).fill('1000')
    await dlg.getByLabel('Target month: month').selectOption('6')
    await dlg.getByLabel('Target month: year').selectOption('2027')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    const travel = page.getByRole('progressbar', { name: 'Travel fund' })
    await expect(travel).toBeVisible()
    const pct = Number(await travel.getAttribute('aria-valuenow'))
    expect(pct).toBeGreaterThan(0)
    expect(pct).toBeLessThanOrEqual(100)
    await expect(page.getByText(/of €1,000\.00/)).toBeVisible()

    // validation stays inside the dialog
    await page.getByRole('button', { name: 'Add goal' }).click()
    await dlg.getByLabel('Name').fill('Nonsense')
    await dlg.getByLabel(/^Target \(EUR\)/).fill('abc')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg.getByRole('alert')).toContainText('not a number')
    await dlg.getByRole('button', { name: 'Cancel' }).click()
    await expect(dlg).toBeHidden()

    // a loan, then a goal to clear it
    await page.getByRole('link', { name: 'Household' }).click()
    await page.getByRole('button', { name: 'Add account' }).click()
    await dlg.getByLabel('Name', { exact: true }).fill('Car loan')
    await dlg.getByLabel('Type').selectOption('loan')
    await dlg.getByLabel('Opening balance').fill('5000')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    await page.screenshot({ path: 'e2e/output/wave2a-household.png', fullPage: true })

    await page.getByRole('link', { name: 'Moves' }).click()
    await page.getByRole('button', { name: 'Add goal' }).click()
    await dlg.getByLabel('Name').fill('Clear the car loan')
    await dlg.getByRole('radio', { name: 'Pay down a debt' }).click()
    await dlg.getByLabel('Tracks').selectOption({ label: 'Car loan' })
    // a debt is brought down to an amount, zero unless another is typed
    await expect(dlg.getByLabel(/^Target \(/)).toHaveCount(0)
    await expect(dlg.getByLabel('Bring it down to (EUR)')).toHaveValue('0')
    await expect(dlg.getByText('Zero means nothing is owed on Car loan.', { exact: false })).toBeVisible()
    await page.screenshot({ path: 'e2e/output/wave2a-goal-new.png' })
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    const loan = page.getByRole('progressbar', { name: 'Clear the car loan' })
    await expect(loan).toHaveAttribute('aria-valuenow', '0')
    await expect(page.getByText(/still owed, down from €5,000\.00/)).toBeVisible()
    await page.screenshot({ path: 'e2e/output/wave2a-moves.png', fullPage: true })

    // editing asks for the amount only: what a goal watches is settled. The loan now comes down to 2,000
    await page.getByText('Clear the car loan', { exact: true }).locator('..').getByRole('button', { name: 'Edit' }).click()
    await expect(dlg.getByRole('heading', { name: 'Edit goal' })).toBeVisible()
    await expect(dlg.getByRole('radiogroup', { name: 'Kind' })).toHaveCount(0)
    await expect(dlg.getByLabel('Tracks')).toHaveCount(0)
    await dlg.getByLabel('Bring it down to (EUR)').fill('2000')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    await expect(page.getByText(/still owed, going down from €5,000\.00 to €2,000\.00/)).toBeVisible()

    // edit, then delete with a second click to confirm
    const travelRow = page.getByText('Travel fund', { exact: true }).locator('..')
    await travelRow.getByRole('button', { name: 'Edit' }).click()
    await expect(dlg.getByRole('heading', { name: 'Edit goal' })).toBeVisible()
    await expect(dlg.getByLabel(/^Target \(EUR\)/)).toHaveValue('1000')
    await dlg.getByLabel('Name').fill('Travel fund 2027')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    await expect(page.getByRole('progressbar', { name: 'Travel fund 2027' })).toBeVisible()

    // "Delete…" hands over to the remove dialog, which names the goal and deletes it
    await page.getByText('Travel fund 2027', { exact: true }).locator('..').getByRole('button', { name: 'Edit' }).click()
    await dlg.getByRole('button', { name: 'Delete…' }).click()
    await expect(dlg.getByRole('heading', { name: 'Goal "Travel fund 2027"' })).toBeVisible()
    await expect(dlg.getByText('What it watched is not touched.')).toBeVisible()
    await dlg.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(dlg).toBeHidden()
    await expect(page.getByRole('progressbar', { name: 'Travel fund 2027' })).toHaveCount(0)
    await expect(loan).toBeVisible()
  })
})

test.describe('wave 2a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

  test('month view shows the goals strip once a goal exists', async ({ page }) => {
    await page.goto('?demo=1')
    await page.getByRole('button', { name: 'Load the demo household' }).click()
    await expect(page.getByRole('heading', { name: 'November 2026' })).toBeVisible()
    await expect(page.getByText('Goals', { exact: true })).toHaveCount(0)

    // a net worth goal is set from its own line on the Statement, where nothing needs choosing
    await page.getByRole('navigation', { name: 'Screens' }).getByRole('link', { name: 'Statement' }).click()
    await page.getByRole('region', { name: 'Debts and net worth' }).getByRole('button', { name: 'Set a goal for Net worth' }).click()
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

    await page.getByRole('link', { name: 'Month' }).click()
    await expect(page.getByRole('heading', { name: 'November 2026' })).toBeVisible()
    await expect(page.getByRole('progressbar', { name: 'Net worth 30k' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Add goal' })).toHaveCount(0)
    await page.screenshot({ path: 'e2e/output/wave2a-month-phone.png', fullPage: true })
  })
})
