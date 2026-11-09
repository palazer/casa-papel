import { expect, test } from '@playwright/test'

// service workers are blocked so page.route can stand in for the rate service
test.use({ viewport: { width: 1400, height: 900 }, serviceWorkers: 'block' })

async function loadDemo(page: import('@playwright/test').Page) {
  await page.goto('?demo=1')
  await page.getByRole('button', { name: 'Load the demo household' }).click()
  await expect(page.getByRole('button', { name: /^The flat – Rent Nov 2026/ })).toBeVisible()
}

test('the welcome screen offers three ways to start, and the wizard can go back to it', async ({ page }) => {
  await page.goto('/')
  for (const name of ['Start on this device', 'Sign in', 'I have an invite', 'Look at the demo first', 'Import a file']) {
    await expect(page.getByRole('button', { name, exact: true })).toBeVisible()
  }
  await expect(page.getByText('Welcome to Casa Papel')).toBeVisible()
  await page.screenshot({ path: 'e2e/output/welcome.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: 'e2e/output/welcome-phone.png', fullPage: true })
  await page.setViewportSize({ width: 1400, height: 900 })
  await page.getByRole('button', { name: 'Start on this device' }).click()
  await expect(page.getByLabel('Household name')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sign in' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Back to start' }).click()
  await expect(page.getByRole('button', { name: 'Start on this device' })).toBeVisible()
  // the sandbox leads with the demo
  await page.goto('?demo=1')
  await expect(page.getByRole('button', { name: 'Load the demo household' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Leave the demo' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sign in' })).toHaveCount(0)
})

test('the plan ends in a December and "Add <year>" appends a calendar year on every screen', async ({ page }) => {
  await loadDemo(page)
  // November: next year is already planned, so the button offers the year after
  await expect(page.getByText(/Sept? 2026 – Dec 2027/)).toBeVisible()
  await page.getByRole('button', { name: 'Add 2028' }).click()
  await expect(page.getByText(/– Dec 2028/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Dec 2028', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Add 2029' })).toBeVisible()

  // the Month view shares the range: at its last month Next gives way to the same action
  await page.getByRole('navigation', { name: 'Screens' }).getByRole('link', { name: 'Month' }).click()
  const next = page.getByRole('button', { name: 'Next month' })
  const add = page.getByRole('button', { name: 'Add 2029' })
  for (let i = 0; i < 40 && !(await add.isVisible()); i++) await next.click()
  await expect(add).toBeVisible()
  await expect(page.getByRole('heading', { name: 'December 2028' })).toBeVisible()
})

test('a pool account below zero is shown in the expense hue', async ({ page }) => {
  await loadDemo(page)
  const travel = page.getByRole('row', { name: /^Pool account · Travel/ })
  await expect(travel).toBeVisible()
  await expect(travel.locator('td.text-expense').first()).toBeVisible()
  await expect(travel.locator('td.text-expense').first()).toHaveText(/^-€/)
})

test('a row in another currency: the typed amount, the household value beneath, one rate per month', async ({ page }) => {
  await loadDemo(page)
  await page.getByRole('button', { name: 'Row menu for Other income' }).click()
  await page.getByRole('menuitem', { name: 'Currency…' }).click()
  const dlg = page.getByRole('dialog')
  await dlg.getByLabel('Amounts in this row are in', { exact: true }).selectOption('USD')
  await dlg.getByRole('button', { name: 'Save' }).click()
  await expect(dlg).toBeHidden()
  await expect(page.getByRole('row', { name: /^Other income/ })).toContainText('USD')

  // no rate yet: the editor says so; a rate typed here applies to the whole month
  await page.getByRole('button', { name: /^Other income Nov 2026/ }).click()
  await page.getByRole('tab', { name: 'Single amount' }).click()
  await page.getByLabel('Amount in USD').fill('1000')
  const rate = page.getByTestId('rate-line')
  await expect(rate).toContainText('missing')
  await rate.getByRole('button', { name: "Change this month's rate…" }).click()
  await page.getByLabel('1 EUR =').fill('1.10')
  await rate.getByRole('button', { name: 'Save rate' }).click()
  await expect(rate).toContainText('manual')
  await expect(rate).toContainText('€909.09')
  await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeHidden()
  await expect(page.getByRole('button', { name: /^Other income Nov 2026: (US)?\$1,000\.00, about €/ })).toBeVisible()
  await page.screenshot({ path: 'e2e/output/foreign-row.png' })

  // the rates table shares the rate and reads it the way people say it
  await page.getByRole('navigation', { name: 'Screens' }).getByRole('link', { name: 'Household' }).click()
  await expect(page.getByRole('columnheader', { name: '1 EUR in USD' })).toBeVisible()
  await expect(page.getByLabel('1 EUR in USD for Nov 2026')).toHaveValue('1.10')

  // back to the ECB: the manual rate goes and that month is fetched again
  await page.route('https://api.frankfurter.dev/**', (r) => r.fulfill({ json: { rates: { '2026-11-02': { USD: 1.08 } } } }))
  await page.getByRole('navigation', { name: 'Screens' }).getByRole('link', { name: 'Grid' }).click()
  await page.getByRole('button', { name: /^Other income Nov 2026/ }).click()
  await page.getByTestId('rate-line').getByRole('button', { name: 'Use the ECB rate again' }).click()
  await expect(page.getByTestId('rate-line')).toContainText('ECB')
  await expect(page.getByTestId('rate-line')).toContainText('€925.93')
  await page.screenshot({ path: 'e2e/output/rate-line.png' })

  // tabbing through the rates table leaves an ECB month as it is
  await page.keyboard.press('Escape')
  await page.getByRole('navigation', { name: 'Screens' }).getByRole('link', { name: 'Household' }).click()
  const nov = page.getByLabel('1 EUR in USD for Nov 2026')
  await expect(nov).toHaveValue('1.08')
  await nov.focus()
  await nov.press('Tab')
  await page.waitForTimeout(300)
  const novRow = page.getByRole('row', { name: /^Nov 2026/ })
  await expect(novRow.getByText('ECB', { exact: true })).toBeVisible()
  await expect(novRow.getByText('manual', { exact: true })).toHaveCount(0)
})

test('a foreign-currency account shows its household-currency value beneath', async ({ page }) => {
  await loadDemo(page)
  await page.getByRole('navigation', { name: 'Screens' }).getByRole('link', { name: 'Household' }).click()
  await page.getByRole('button', { name: 'Add account' }).click()
  const dlg = page.getByRole('dialog')
  await dlg.getByLabel('Name', { exact: true }).fill('Broker')
  await dlg.getByLabel('Type').selectOption('investment')
  await dlg.getByLabel('Currency').fill('USD')
  await dlg.getByLabel('Opening balance').fill('10000')
  await dlg.getByLabel('Growth per year (%)').fill('0')
  await dlg.getByRole('button', { name: 'Save' }).click()
  await expect(dlg).toBeHidden()
  const nov = page.getByLabel('1 EUR in USD for Nov 2026')
  await nov.fill('1.25')
  await nov.press('Tab')
  await expect(page.getByText('manual', { exact: true }).first()).toBeVisible()

  await page.getByRole('navigation', { name: 'Screens' }).getByRole('link', { name: 'Grid' }).click()
  await expect(page.getByRole('rowheader', { name: 'Broker · in EUR' })).toBeVisible()
  await expect(page.getByRole('row', { name: /^Broker · in EUR/ })).toContainText('€8,000.00')

  await page.getByRole('navigation', { name: 'Screens' }).getByRole('link', { name: 'Month' }).click()
  await expect(page.getByText(/≈ €8,000\.00/)).toBeVisible()
})

test('an expense deducted from an income: the tag, the net line and the editor block', async ({ page }) => {
  await loadDemo(page)
  await page.getByRole('button', { name: 'Row menu for Health' }).click()
  await page.getByRole('menuitem', { name: 'Deducted from an income…' }).click()
  const dlg = page.getByRole('dialog')
  await dlg.getByLabel('This expense is taken off', { exact: true }).selectOption({ label: 'Sam – Salary' })
  await dlg.getByRole('button', { name: 'Save' }).click()
  await expect(dlg).toBeHidden()
  await expect(page.getByRole('row', { name: /^Health/ })).toContainText('out of Sam – Salary')

  // Health is €30 a month in the demo: the salary shows what is left, and the editor lists the deduction
  const salary = page.getByRole('button', { name: /^Sam – Salary Nov 2026: €4,200\.00, net €4/ })
  await expect(salary).toBeVisible()
  await salary.click()
  const block = page.getByTestId('deductions')
  await expect(block).toContainText('Health')
  await expect(block).toContainText('−€30.00')
  await expect(block).toContainText('€4,170.00')
  await page.screenshot({ path: 'e2e/output/deduction.png' })
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toBeHidden()

  // the menu now names the income; the Month view carries the net line
  await page.getByRole('button', { name: 'Row menu for Health' }).click()
  await expect(page.getByRole('menuitem', { name: 'Deducted from Sam – Salary…' })).toBeVisible()
  await page.keyboard.press('Escape')
  await page.getByRole('navigation', { name: 'Screens' }).getByRole('link', { name: 'Month' }).click()
  await expect(page.getByText(/net €4/).first()).toBeVisible()
})

test('a row can follow a share of another row', async ({ page }) => {
  await loadDemo(page)
  await page.getByRole('button', { name: 'Row menu for To investments' }).click()
  await page.getByRole('menuitem', { name: 'Follow another row…' }).click()
  const dlg = page.getByRole('dialog')
  await dlg.getByLabel('Same amount as').selectOption({ label: 'Robin – Child benefit' })
  await dlg.getByLabel('Share (%)', { exact: true }).fill('50')
  await dlg.getByRole('button', { name: 'Save' }).click()
  await expect(dlg).toBeHidden()
  const row = page.getByRole('row', { name: /^To investments/ })
  await expect(row).toContainText('= 50% of Robin – Child benefit')
  // the child benefit is €255 in the demo
  await expect(row).toContainText('€127.50')
})

test('"Belongs to" gives a row to one adult, and Who pays what routes it to them', async ({ page }) => {
  await loadDemo(page)
  // an income row also offers the split check
  await page.getByRole('button', { name: 'Row menu for Other income' }).click()
  await page.getByRole('menuitem', { name: 'Belongs to…' }).click()
  await expect(page.getByRole('dialog').getByRole('checkbox', { name: 'Counts for the split' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toBeHidden()

  await page.getByRole('button', { name: 'Row menu for Groceries' }).click()
  await page.getByRole('menuitem', { name: 'Belongs to…' }).click()
  const dlg = page.getByRole('dialog')
  await expect(dlg.getByRole('checkbox', { name: 'Counts for the split' })).toHaveCount(0)
  await dlg.getByLabel('This row is for', { exact: true }).selectOption({ label: 'Sam' })
  await dlg.getByRole('button', { name: 'Save' }).click()
  await expect(dlg).toBeHidden()

  await page.getByRole('navigation', { name: 'Screens' }).getByRole('link', { name: 'Household' }).click()
  await page.getByLabel('How you share money', { exact: true }).selectOption('proportional')
  await page.getByRole('navigation', { name: 'Screens' }).getByRole('link', { name: 'Moves' }).click()
  await expect(page.getByRole('row', { name: /^Groceries/ })).toContainText('own')
})
