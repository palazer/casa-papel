import { expect, test, type Page } from '@playwright/test'

async function openStatement(page: Page) {
  await page.goto('?demo=1')
  await page.getByRole('button', { name: 'Load the demo household' }).click()
  await page.getByRole('navigation', { name: 'Screens' }).getByRole('link', { name: 'Statement' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Statement' })).toBeVisible()
}

/** The demo household starts in September 2026: walk back to it, then forward to the month wanted. */
async function goToMonth(page: Page, name: string) {
  const prev = page.getByRole('button', { name: 'Previous month' })
  while (await prev.isEnabled()) await prev.click()
  await expect(page.getByRole('heading', { level: 2, name: 'September 2026' })).toBeVisible()
  for (let i = 0; i < 24 && !(await page.getByRole('heading', { level: 2, name }).isVisible()); i++) await page.getByRole('button', { name: 'Next month' }).click()
  await expect(page.getByRole('heading', { level: 2, name })).toBeVisible()
}

const total = (page: Page, side: 'in' | 'out' | 'assets' | 'claims') => page.getByTestId(`total-${side}`)

test.describe('the Statement', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('a closed month: both halves balance, categories open to rows and items', async ({ page }) => {
    await openStatement(page)
    await expect(page.getByRole('navigation', { name: 'Screens' }).getByRole('link', { name: 'Statement' })).toHaveAttribute('aria-current', 'page')
    await goToMonth(page, 'September 2026')
    await expect(page.getByText('closed', { exact: true })).toBeVisible()

    // the month: money in equals money out
    await expect(total(page, 'in')).toHaveText('Total in€7,255.00')
    await expect(total(page, 'out')).toHaveText('Total out€7,255.00')
    const moneyOut = page.getByRole('region', { name: 'Money out' })
    await expect(moneyOut.locator('[data-line="expenses"]')).toContainText('€4,357.00')
    await expect(moneyOut.locator('[data-line="rowless"]')).toHaveCount(0)

    // the position: assets equal debts and net worth, in balances and in the month's change
    const assets = (await total(page, 'assets').innerText()).replace(/^Total\s*/, '')
    const claims = (await total(page, 'claims').innerText()).replace(/^Total\s*/, '')
    expect(assets).toBe(claims)
    await expect(total(page, 'assets')).toContainText('€23,060.00')
    const position = page.getByRole('region', { name: 'Debts and net worth' })
    await expect(position.locator('[data-line="net-worth"]')).toContainText('€23,018.00')
    await expect(position.locator('[data-line="free"]')).toContainText('€21,968.00')
    // virtual accounts sit under the savings account that holds them
    const assetsSide = page.getByRole('region', { name: 'Assets' })
    await expect(assetsSide.getByText('Travel', { exact: true })).toBeVisible()
    await expect(assetsSide.getByText('Not set aside')).toBeVisible()
    // the demo has a main and a joint account: one line for what stays in them
    await expect(assetsSide.getByText('Current accounts')).toBeVisible()

    // a category opens to its rows, an itemized row to its items
    await expect(moneyOut.getByText('Sam – Personal')).toHaveCount(0)
    await moneyOut.getByRole('button', { name: 'Personal', exact: true }).click()
    await expect(moneyOut.getByText('Sam – Personal')).toBeVisible()
    await expect(moneyOut.getByText('Concert tickets')).toHaveCount(0)
    await moneyOut.getByRole('button', { name: 'Items of Sam – Personal' }).click()
    await expect(moneyOut.getByText('Concert tickets')).toBeVisible()
    await expect(moneyOut.getByText('Books')).toBeVisible()
    // a category opens and closes from anywhere on its line, not only from the arrow and the name
    const personal = moneyOut.locator('[data-line^="cat:expense:"]').filter({ hasText: 'Personal' })
    const box = (await personal.boundingBox())!
    await personal.click({ position: { x: box.width - 30, y: box.height / 2 } })
    await expect(moneyOut.getByText('Sam – Personal')).toHaveCount(0)
    await personal.click({ position: { x: box.width / 2, y: box.height / 2 } })
    await expect(moneyOut.getByText('Sam – Personal')).toBeVisible()
    // a closed month is locked: nothing to tick, no line opens the editor
    await expect(page.getByRole('checkbox')).toHaveCount(0)
    await expect(moneyOut.getByRole('button', { name: /^Alex – Personal:/ })).toHaveCount(0)
    await page.screenshot({ path: 'e2e/output/statement-closed.png', fullPage: true })

    // "Expand all" and "Collapse all"
    await page.getByRole('button', { name: 'Expand all' }).click()
    await expect(moneyOut.getByText('The flat – Rent')).toBeVisible()
    await page.getByRole('button', { name: 'Collapse all' }).click()
    await expect(moneyOut.getByText('The flat – Rent')).toHaveCount(0)
    await expect(assetsSide.getByText('Not set aside')).toHaveCount(0)

    // a closed month counts as done and can be reopened from here; the legend sits in the toolbar
    await expect(page.getByTestId('progress')).toHaveText('Closed · all done')
    await expect(page.getByRole('button', { name: 'Close month' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Reopen month' })).toBeVisible()
    await page.getByRole('button', { name: 'What the colours and marks mean' }).click()
    await expect(page.getByRole('dialog').getByText('An estimate: on the yellow shade', { exact: false })).toBeVisible()
    await page.keyboard.press('Escape')
    // reopened, the month can be worked and closed again
    await page.getByRole('button', { name: 'Reopen month' }).click()
    await expect(page.getByText('closed', { exact: true })).toHaveCount(0)
    await expect(page.getByTestId('progress')).toHaveText(/^(\d+ of \d+ done|All \d+ done)/)
    await expect(page.getByRole('checkbox', { name: 'To savings done' })).toBeVisible()
    await page.getByRole('button', { name: 'Close month' }).click()
    await expect(page.getByText('closed', { exact: true })).toBeVisible()
    await expect(page.getByTestId('progress')).toHaveText('Closed · all done')
    await expect(page.getByRole('checkbox')).toHaveCount(0)
    await expect(total(page, 'in')).toHaveText('Total in€7,255.00')
  })

  test('spending from a virtual account shows on both sides', async ({ page }) => {
    await openStatement(page)
    await goToMonth(page, 'October 2026')
    const moneyIn = page.getByRole('region', { name: 'Money in' })
    // one section for everything that came out of the accounts; what the trip took out of Travel is a calculated line in it
    await expect(moneyIn.locator('[data-line="from-accounts"]')).toContainText('From accounts')
    await expect(moneyIn.locator('[data-line="from-accounts"]')).toContainText('€480.00')
    await expect(moneyIn.locator('[data-line^="src:"]')).toContainText(['Travel'])
    await expect(moneyIn.locator('[data-line^="src:"]').first()).toContainText('calculated')
    await expect(moneyIn.getByText('Taken from accounts')).toHaveCount(0)
    await expect(moneyIn.getByText('From savings and virtual accounts')).toHaveCount(0)
    const totalIn = (await total(page, 'in').innerText()).replace(/^Total in\s*/, '')
    const totalOut = (await total(page, 'out').innerText()).replace(/^Total out\s*/, '')
    expect(totalIn).toBe(totalOut)
    await page.screenshot({ path: 'e2e/output/statement.png', fullPage: true })
  })
})

test.describe('working the month in the Statement', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  const euros = (text: string) => Number(text.replace(/[^0-9.]/g, ''))

  test('an estimate is shaded until it is overwritten as certain; ticks mark rows and items done', async ({ page }) => {
    await openStatement(page)
    await goToMonth(page, 'November 2026')
    const moneyOut = page.getByRole('region', { name: 'Money out' })
    const dlg = page.getByRole('dialog')

    // an estimate sits on the yellow shade, and so does the category above it
    const housing = moneyOut.locator('[data-line^="cat:expense"]').filter({ hasText: 'Housing' })
    await expect(housing.locator('[data-estimate]')).toHaveText('€1,860.00')
    await moneyOut.getByRole('button', { name: 'Housing', exact: true }).click()
    const utilities = moneyOut.getByRole('button', { name: /^The flat – Utilities:/ })
    await expect(utilities).toHaveAccessibleName('The flat – Utilities: €210.00, an estimate')
    // the shade sits on the amount, beside the line's button
    const utilitiesLine = moneyOut.locator('[data-line]').filter({ has: page.getByRole('button', { name: /^The flat – Utilities:/ }) })
    await expect(utilitiesLine.locator('[data-estimate]')).toHaveText('€210.00')
    // a certain amount is plain
    await expect(moneyOut.getByRole('button', { name: /^The flat – Rent:/ })).toHaveAccessibleName('The flat – Rent: €1,650.00')
    const rest = moneyOut.locator('[data-line]').filter({ has: page.locator('[data-rule="rest"]') })
    const restBefore = euros(await rest.innerText())

    // overwrite it for this month and say it is certain
    await utilities.click()
    await expect(dlg.getByRole('heading', { name: /The flat – Utilities/ })).toBeVisible()
    await dlg.getByLabel('Amount in EUR').fill('199')
    await dlg.getByRole('radio', { name: 'Only this month' }).click()
    await dlg.getByRole('radio', { name: 'Certain' }).click()
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    await expect(utilities).toHaveAccessibleName('The flat – Utilities: €199.00')
    await expect(utilitiesLine.locator('[data-estimate]')).toHaveCount(0)
    await expect(housing.locator('[data-estimate]')).toHaveCount(0)
    await expect(housing).toContainText('€1,849.00')
    // the 11 saved goes to the rest, and the two sides still agree
    expect(euros(await rest.innerText())).toBe(restBefore + 11)
    expect((await total(page, 'in').innerText()).replace(/^Total in\s*/, '')).toBe((await total(page, 'out').innerText()).replace(/^Total out\s*/, ''))

    // one click on a tick marks a row done, and the progress line counts it
    const progress = page.getByTestId('progress')
    await expect(progress).toHaveText(/^0 of 21 done · €[\d,.]+ still to pay · €7,405\.00 to come in$/)
    await moneyOut.getByRole('button', { name: 'Family & pets', exact: true }).click()
    const childcare = page.getByRole('checkbox', { name: 'Robin – Childcare done' })
    await expect(childcare).not.toBeChecked()
    await childcare.click()
    await expect(childcare).toBeChecked()
    await expect(progress).toHaveText(/^1 of 21 done/)

    // an automatic row can be ticked as moved but not typed over: its dialog opens on the rule that works it out
    await expect(page.getByRole('checkbox', { name: 'To savings done' })).toBeVisible()
    await moneyOut.getByRole('button', { name: /^To savings:/ }).click()
    await expect(dlg.getByRole('heading', { name: 'To savings · November 2026' })).toBeVisible()
    await expect(dlg.getByRole('radio', { name: 'The rest' })).toBeChecked()
    await expect(dlg.getByLabel('Amount in EUR')).toHaveCount(0)
    await dlg.getByRole('button', { name: 'Cancel' }).click()
    await expect(dlg).toBeHidden()
    // pocket money is a line per adult with an amount of its own
    await moneyOut.getByRole('button', { name: 'Pocket money', exact: true }).click()
    await expect(page.getByRole('checkbox', { name: 'Sam – Pocket done' })).toBeVisible()
    await expect(moneyOut.getByRole('button', { name: 'Sam – Pocket: €500.00' })).toBeVisible()

    // an itemized row opens to its items, each with a tick of its own
    await moneyOut.getByRole('button', { name: 'Living', exact: true }).click()
    await moneyOut.getByRole('button', { name: /^Health:/ }).click()
    await dlg.getByRole('tab', { name: 'Itemized' }).click()
    await dlg.getByRole('button', { name: 'Add item' }).click()
    await dlg.getByLabel('Item label').last().fill('Physio')
    // an item amount that cannot be read is said on saving, not stored as zero
    await dlg.getByLabel('Item amount').last().fill('abc')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg.getByRole('alert')).toHaveText('"Physio" has an amount that is not a number I can read.')
    await dlg.getByLabel('Item amount').last().fill('45')
    await expect(dlg.getByRole('alert')).toHaveCount(0)
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    await expect(moneyOut.getByRole('button', { name: /^Health:/ })).toHaveAccessibleName(/^Health: €75\.00/)
    await moneyOut.getByRole('button', { name: 'Items of Health' }).click()
    const physio = page.getByRole('checkbox', { name: 'Health: Physio done' })
    await physio.click()
    await expect(physio).toBeChecked()
    await expect(page.getByRole('checkbox', { name: 'Health done' })).toHaveAttribute('aria-checked', 'mixed')
    await page.screenshot({ path: 'e2e/output/statement-working.png', fullPage: true })

    // the Grid shows the same: a done dot on the row, a half dot on the partly done one
    await page.getByRole('navigation', { name: 'Screens' }).getByRole('link', { name: 'Grid' }).click()
    await expect(page.getByRole('button', { name: /^Robin – Childcare Nov 2026/ }).getByRole('img', { name: 'Done', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: /^Health Nov 2026/ }).getByRole('img', { name: /^1 of 2 done/ })).toBeVisible()
  })

  test('rows and categories are added where they will appear', async ({ page }) => {
    await openStatement(page)
    await goToMonth(page, 'November 2026')
    const moneyIn = page.getByRole('region', { name: 'Money in' })
    const moneyOut = page.getByRole('region', { name: 'Money out' })
    const dlg = page.getByRole('dialog')
    const totalIn = euros(await total(page, 'in').innerText())

    // a category appears as a line before it has a row
    await moneyOut.getByRole('button', { name: 'Add expense category' }).click()
    await moneyOut.getByLabel('New expense category name').fill('Hobbies')
    await moneyOut.getByLabel('New expense category name').press('Enter')
    const hobbies = moneyOut.locator('[data-line^="cat:expense"]').filter({ hasText: 'Hobbies' })
    await expect(hobbies).toBeVisible()

    // its first row is added inside it, and the editor opens for the amount
    await moneyOut.getByRole('button', { name: 'Hobbies', exact: true }).click()
    await moneyOut.getByRole('button', { name: 'Add row to Hobbies' }).click()
    await expect(moneyOut.getByLabel('Category for the new expense row')).toHaveValue(/.+/)
    await moneyOut.getByLabel('New expense row name').fill('Climbing')
    await moneyOut.getByRole('button', { name: 'Add', exact: true }).click()
    await expect(dlg.getByRole('heading', { name: /Climbing/ })).toBeVisible()
    await dlg.getByLabel('Amount in EUR').fill('40')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    await expect(moneyOut.getByRole('button', { name: /^Climbing:/ })).toHaveAccessibleName('Climbing: €40.00, an estimate')
    await expect(hobbies).toContainText('€40.00')

    // a row added at the foot of Income opens the editor too; the total follows and the sides still agree
    await moneyIn.getByRole('button', { name: 'Add income row' }).click()
    await moneyIn.getByLabel('New income row name').fill('Side job')
    await moneyIn.getByLabel('New income row name').press('Enter')
    await expect(dlg.getByRole('heading', { name: /Side job/ })).toBeVisible()
    await dlg.getByLabel('Amount in EUR').fill('200')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    expect(euros(await total(page, 'in').innerText())).toBe(totalIn + 200)
    expect(euros(await total(page, 'out').innerText())).toBe(totalIn + 200)
    await page.screenshot({ path: 'e2e/output/statement-adding.png', fullPage: true })
  })

  test('a category has an estimate: what is not broken down yet shrinks as rows are added, and the rows win', async ({ page }) => {
    await openStatement(page)
    await goToMonth(page, 'November 2026')
    const moneyOut = page.getByRole('region', { name: 'Money out' })
    const dlg = page.getByRole('dialog')
    const line = (name: string) => moneyOut.locator('[data-line^="cat:expense"]').filter({ hasText: name })
    const amountOf = async (name: string) => euros((await line(name).innerText()).split('\n').pop()!)
    const expenses = async () => euros((await moneyOut.locator('[data-line="expenses"]').innerText()).split('\n').pop()!)
    const rest = async () => euros((await moneyOut.locator('[data-line]').filter({ has: page.locator('[data-rule="rest"]') }).innerText()).split('\n').pop()!)
    const sidesAgree = async () => expect((await total(page, 'in').innerText()).replace(/^Total in\s*/, '')).toBe((await total(page, 'out').innerText()).replace(/^Total out\s*/, ''))
    const expensesBefore = await expenses()
    const restBefore = await rest()

    // a new category that is only a name and a number counts at once
    await moneyOut.getByRole('button', { name: 'Add expense category' }).click()
    await moneyOut.getByLabel('New expense category name').fill('Hobbies')
    await moneyOut.getByLabel('Estimate per month for the new expense category').fill('60')
    await moneyOut.getByLabel('Estimate per month for the new expense category').press('Enter')
    await expect(line('Hobbies')).toContainText('estimate €60.00')
    await expect(line('Hobbies').locator('[data-estimate]')).toHaveText('€60.00')
    expect(await expenses()).toBe(expensesBefore + 60)
    expect(await rest()).toBe(restBefore - 60)
    await sidesAgree()

    // inside it, what is not broken down yet; a row takes its share off it and the category stays at its estimate
    await moneyOut.getByRole('button', { name: 'Hobbies', exact: true }).click()
    const left = moneyOut.getByRole('button', { name: /^Not broken down yet:/ })
    await expect(left).toHaveAccessibleName('Not broken down yet: €60.00, an estimate')
    await moneyOut.getByRole('button', { name: 'Add row to Hobbies' }).click()
    await moneyOut.getByLabel('New expense row name').fill('Climbing')
    await moneyOut.getByLabel('New expense row name').press('Enter')
    await dlg.getByLabel('Amount in EUR').fill('40')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    await expect(left).toHaveAccessibleName('Not broken down yet: €20.00, an estimate')
    expect(await amountOf('Hobbies')).toBe(60)
    expect(await expenses()).toBe(expensesBefore + 60)
    await page.screenshot({ path: 'e2e/output/statement-estimate.png', fullPage: true })

    // the line opens the estimate it comes from; below what the rows add up to, the rows win
    await left.click()
    await expect(dlg.getByRole('heading', { name: 'Estimate for Hobbies · November 2026' })).toBeVisible()
    await expect(dlg.getByLabel('Estimate per month in EUR', { exact: true })).toHaveValue('60')
    await dlg.getByLabel('Estimate per month in EUR', { exact: true }).fill('30')
    await expect(dlg.getByTestId('estimate-left')).toHaveText('€0.00')
    await expect(dlg.getByText('The rows already add up to more, so Hobbies will show their sum.')).toBeVisible()
    await expect(dlg).toHaveCSS('opacity', '1')
    await page.screenshot({ path: 'e2e/output/statement-estimate-dialog.png' })
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    await expect(moneyOut.getByRole('button', { name: /^Not broken down yet:/ })).toHaveCount(0)
    await expect(line('Hobbies')).toContainText('estimate €30.00')
    expect(await amountOf('Hobbies')).toBe(40)

    // an existing category: Housing has Rent 1,650 and Utilities 210
    await moneyOut.getByRole('button', { name: 'Housing', exact: true }).click()
    await moneyOut.getByRole('button', { name: 'Set estimate for Housing' }).click()
    await dlg.getByLabel('Estimate per month in EUR', { exact: true }).fill('2000')
    await expect(dlg.getByTestId('estimate-left')).toHaveText('€140.00')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    expect(await amountOf('Housing')).toBe(2000)
    await expect(moneyOut.getByRole('button', { name: /^Not broken down yet:/ })).toHaveAccessibleName('Not broken down yet: €140.00, an estimate')
    await expect(page.getByRole('checkbox', { name: 'Not broken down yet done' })).toBeVisible()
    await sidesAgree()

    // it carries forward like any amount, and the Grid counts the same rest as an automatic row
    await page.getByRole('button', { name: 'Next month' }).click()
    await expect(page.getByRole('heading', { level: 2, name: 'December 2026' })).toBeVisible()
    expect(await amountOf('Housing')).toBe(2000)
    await page.getByRole('navigation', { name: 'Screens' }).getByRole('link', { name: 'Grid' }).click()
    await expect(page.getByText('Housing – Not broken down yet')).toBeVisible()
    await expect(page.getByRole('button', { name: /^Housing – Not broken down yet Nov 2026/ })).toHaveCount(0)

    // taking the estimate away gives the category back to its rows
    await page.getByRole('navigation', { name: 'Screens' }).getByRole('link', { name: 'Statement' }).click()
    await goToMonth(page, 'November 2026')
    await moneyOut.getByRole('button', { name: 'Housing', exact: true }).click()
    await moneyOut.getByRole('button', { name: 'Change estimate for Housing' }).click()
    await dlg.getByRole('button', { name: 'Remove estimate' }).click()
    await expect(dlg).toBeHidden()
    expect(await amountOf('Housing')).toBe(1860)
    await expect(line('Housing')).not.toContainText('estimate')
    await sidesAgree()
  })

  test('a real balance is entered from its line; a card owing more than planned counts the difference as spending', async ({ page }) => {
    await openStatement(page)
    await goToMonth(page, 'November 2026')
    const moneyOut = page.getByRole('region', { name: 'Money out' })
    const claims = page.getByRole('region', { name: 'Debts and net worth' })
    const assets = page.getByRole('region', { name: 'Assets' })
    const dlg = page.getByRole('dialog')
    const expensesBefore = euros(await moneyOut.locator('[data-line="expenses"]').innerText())
    const restBefore = euros(await moneyOut.locator('[data-line]').filter({ has: page.locator('[data-rule="rest"]') }).innerText())
    const amountOf = async (line: string) => euros((await claims.locator(`[data-line="${line}"]`).innerText()).split('\n').pop()!)
    const netWorthBefore = await amountOf('net-worth')

    // the card: the statement says 478 is owed, the plan expected 78
    await claims.getByRole('button', { name: /^Credit card balance:/ }).click()
    await expect(dlg.getByRole('heading', { name: 'Credit card · November 2026' })).toBeVisible()
    await expect(dlg.getByTestId('book-difference')).toHaveCount(0)
    await dlg.getByLabel('Real balance in EUR').fill('478')
    await expect(dlg.getByRole('checkbox', { name: 'Count the €400.00 difference as spending this month' })).toBeChecked()
    await expect(dlg.getByTestId('book-difference')).toContainText('Credit card – Not recorded')
    await expect(dlg).toHaveCSS('opacity', '1')
    await page.screenshot({ path: 'e2e/output/statement-card-balance.png' })
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()

    // the debt is 478, entered, and nothing is left unexplained: the 400 is a line of spending
    await expect(claims.getByRole('button', { name: /^Credit card balance:/ })).toHaveAccessibleName('Credit card balance: €478.00, entered')
    await expect(claims.getByText(/against the plan/)).toHaveCount(0)
    expect(euros(await moneyOut.locator('[data-line="expenses"]').innerText())).toBe(expensesBefore + 400)
    expect(euros(await moneyOut.locator('[data-line]').filter({ has: page.locator('[data-rule="rest"]') }).innerText())).toBe(restBefore - 400)
    await moneyOut.getByRole('button', { name: 'No category', exact: true }).click()
    await expect(moneyOut.getByRole('button', { name: /^Credit card – Not recorded:/ })).toHaveAccessibleName('Credit card – Not recorded: €400.00')
    await expect(page.getByRole('checkbox', { name: 'Credit card – Not recorded done' })).toBeChecked()
    expect(await amountOf('net-worth')).toBe(netWorthBefore - 400)
    expect((await total(page, 'in').innerText()).replace(/^Total in\s*/, '')).toBe((await total(page, 'out').innerText()).replace(/^Total out\s*/, ''))
    expect((await total(page, 'assets').innerText()).replace(/^Total\s*/, '')).toBe((await total(page, 'claims').innerText()).replace(/^Total\s*/, ''))

    // any other account: the balance is pinned and the line says how far it is from the plan
    await assets.getByRole('button', { name: /^Index fund balance:/ }).click()
    await dlg.getByLabel('Real balance in EUR').fill('14000')
    await expect(dlg.getByTestId('book-difference')).toHaveCount(0)
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    await expect(assets.getByRole('button', { name: /^Index fund balance:/ })).toHaveAccessibleName('Index fund balance: €14,000.00, entered')
    await expect(assets.locator('[data-line^="acc:"]').filter({ hasText: 'Index fund' })).toContainText(/entered, \+€[\d.,]+ against the plan/)
    await page.screenshot({ path: 'e2e/output/statement-balances.png', fullPage: true })
  })

  test('a goal is set from the line it watches, which then carries its mark and opens to the bar', async ({ page }) => {
    await openStatement(page)
    await goToMonth(page, 'September 2026')
    const assets = page.getByRole('region', { name: 'Assets' })
    const dlg = page.getByRole('dialog')

    // a debt offers a goal to pay it down: nothing to choose, and zero unless another amount is typed
    await page.getByRole('region', { name: 'Debts and net worth' }).getByRole('button', { name: 'Set a goal for Credit card' }).click()
    await expect(dlg.getByRole('heading', { name: 'Goal for Credit card' })).toBeVisible()
    await expect(dlg.getByRole('radiogroup', { name: 'Kind' })).toHaveCount(0)
    await expect(dlg.getByLabel('Tracks')).toHaveCount(0)
    await expect(dlg.getByLabel('Bring it down to (EUR)')).toHaveValue('0')
    await dlg.getByRole('button', { name: 'Cancel' }).click()

    // a virtual account: the line says what the goal watches, so only the name, the amount and the month are asked
    await assets.getByRole('button', { name: 'Set a goal for Travel' }).click()
    await expect(dlg.getByRole('heading', { name: 'Goal for Travel' })).toBeVisible()
    await expect(dlg.getByRole('radiogroup', { name: 'Kind' })).toHaveCount(0)
    await expect(dlg.getByLabel('Tracks')).toHaveCount(0)
    await expect(dlg.getByLabel('Name')).toHaveValue('Travel')
    await expect(dlg).toHaveCSS('opacity', '1')
    await page.screenshot({ path: 'e2e/output/statement-goal-dialog.png' })
    await dlg.getByLabel('Name').fill('Travel fund')
    await dlg.getByLabel(/^Target \(EUR\)/).fill('10000')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    await expect(assets.getByRole('button', { name: 'Set a goal for Travel' })).toHaveCount(0)
    // 800 of 10,000
    await expect(assets.locator('[data-line^="pool:"]').filter({ hasText: 'Travel' })).toContainText('Goal Travel fund:8%')
    await expect(page.getByRole('progressbar', { name: 'Travel fund' })).toHaveCount(0)
    await assets.getByRole('button', { name: 'Travel', exact: true }).click()
    await expect(page.getByRole('progressbar', { name: 'Travel fund' })).toHaveAttribute('aria-valuenow', '8')
    await expect(assets.getByText(/€800\.00 of €10,000\.00/)).toBeVisible()
    await page.screenshot({ path: 'e2e/output/statement-goal.png', fullPage: true })
    // the goal is edited from the same place
    await assets.getByRole('button', { name: 'Edit goal Travel fund' }).click()
    await expect(dlg.getByRole('heading', { name: 'Edit goal' })).toBeVisible()
    await expect(dlg.getByLabel('Name')).toHaveValue('Travel fund')
    await expect(dlg.getByLabel('Tracks')).toHaveCount(0)
    await dlg.getByRole('button', { name: 'Cancel' }).click()
  })

  test('the current accounts take their real balances: the difference shows, the next month continues, and it can be taken back', async ({ page }) => {
    await openStatement(page)
    await goToMonth(page, 'November 2026')
    const assets = page.getByRole('region', { name: 'Assets' })
    const line = assets.locator('[data-line="main"]')
    const dlg = page.getByRole('dialog')
    const sameTotals = async () => expect((await total(page, 'assets').innerText()).replace(/^Total\s*/, '')).toBe((await total(page, 'claims').innerText()).replace(/^Total\s*/, ''))

    // worked out until someone says what the bank says: the demo's main and joint account together
    await expect(line).toContainText('calculated')
    await assets.getByRole('button', { name: 'Current accounts balance: €78.00' }).click()
    await expect(dlg.getByRole('heading', { name: 'Current accounts · November 2026' })).toBeVisible()
    await expect(dlg.getByText('Worked out, together')).toBeVisible()
    await expect(dlg.getByRole('button', { name: 'Use the calculated amount' })).toBeDisabled()
    // every account or none
    await dlg.getByLabel('Main account (EUR)').fill('1150')
    await expect(dlg.getByTestId('current-balance-sum')).toHaveCount(0)
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg.getByRole('alert')).toHaveText('Fill in every account, or leave them all empty to use the calculated amount.')
    await dlg.getByLabel('Joint account (EUR)').fill('abc')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg.getByRole('alert')).toHaveText('Joint account: that is not a number I can read.')
    await dlg.getByLabel('Joint account (EUR)').fill('300')
    await expect(dlg.getByTestId('current-balance-sum')).toHaveText('Together€1,450.00Difference+€1,372.00')
    await expect(dlg).toHaveCSS('opacity', '1')
    await page.screenshot({ path: 'e2e/output/statement-current-balance-dialog.png' })
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()

    // the line reads like any other entered balance, its parts add up, and both sides still agree
    await expect(assets.getByRole('button', { name: 'Current accounts balance: €1,450.00, entered' })).toBeVisible()
    await expect(line).toContainText('entered, +€1,372.00 against the plan')
    await expect(line).not.toContainText('calculated')
    await assets.getByRole('button', { name: 'Current accounts', exact: true }).click()
    await expect(assets.locator('[data-line="main:adjustment"]')).toHaveText('Not in the plan€1,372.00')
    await sameTotals()
    await page.screenshot({ path: 'e2e/output/statement-current-balance.png', fullPage: true })

    // December is worked out again, from the real number
    await page.getByRole('button', { name: 'Next month' }).click()
    await expect(page.getByRole('heading', { level: 2, name: 'December 2026' })).toBeVisible()
    await expect(line).toContainText('calculated')
    await expect(assets.locator('[data-line="main:start"]')).toContainText('€1,450.00')
    await sameTotals()
    await page.getByRole('button', { name: 'Previous month' }).click()

    // back to the calculated amount, in one step that Undo takes back
    await assets.getByRole('button', { name: 'Current accounts balance: €1,450.00, entered' }).click()
    await expect(dlg.getByLabel('Main account (EUR)')).toHaveValue('1150')
    await dlg.getByRole('button', { name: 'Use the calculated amount' }).click()
    await expect(dlg).toBeHidden()
    await expect(assets.getByRole('button', { name: 'Current accounts balance: €78.00' })).toBeVisible()
    await expect(line).toContainText('calculated')
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect(assets.getByRole('button', { name: 'Current accounts balance: €1,450.00, entered' })).toBeVisible()

    // a closed month shows the numbers and takes no change
    await page.getByRole('button', { name: 'Close month' }).click()
    await assets.getByRole('button', { name: 'Current accounts balance: €1,450.00, entered' }).click()
    await expect(dlg.getByLabel('Main account (EUR)')).toBeDisabled()
    await expect(dlg.getByText('This month is closed. Reopen it to change the balance.')).toBeVisible()
    await expect(dlg.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  test('a rule per account: a percentage from the transfer line, another from the account, and the rest follows', async ({ page }) => {
    await openStatement(page)
    await goToMonth(page, 'November 2026')
    const moneyOut = page.getByRole('region', { name: 'Money out' })
    const assets = page.getByRole('region', { name: 'Assets' })
    const dlg = page.getByRole('dialog')
    const rest = async () => euros(await moneyOut.locator('[data-line]').filter({ has: page.locator('[data-rule="rest"]') }).innerText())
    const balanced = async () => expect((await total(page, 'in').innerText()).replace(/^Total in\s*/, '')).toBe((await total(page, 'out').innerText()).replace(/^Total out\s*/, ''))

    // every transfer to an account, and the account it feeds, carries its rule as a symbol with a name
    await expect(moneyOut.getByRole('button', { name: 'Rule for To savings: the rest' })).toBeVisible()
    await expect(assets.getByRole('button', { name: 'Rule for Savings: the rest' })).toBeVisible()
    await expect(assets.getByRole('button', { name: 'Rule for Index fund: a fixed amount' })).toBeVisible()
    await expect(assets.getByRole('button', { name: 'Rule for Clothing: a fixed amount' })).toBeVisible()
    await expect(moneyOut.getByText('the rest', { exact: true })).toHaveCount(0)
    expect(await rest()).toBe(2369)

    // one dialog per row: the name, the amount and the rule symbol all open it, with how the amount is set on top
    await moneyOut.getByRole('button', { name: /^To investments: €500\.00/ }).click()
    await expect(dlg.getByRole('heading', { name: 'To investments · November 2026' })).toBeVisible()
    await expect(dlg.getByRole('radiogroup', { name: 'How the amount is set' }).getByRole('radio')).toHaveText(['A fixed amount', 'A percentage of income', 'A percentage of one income', 'A percentage of what is left', 'The rest'])
    await expect(dlg.getByText('Applies to')).toBeVisible()
    await dlg.getByRole('button', { name: 'Cancel' }).click()
    await expect(dlg).toBeHidden()
    const investments = moneyOut.locator('[data-line]').filter({ has: page.getByRole('button', { name: /^To investments:/ }) })
    const box = (await investments.boundingBox())!
    await investments.click({ position: { x: box.width - 20, y: box.height / 2 } })
    await expect(dlg.getByRole('heading', { name: 'To investments · November 2026' })).toBeVisible()
    await dlg.getByRole('button', { name: 'Cancel' }).click()
    await expect(dlg).toBeHidden()

    // 10 % of income for the investments, from this month on
    await moneyOut.getByRole('button', { name: 'Rule for To investments: a fixed amount' }).click()
    await expect(dlg.getByRole('heading', { name: 'To investments · November 2026' })).toBeVisible()
    await expect(dlg.getByRole('radio', { name: 'A fixed amount' })).toBeChecked()
    await expect(dlg.getByLabel('Amount in EUR')).toHaveValue('500')
    // every account a rule can feed may take the rest
    await expect(dlg.getByRole('radio', { name: 'The rest' })).toBeVisible()
    await dlg.getByRole('radio', { name: 'A percentage of income' }).click()
    // the fields of the amount make way for the rule's
    await expect(dlg.getByLabel('Amount in EUR')).toHaveCount(0)
    await expect(dlg.getByText('Applies to')).toHaveCount(0)
    await expect(dlg.getByRole('button', { name: 'Save' })).toBeDisabled()
    await dlg.getByLabel('Percentage of income').fill('120')
    await expect(dlg.getByRole('alert')).toContainText('above 0 and at most 100')
    await dlg.getByLabel('Percentage of income').fill('10')
    await expect(dlg.getByRole('alert')).toHaveCount(0)
    await expect(dlg.getByLabel('Counts from: month')).toHaveValue('11')
    await expect(dlg.getByTestId('rule-preview')).toContainText('10% of €7,405.00 take-home income')
    await expect(dlg.getByTestId('rule-amount')).toHaveText('€740.50')
    await expect(dlg.getByTestId('rule-rest')).toHaveText('€2,128.50')
    await expect(dlg).toHaveCSS('opacity', '1')
    await page.screenshot({ path: 'e2e/output/statement-rule-dialog.png' })
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    await expect(moneyOut.getByRole('button', { name: 'To investments: €740.50' })).toBeVisible()
    await expect(moneyOut.getByRole('button', { name: 'Rule for To investments: 10% of income' })).toBeVisible()
    await expect(assets.getByRole('button', { name: 'Rule for Index fund: 10% of income' })).toBeVisible()
    // what the investments get more, the rest gets less
    expect(await rest()).toBe(2128.5)
    await balanced()

    // a worked-out line opens the same dialog on its rule
    await moneyOut.getByRole('button', { name: 'To investments: €740.50' }).click()
    await expect(dlg.getByRole('heading', { name: 'To investments · November 2026' })).toBeVisible()
    await expect(dlg).toContainText('Worked out by the app · currently €740.50')
    await expect(dlg.getByRole('radio', { name: 'A percentage of income' })).toBeChecked()
    await expect(dlg.getByLabel('Percentage of income')).toHaveValue('10')
    await dlg.getByRole('button', { name: 'Cancel' }).click()

    // from the account: its symbol opens the dialog of the row that fills it; the Travel virtual account takes a fifth of what is left
    await assets.getByRole('button', { name: 'Rule for Travel: a fixed amount' }).click()
    await expect(dlg.getByRole('heading', { name: 'To Travel · November 2026' })).toBeVisible()
    await dlg.getByRole('radio', { name: 'A percentage of what is left' }).click()
    await dlg.getByLabel('Percentage of what is left').fill('20')
    // its own €200 goes back into what is left first: 2,128.50 + 200
    await expect(dlg.getByTestId('rule-preview')).toContainText('20% of €2,328.50 left')
    await expect(dlg.getByTestId('rule-amount')).toHaveText('€465.70')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    await expect(moneyOut.getByRole('button', { name: 'To Travel: €465.70' })).toBeVisible()
    await expect(moneyOut.getByRole('button', { name: 'Rule for To Travel: 20% of what is left' })).toBeVisible()
    expect(await rest()).toBe(1862.8)
    await balanced()
    await page.screenshot({ path: 'e2e/output/statement-rules.png', fullPage: true })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({ path: 'e2e/output/statement-rules-phone.png', fullPage: true })
    await page.setViewportSize({ width: 1440, height: 900 })

    // the month before keeps what it showed, and December follows the rules
    await goToMonth(page, 'October 2026')
    await expect(moneyOut.getByRole('button', { name: /^To investments: €500\.00/ })).toBeVisible()
    await expect(moneyOut.getByRole('button', { name: /^To Travel: €200\.00/ })).toBeVisible()
    expect(await rest()).toBe(2009)
    // its typed amount is for that month alone, so the dialog does not ask which months it applies to
    await moneyOut.getByRole('button', { name: /^To investments: €500\.00/ }).click()
    await expect(dlg.getByLabel('Amount in EUR')).toHaveValue('500')
    await expect(dlg.getByTestId('rule-runs')).toContainText('for October 2026 alone')
    await expect(dlg.getByText('Applies to')).toHaveCount(0)
    await dlg.getByRole('button', { name: 'Cancel' }).click()
    await goToMonth(page, 'December 2026')
    await expect(moneyOut.getByRole('button', { name: 'To investments: €740.50' })).toBeVisible()
    await balanced()

    // a closed month shows its rules and changes none
    await goToMonth(page, 'September 2026')
    await expect(moneyOut.locator('[data-rule="rest"]')).toBeVisible()
    await expect(page.getByRole('button', { name: /^Rule for / })).toHaveCount(0)

    // the Grid says the same and offers the same dialog
    await page.getByRole('navigation', { name: 'Screens' }).getByRole('link', { name: 'Grid' }).click()
    await expect(page.getByText('= 10% of income')).toBeVisible()
    await expect(page.getByText('= 20% of what is left')).toBeVisible()
    await page.getByRole('button', { name: 'Row menu for To investments' }).click()
    await page.getByRole('menuitem', { name: 'Rule…' }).click()
    await expect(dlg.getByRole('heading', { name: 'To investments · November 2026' })).toBeVisible()
    await expect(dlg.getByLabel('Percentage of income')).toHaveValue('10')
    await dlg.getByRole('button', { name: 'Cancel' }).click()
  })

  test('a percentage of one income: all of the child benefit goes to the investments, and follows that line', async ({ page }) => {
    await openStatement(page)
    await goToMonth(page, 'November 2026')
    const moneyIn = page.getByRole('region', { name: 'Money in' })
    const moneyOut = page.getByRole('region', { name: 'Money out' })
    const assets = page.getByRole('region', { name: 'Assets' })
    const dlg = page.getByRole('dialog')
    const rest = async () => euros(await moneyOut.locator('[data-line]').filter({ has: page.locator('[data-rule="rest"]') }).innerText())
    expect(await rest()).toBe(2369)

    await moneyOut.getByRole('button', { name: /^To investments: €500\.00/ }).click()
    await dlg.getByRole('radio', { name: 'A percentage of one income' }).click()
    await expect(dlg).toContainText('A share of one income line: what it brings in, minus what is deducted from it.')
    // the list holds the income lines, and nothing that only takes money out of an account
    await expect(dlg.getByLabel('Which income').locator('option')).toHaveText(['Sam – Salary', 'Alex – Salary', 'Robin – Child benefit', 'Other income'])
    await dlg.getByLabel('Which income').selectOption({ label: 'Robin – Child benefit' })
    await expect(dlg.getByRole('button', { name: 'Save' })).toBeDisabled()
    await dlg.getByLabel('Percentage of that income').fill('100')
    await expect(dlg.getByTestId('rule-preview')).toContainText('100% of €255.00, Robin – Child benefit')
    await expect(dlg.getByTestId('rule-amount')).toHaveText('€255.00')
    // what the investments get less than their €500, the rest gets more
    await expect(dlg.getByTestId('rule-rest')).toHaveText('€2,614.00')
    await expect(dlg).toHaveCSS('opacity', '1')
    await page.screenshot({ path: 'e2e/output/statement-income-rule-dialog.png' })
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()

    // the line and the account it fills say the rule by the income's name
    await expect(moneyOut.getByRole('button', { name: 'To investments: €255.00' })).toBeVisible()
    await expect(moneyOut.getByRole('button', { name: 'Rule for To investments: 100% of Robin – Child benefit' })).toBeVisible()
    await expect(assets.getByRole('button', { name: 'Rule for Index fund: 100% of Robin – Child benefit' })).toBeVisible()
    expect(await rest()).toBe(2614)
    await page.screenshot({ path: 'e2e/output/statement-income-rule.png', fullPage: true })

    // the transfer follows its income: a raise of the benefit is a raise of the transfer, and the rest stays as it was
    await moneyIn.getByRole('button', { name: /^Robin – Child benefit: €255\.00/ }).click()
    await dlg.getByLabel('Amount in EUR').fill('300')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    await expect(moneyOut.getByRole('button', { name: 'To investments: €300.00' })).toBeVisible()
    expect(await rest()).toBe(2614)
    expect((await total(page, 'in').innerText()).replace(/^Total in\s*/, '')).toBe((await total(page, 'out').innerText()).replace(/^Total out\s*/, ''))

    // the dialog opens on the rule with its income, on a phone too
    await page.setViewportSize({ width: 390, height: 844 })
    await moneyOut.getByRole('button', { name: 'To investments: €300.00' }).click()
    await expect(dlg.getByRole('radio', { name: 'A percentage of one income' })).toBeChecked()
    await expect(dlg.getByLabel('Which income')).toHaveValue(/.+/)
    await expect(dlg.getByLabel('Which income').locator('option:checked')).toHaveText('Robin – Child benefit')
    await expect(dlg.getByLabel('Percentage of that income')).toHaveValue('100')
    await expect(dlg).toHaveCSS('opacity', '1')
    await page.screenshot({ path: 'e2e/output/statement-income-rule-dialog-phone.png' })
    await dlg.getByRole('button', { name: 'Cancel' }).click()
    await page.setViewportSize({ width: 1440, height: 900 })

    // the month before keeps its €500, and the Grid names the rule the same way
    await goToMonth(page, 'October 2026')
    await expect(moneyOut.getByRole('button', { name: /^To investments: €500\.00/ })).toBeVisible()
    await page.getByRole('navigation', { name: 'Screens' }).getByRole('link', { name: 'Grid' }).click()
    await expect(page.getByText('= 100% of Robin – Child benefit')).toBeVisible()
  })

  test('pocket money by rule: a percentage of the adult\'s own income from the pocket line, never the rest', async ({ page }) => {
    await openStatement(page)
    await goToMonth(page, 'November 2026')
    const moneyOut = page.getByRole('region', { name: 'Money out' })
    const dlg = page.getByRole('dialog')
    await moneyOut.getByRole('button', { name: 'Pocket money', exact: true }).click()
    await expect(moneyOut.getByRole('button', { name: 'To savings: €2,369.00' })).toBeVisible()

    // a pocket line carries the rule symbol, like a transfer to an account
    await moneyOut.getByRole('button', { name: 'Rule for Sam – Pocket: a fixed amount' }).click()
    await expect(dlg.getByRole('heading', { name: 'Sam – Pocket · November 2026' })).toBeVisible()
    await expect(dlg.getByRole('radiogroup', { name: 'How the amount is set' }).getByRole('radio')).toHaveText(['A fixed amount', 'A percentage of income', 'A percentage of Sam\'s income', 'A percentage of one income', 'A percentage of what is left'])
    await expect(dlg.getByRole('radio', { name: 'A fixed amount' })).toBeChecked()
    await expect(dlg.getByLabel('Amount in EUR')).toHaveValue('500')
    await expect(dlg).toHaveCSS('opacity', '1')
    await page.screenshot({ path: 'e2e/output/statement-row-dialog.png' })
    await dlg.getByRole('radio', { name: 'A percentage of Sam\'s income' }).click()
    await expect(dlg).toContainText('the income lines that belong to them')
    await dlg.getByLabel('Percentage of Sam\'s income').fill('10')
    await expect(dlg.getByTestId('rule-preview')).toContainText('10% of €4,200.00, Sam\'s take-home income')
    await expect(dlg.getByTestId('rule-amount')).toHaveText('€420.00')
    await expect(dlg.getByTestId('rule-rest')).toHaveText('€2,449.00')
    await expect(dlg).toHaveCSS('opacity', '1')
    await page.screenshot({ path: 'e2e/output/statement-pocket-rule-dialog.png' })
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()

    // the line shows the rule and its amount, and the rest follows
    await expect(moneyOut.getByRole('button', { name: 'Rule for Sam – Pocket: 10% of their own income' })).toBeVisible()
    await expect(moneyOut.getByRole('button', { name: 'Sam – Pocket: €420.00' })).toBeVisible()
    await expect(moneyOut.getByRole('button', { name: 'Alex – Pocket: €500.00' })).toBeVisible()
    await expect(moneyOut.getByRole('button', { name: 'To savings: €2,449.00' })).toBeVisible()
    await page.screenshot({ path: 'e2e/output/statement-pocket-rule.png' })
    // a line a rule works out opens the same dialog on its rule
    await moneyOut.getByRole('button', { name: 'Sam – Pocket: €420.00' }).click()
    await expect(dlg.getByRole('heading', { name: 'Sam – Pocket · November 2026' })).toBeVisible()
    await expect(dlg.getByRole('radio', { name: 'A percentage of Sam\'s income' })).toBeChecked()
    await expect(dlg.getByLabel('Percentage of Sam\'s income')).toHaveValue('10')
    await dlg.getByRole('button', { name: 'Cancel' }).click()
    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({ path: 'e2e/output/statement-pocket-rule-phone.png', fullPage: true })
    // the one dialog on a phone, with the amount's fields
    await moneyOut.getByRole('button', { name: 'Alex – Pocket: €500.00' }).click()
    await expect(dlg.getByRole('heading', { name: 'Alex – Pocket · November 2026' })).toBeVisible()
    await expect(dlg.getByLabel('Amount in EUR')).toHaveValue('500')
    await expect(dlg).toHaveCSS('opacity', '1')
    await page.screenshot({ path: 'e2e/output/statement-row-dialog-phone.png' })
    await dlg.getByRole('button', { name: 'Cancel' }).click()
    await expect(dlg).toBeHidden()
    await page.setViewportSize({ width: 1400, height: 900 })

    // the month before keeps what it showed
    await page.getByRole('button', { name: 'Previous month' }).click()
    await expect(page.getByRole('heading', { level: 2, name: 'October 2026' })).toBeVisible()
    await expect(moneyOut.getByRole('button', { name: 'Sam – Pocket: €500.00' })).toBeVisible()
  })

  test('accounts, virtual accounts, cards and loans are added in the lower half; a new savings account is asked how much goes to it', async ({ page }) => {
    await openStatement(page)
    await goToMonth(page, 'November 2026')
    const moneyOut = page.getByRole('region', { name: 'Money out' })
    const assets = page.getByRole('region', { name: 'Assets' })
    const claims = page.getByRole('region', { name: 'Debts and net worth' })
    const dlg = page.getByRole('dialog')

    // under Assets: what the household has. The short form asks the name, the type and what it holds
    await assets.getByRole('button', { name: 'Add account' }).click()
    await expect(dlg.getByRole('heading', { name: 'New account' })).toBeVisible()
    await expect(dlg.getByLabel('Type').locator('option')).toHaveText(['Current account', 'Joint account', 'Savings', 'Investments', 'Other asset', 'Cash'])
    await dlg.getByLabel('Name', { exact: true }).fill('Rainy day')
    await dlg.getByLabel('Type').selectOption('savings')
    await dlg.getByLabel('Holds at the start of September 2026 (EUR)').fill('1000')
    await expect(dlg.getByLabel('Currency')).toHaveCount(0)
    await dlg.getByRole('button', { name: /^More options/ }).click()
    await expect(dlg.getByLabel('Currency')).toHaveValue('EUR')
    await expect(dlg).toHaveCSS('opacity', '1')
    await page.screenshot({ path: 'e2e/output/statement-account-dialog.png' })
    await dlg.getByRole('button', { name: 'Save' }).click()

    // a savings account is asked straight away how much goes to it; the rest is already taken, so it starts on an amount
    await expect(dlg.getByRole('heading', { name: 'How much goes to Rainy day?' })).toBeVisible()
    await expect(dlg.getByRole('radio', { name: 'A fixed amount' })).toBeChecked()
    await dlg.getByLabel('Amount per month in EUR').fill('50')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    // 1,000 when September began, and 50 a month from November on
    await expect(assets.locator('[data-line^="acc:"]').filter({ hasText: 'Rainy day' })).toContainText('€1,050.00')
    await expect(moneyOut.getByRole('button', { name: 'To Rainy day: €50.00' })).toBeVisible()
    await expect(assets.getByRole('button', { name: 'Rule for Rainy day: a fixed amount' })).toBeVisible()

    // a virtual account inside it, set aside from the month on screen
    await assets.getByRole('button', { name: 'Add virtual account' }).click()
    await expect(dlg.getByRole('heading', { name: 'New virtual account' })).toBeVisible()
    await dlg.getByLabel('Name').fill('Gifts')
    await dlg.getByLabel('Held in').selectOption({ label: 'Rainy day' })
    await expect(dlg.getByLabel('Set aside each month (EUR)')).toHaveAttribute('placeholder', 'optional, from Nov 2026 on')
    await dlg.getByLabel('Set aside each month (EUR)').fill('20')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    await expect(assets.locator('[data-line^="pool:"]').filter({ hasText: 'Gifts' })).toContainText('€20.00')
    await expect(moneyOut.getByRole('button', { name: 'To Gifts: €20.00' })).toBeVisible()

    // under Debts: a card or a loan, and nothing else
    await claims.getByRole('button', { name: 'Add a card or loan' }).click()
    await expect(dlg.getByLabel('Type').locator('option')).toHaveText(['Credit card', 'Loan'])
    await expect(dlg.getByRole('radio', { name: 'Everything I buy with it' })).toBeChecked()
    await dlg.getByLabel('Name', { exact: true }).fill('Car loan')
    await dlg.getByLabel('Type').selectOption('loan')
    await expect(dlg.getByRole('radiogroup', { name: 'What do you record for this card?' })).toHaveCount(0)
    await dlg.getByLabel('Owed at the start of September 2026 (EUR)').fill('5000')
    // a loan comes with the row that pays it off, unless the box is unticked
    await expect(dlg.getByRole('checkbox', { name: 'Add the row that pays it off' })).toBeChecked()
    await expect(dlg.getByTestId('acc-row')).toHaveText('"Car loan – Payment". Each payment brings down what is owed.')
    await dlg.getByRole('button', { name: 'Save' }).click()
    // one Save made both, and the row asks for its amount
    await expect(dlg.getByRole('heading', { name: 'Car loan – Payment · November 2026' })).toBeVisible()
    await dlg.getByLabel('Amount in EUR').fill('250')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    await expect(moneyOut.getByRole('button', { name: /^Car loan – Payment: €250\.00/ })).toBeVisible()
    const carLoan = claims.locator('[data-line^="acc:"]').filter({ hasText: 'Car loan' })
    await expect(carLoan).toContainText('€4,750.00')
    // its form names the row that pays it off
    await claims.getByRole('button', { name: 'Edit Car loan' }).click()
    await expect(dlg.getByTestId('acc-paid-by')).toHaveText('Paid off by "Car loan – Payment".')
    await dlg.getByRole('button', { name: 'Cancel' }).click()

    // not mandatory: a card added without its row gets one later from its form
    await claims.getByRole('button', { name: 'Add a card or loan' }).click()
    await dlg.getByLabel('Name', { exact: true }).fill('Visa')
    await dlg.getByRole('checkbox', { name: 'Add the row that pays it off' }).uncheck()
    await expect(dlg.getByTestId('acc-row')).toHaveText('No row yet. One can be added later from this form.')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    await expect(moneyOut.getByRole('button', { name: /^Visa – Payment/ })).toHaveCount(0)
    await claims.getByRole('button', { name: 'Edit Visa' }).click()
    await expect(dlg.getByTestId('acc-paid-by')).toContainText('No row pays this off yet.')
    await dlg.getByRole('button', { name: 'Add the row that pays it off' }).click()
    // purchases on this card are expense rows, so its payment only moves money
    await expect(dlg.getByRole('heading', { name: 'Visa – Payment · November 2026' })).toBeVisible()
    await dlg.getByLabel('Amount in EUR').fill('100')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    await expect(moneyOut.locator('[data-line]').filter({ hasText: 'Visa – Payment' })).toContainText('counted when bought')
    const assetsTotal = (await total(page, 'assets').innerText()).replace(/^Total\s*/, '')
    expect(assetsTotal).toBe((await total(page, 'claims').innerText()).replace(/^Total\s*/, ''))
    await page.screenshot({ path: 'e2e/output/statement-accounts.png', fullPage: true })
  })

  test('suggested rows are offered where they will appear: one is added with its amount, one is dismissed and waits behind "More suggestions"', async ({ page }) => {
    await openStatement(page)
    await goToMonth(page, 'November 2026')
    const moneyIn = page.getByRole('region', { name: 'Money in' })
    const moneyOut = page.getByRole('region', { name: 'Money out' })
    const toggle = page.getByRole('button', { name: 'Suggestions', exact: true })
    const group = (name: string) => page.getByRole('group', { name: `Suggestions for ${name}` })

    // a household that is set up sees none until it asks for them
    await expect(toggle).toHaveAttribute('aria-pressed', 'false')
    await expect(page.getByTestId('suggestions')).toHaveCount(0)
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-pressed', 'true')

    // a category with something usual to offer opens by itself; each line says what the row is for
    const transport = group('Transport')
    await expect(transport.locator('[data-suggestion]')).toHaveText([/^The car – Fuel & parking/, /^Transport/])
    await expect(transport).toContainText('Fuel or charging, parking, tolls.')
    await expect(transport.getByRole('button', { name: 'More suggestions (2)' })).toBeVisible()
    // the demo already has its salaries, so Income only has the rarer ones to offer
    await expect(group('Income').locator('[data-suggestion]')).toHaveCount(0)
    await expect(moneyIn.getByRole('button', { name: 'More suggestions (2)' })).toBeVisible()
    // the accounts every household has are there already
    await expect(page.getByTestId('account-suggestions')).toHaveCount(0)
    await page.screenshot({ path: 'e2e/output/statement-suggestions.png', fullPage: true })

    // an amount that cannot be read stays on its line
    await transport.getByLabel('Amount per month for The car – Fuel & parking').fill('abc')
    await expect(transport.getByRole('alert')).toHaveText('That is not an amount I can read.')
    await expect(transport.getByRole('button', { name: 'Add The car – Fuel & parking' })).toBeDisabled()

    // the amount and Enter: the row is there, from this month on, and its suggestion is gone
    await transport.getByLabel('Amount per month for The car – Fuel & parking').fill('90')
    await transport.getByLabel('Amount per month for The car – Fuel & parking').press('Enter')
    await expect(moneyOut.getByRole('button', { name: /^The car – Fuel & parking: €90\.00/ })).toBeVisible()
    await expect(transport.locator('[data-suggestion]')).toHaveText([/^Transport/])
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.getByRole('button', { name: 'Next month' }).click()
    await expect(moneyOut.getByRole('button', { name: /^The car – Fuel & parking: €90\.00/ })).toBeVisible()
    await page.getByRole('button', { name: 'Previous month' }).click()

    // "×": not for us. It waits behind "More suggestions" with the rarer ones, and can still be added from there
    await transport.getByRole('button', { name: 'Dismiss Transport' }).click()
    await expect(transport.locator('[data-suggestion]')).toHaveCount(0)
    await transport.getByRole('button', { name: 'More suggestions (3)' }).click()
    await expect(transport.locator('[data-suggestion]')).toHaveText([/^The car – Tax & inspection/, /^The car – Maintenance/, /^Transport/])
    await expect(transport.getByRole('button', { name: /^Dismiss / })).toHaveCount(0)
    await transport.getByRole('button', { name: 'Add Transport', exact: true }).click()
    await expect(moneyOut.getByRole('button', { name: /^Transport: / })).toBeVisible()

    // one that needs an account the household does not have offers that account first
    const setAside = group('Set aside, pay off')
    await setAside.getByRole('button', { name: 'More suggestions (2)' }).click()
    const loan = setAside.locator('[data-suggestion$=":v.loan"]')
    await expect(loan.getByLabel(/^Amount per month/)).toHaveCount(0)
    await expect(loan.getByRole('button', { name: 'Add a loan for The car – Loan or lease' })).toHaveText('Add a loan…')

    // one undo takes the last added row back, and its suggestion returns
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect(moneyOut.getByRole('button', { name: /^Transport: / })).toHaveCount(0)

    // a closed month takes no new rows, so it offers none
    await goToMonth(page, 'September 2026')
    await expect(page.getByTestId('suggestions')).toHaveCount(0)
    await expect(toggle).toBeDisabled()
    await goToMonth(page, 'November 2026')
    await toggle.click()
    await expect(page.getByTestId('suggestions')).toHaveCount(0)

    // the loan is made from the suggestion that needs it: the suggestion is the row, so the loan's form offers none
    await toggle.click()
    await setAside.getByRole('button', { name: /^More suggestions/ }).click()
    await loan.getByRole('button', { name: 'Add a loan for The car – Loan or lease' }).click()
    const dlg = page.getByRole('dialog')
    await expect(dlg.getByLabel('Type').locator('option')).toHaveText(['Loan'])
    await expect(dlg.getByRole('checkbox', { name: 'Add the row that pays it off' })).toHaveCount(0)
    await dlg.getByLabel('Name', { exact: true }).fill('Car loan')
    await dlg.getByLabel('Owed at the start of September 2026 (EUR)').fill('3000')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    // now the suggestion takes its amount like the others, and the row it makes brings the loan down
    await loan.getByLabel('Amount per month for The car – Loan or lease').fill('300')
    await loan.getByLabel('Amount per month for The car – Loan or lease').press('Enter')
    await expect(moneyOut.getByRole('button', { name: /^The car – Loan or lease: €300\.00/ })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Debts and net worth' }).locator('[data-line^="acc:"]').filter({ hasText: 'Car loan' })).toContainText('€2,700.00')
  })

  test('rows, categories, accounts and virtual accounts are changed and removed from their line', async ({ page }) => {
    await openStatement(page)
    await goToMonth(page, 'November 2026')
    const moneyOut = page.getByRole('region', { name: 'Money out' })
    const assets = page.getByRole('region', { name: 'Assets' })
    const dlg = page.getByRole('dialog')
    const menu = page.getByRole('menu')

    // a row: the Grid's own menu, behind the "…" after its name
    await moneyOut.getByRole('button', { name: 'Living', exact: true }).click()
    await moneyOut.getByRole('button', { name: 'Row menu for Groceries' }).click()
    await expect(menu.getByRole('menuitem')).toContainText(['Rename…', 'Move up', 'Move down', 'Category…', 'Belongs to…'])
    await expect(menu).toHaveCSS('opacity', '1')
    await page.screenshot({ path: 'e2e/output/statement-row-menu.png' })
    await menu.getByRole('menuitem', { name: 'Rename…' }).click()
    await dlg.getByRole('textbox').fill('Food')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    await expect(moneyOut.getByRole('button', { name: /^Food: €700\.00/ })).toBeVisible()
    // the line itself still opens the editor, and the menu does not
    await moneyOut.getByRole('button', { name: /^Food: €700\.00/ }).click()
    await expect(dlg.getByLabel('Amount in EUR')).toHaveValue('700')
    await dlg.getByRole('button', { name: 'Cancel' }).click()
    // a household that is set up removes through the dialog: archive from a month, or delete
    await moneyOut.getByRole('button', { name: 'Row menu for Food' }).click()
    await menu.getByRole('menuitem', { name: 'Archive or delete…' }).click()
    await expect(dlg.getByRole('heading', { name: 'Row "Food"' })).toBeVisible()
    await expect(dlg.getByRole('button', { name: /^Archive from / })).toBeVisible()
    await dlg.getByRole('button', { name: 'Cancel' }).click()
    await expect(moneyOut.getByRole('button', { name: /^Food: €700\.00/ })).toBeVisible()

    // a category: rename, move, remove. Its rows are kept
    await moneyOut.getByRole('button', { name: 'Category menu for Housing' }).click()
    await expect(menu.getByRole('menuitem')).toHaveText(['Rename…', 'Move up', 'Move down', 'Remove…'])
    await expect(menu.getByRole('menuitem', { name: 'Move up' })).toBeDisabled()
    await menu.getByRole('menuitem', { name: 'Rename…' }).click()
    await dlg.getByLabel('Category name').fill('Living')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg.getByRole('alert')).toBeVisible()
    await dlg.getByLabel('Category name').fill('Home')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    await expect(moneyOut.getByRole('button', { name: 'Home', exact: true })).toBeVisible()
    await moneyOut.getByRole('button', { name: 'Category menu for Home' }).click()
    await menu.getByRole('menuitem', { name: 'Remove…' }).click()
    await expect(dlg.getByRole('heading', { name: 'Category "Home"' })).toBeVisible()
    await dlg.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(dlg).toBeHidden()
    await expect(moneyOut.getByRole('button', { name: 'Home', exact: true })).toHaveCount(0)
    await moneyOut.getByRole('button', { name: 'No category', exact: true }).click()
    await expect(moneyOut.getByRole('button', { name: /^The flat – Rent: €1,650\.00/ })).toBeVisible()
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect(moneyOut.getByRole('button', { name: 'Home', exact: true })).toBeVisible()

    // an account and a virtual account open their dialog, which removes at its foot
    await assets.getByRole('button', { name: 'Edit Index fund' }).click()
    await expect(dlg.getByRole('heading', { name: 'Edit account' })).toBeVisible()
    await expect(dlg.getByLabel('Name', { exact: true })).toHaveValue('Index fund')
    await dlg.getByRole('button', { name: 'Archive or delete…' }).click()
    await expect(dlg.getByRole('heading', { name: 'Account "Index fund"' })).toBeVisible()
    await dlg.getByRole('button', { name: 'Cancel' }).click()
    await assets.getByRole('button', { name: 'Edit Travel' }).click()
    await expect(dlg.getByRole('heading', { name: 'Edit virtual account' })).toBeVisible()
    await dlg.getByRole('button', { name: 'Cancel' }).click()
    // the calculated line stands for the current accounts, so it lists them
    await assets.getByRole('button', { name: 'Edit a current account' }).click()
    await expect(menu.getByRole('menuitem')).toHaveText(['Edit Main account…', 'Edit Joint account…'])
    await menu.getByRole('menuitem', { name: 'Edit Joint account…' }).click()
    await expect(dlg.getByLabel('Name', { exact: true })).toHaveValue('Joint account')
    await dlg.getByRole('button', { name: 'Cancel' }).click()

    // a closed month changes nothing, so it offers no menus
    await goToMonth(page, 'September 2026')
    // (Living is still open from before; in a closed month its rows are plain lines)
    await expect(moneyOut.getByText('Food', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: /^Row menu for / })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /^Category menu for / })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /^Edit / })).toHaveCount(0)
  })

  test('one section for money from the accounts: what an expense took is marked calculated, what is taken by hand is a row with no tag', async ({ page }) => {
    await openStatement(page)
    await goToMonth(page, 'November 2026')
    const moneyIn = page.getByRole('region', { name: 'Money in' })
    const moneyOut = page.getByRole('region', { name: 'Money out' })
    const dlg = page.getByRole('dialog')
    const rest = async () => euros(await moneyOut.locator('[data-line]').filter({ has: page.locator('[data-rule="rest"]') }).innerText())

    // worked out from the expenses: each such line is tagged and names what it paid for
    const taken = moneyIn.locator('[data-line="from-accounts"]')
    await expect(taken).toContainText('From accounts')
    await expect(taken).not.toContainText('calculated')
    const clothing = moneyIn.locator('[data-line^="src:"]').filter({ hasText: 'Clothing' })
    await expect(clothing).toContainText('calculated')
    await expect(clothing).toContainText('for Clothing')
    // every line of the section leads with the account the money came out of and says what kind of account that is
    await expect(clothing).toContainText('From Clothing')
    await expect(clothing).toContainText('virtual account')
    const before = euros(await taken.innerText())

    // typed by hand: a row in the same section, added at its foot
    await moneyIn.getByRole('button', { name: 'Add transfer row' }).click()
    await expect(moneyIn.getByLabel('What the new transfer row does').locator('option')).toHaveText(['Taken from a savings account', 'Taken from an investment account'])
    await moneyIn.getByLabel('New transfer row name').fill('Car repair')
    await moneyIn.getByRole('button', { name: 'Add', exact: true }).click()
    await expect(dlg.getByRole('heading', { name: 'Car repair · November 2026' })).toBeVisible()
    // the editor opens for the first amount, and for these rows it starts on this month only
    await expect(dlg.getByRole('radio', { name: 'Only this month' })).toBeChecked()
    await dlg.getByLabel('Amount in EUR').fill('400')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    // the row is shown under the account it takes from, with its own name after it
    const own = moneyIn.locator('[data-line]').filter({ has: page.getByRole('button', { name: 'From Savings, Car repair: €400.00' }) })
    await expect(own).toContainText('From Savings')
    await expect(own).toContainText('savings account')
    await expect(own).toContainText('Car repair')
    await expect(page.getByRole('checkbox', { name: 'From Savings, Car repair done' })).toBeVisible()
    // a row of your own has no tag, and the section's amount counts both kinds
    await expect(own).not.toContainText('calculated')
    expect(euros(await taken.innerText())).toBe(before + 400)
    // the month has 400 more, so the rest grows by it, and the two sides still agree
    expect(await rest()).toBe(2769)
    expect((await total(page, 'in').innerText()).replace(/^Total in\s*/, '')).toBe((await total(page, 'out').innerText()).replace(/^Total out\s*/, ''))
    await page.screenshot({ path: 'e2e/output/statement-taken.png', fullPage: true })
    // nothing is taken the month after
    await goToMonth(page, 'December 2026')
    await expect(moneyIn.getByRole('button', { name: /^From Savings, Car repair:/ })).toHaveAccessibleName('From Savings, Car repair: €0.00')
    expect(await rest()).toBe(2369)
    // the right side does not offer what has its own place on the left
    await moneyOut.getByRole('button', { name: 'Add transfer row' }).click()
    await expect(moneyOut.getByLabel('What is it for?').locator('option[value="to-investment"]')).toHaveCount(1)
    await expect(moneyOut.getByLabel('What is it for?').locator('option[value="from-savings"]')).toHaveCount(0)
  })

  test('a row under "Set aside, pay off" says what it is for, and the place it goes to can be made with it', async ({ page }) => {
    await openStatement(page)
    await goToMonth(page, 'November 2026')
    const moneyIn = page.getByRole('region', { name: 'Money in' })
    const moneyOut = page.getByRole('region', { name: 'Money out' })
    const assets = page.getByRole('region', { name: 'Assets' })
    const claims = page.getByRole('region', { name: 'Debts and net worth' })
    const dlg = page.getByRole('dialog')
    const what = moneyOut.getByLabel('What is it for?')
    const which = moneyOut.getByLabel('Which one')
    const text = moneyOut.getByTestId('add-row-text')

    // the question comes first, the places money is put before the plain move between accounts
    await moneyOut.getByRole('button', { name: 'Add transfer row' }).click()
    await expect(what.locator('option')).toHaveText([
      'Goes into a savings account', 'Deposits into an investment account', 'Fills a virtual account', 'Pays off a loan or card', 'Pocket money for an adult', 'Moves money between your accounts',
    ])
    await expect(what).toHaveValue('to-savings')
    // what the household has, then the way to make another
    await expect(which.locator('option')).toHaveText(['Savings', 'New savings account…'])
    await expect(moneyOut.getByLabel('New transfer row name')).toHaveAttribute('placeholder', 'To Savings')

    // a loan the household does not have yet: the row and the loan are made together
    await what.selectOption('pay-off')
    await expect(which.locator('option')).toHaveText(['Credit card · Credit card', 'New loan…', 'New credit card…'])
    await which.selectOption({ label: 'New loan…' })
    await expect(text).toHaveText('Add opens the form of the new loan. Saving it makes the loan and this row together.')
    await expect(moneyOut.getByLabel('New transfer row name')).toHaveAttribute('placeholder', 'Named after the loan')
    await page.screenshot({ path: 'e2e/output/statement-row-first.png', fullPage: true })
    await moneyOut.getByRole('button', { name: 'Add', exact: true }).click()
    await expect(dlg.getByRole('heading', { name: 'New account' })).toBeVisible()
    await expect(dlg.getByLabel('Type').locator('option')).toHaveText(['Loan'])
    await expect(dlg.getByRole('checkbox', { name: 'Add the row that pays it off' })).toHaveCount(0)
    await expect(dlg.getByTestId('acc-row')).toHaveText('Saving also adds the row named after the account, linked to this account.')
    await dlg.getByLabel('Name', { exact: true }).fill('Car loan')
    await expect(dlg.getByTestId('acc-row')).toHaveText('Saving also adds the row "Car loan – Payment", linked to this account.')
    await dlg.getByLabel('Owed at the start of September 2026 (EUR)').fill('5000')
    await page.screenshot({ path: 'e2e/output/statement-row-first-account.png' })
    await dlg.getByRole('button', { name: 'Save' }).click()
    // the row asks for its amount next; the loan is under Debts and comes down with the payment
    await expect(dlg.getByRole('heading', { name: 'Car loan – Payment · November 2026' })).toBeVisible()
    await dlg.getByLabel('Amount in EUR').fill('250')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    await expect(moneyOut.getByRole('button', { name: /^Car loan – Payment: €250\.00/ })).toBeVisible()
    await expect(claims.locator('[data-line^="acc:"]').filter({ hasText: 'Car loan' })).toContainText('€4,750.00')
    // the form is closed again, and one undo of the amount, one of the pair
    await expect(what).toHaveCount(0)

    // the card the household has is paid off from here too: its row lives under Transfers, named after the card
    await moneyOut.getByRole('button', { name: 'Add transfer row' }).click()
    await what.selectOption('pay-off')
    await which.selectOption({ label: 'Credit card · Credit card' })
    await expect(moneyOut.getByLabel('New transfer row name')).toHaveAttribute('placeholder', 'Credit card – Payment')
    await moneyOut.getByRole('button', { name: 'Add', exact: true }).click()
    await expect(dlg.getByRole('heading', { name: 'Credit card – Payment · November 2026' })).toBeVisible()
    await dlg.getByRole('button', { name: 'Cancel' }).click()
    await expect(moneyOut.locator('[data-line]').filter({ hasText: 'Credit card – Payment' })).toBeVisible()

    // a new investment account with its own name for the row; the row's dialog opens with how the amount is set
    await moneyOut.getByRole('button', { name: 'Add transfer row' }).click()
    await what.selectOption('to-investment')
    await which.selectOption({ label: 'New investment account…' })
    await moneyOut.getByLabel('New transfer row name').fill('Pension top-up')
    await moneyOut.getByLabel('New transfer row name').press('Enter')
    await expect(dlg.getByTestId('acc-row')).toHaveText('Saving also adds the row "Pension top-up", linked to this account.')
    await dlg.getByLabel('Name', { exact: true }).fill('Pension')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg.getByRole('heading', { name: 'Pension top-up · November 2026' })).toBeVisible()
    await expect(dlg.getByRole('radiogroup', { name: 'How the amount is set' })).toBeVisible()
    await dlg.getByRole('button', { name: 'Cancel' }).click()
    await expect(assets.locator('[data-line^="acc:"]').filter({ hasText: 'Pension' })).toBeVisible()

    // a virtual account is made from here with its own form, which names its row
    await moneyOut.getByRole('button', { name: 'Add transfer row' }).click()
    await what.selectOption('pool-allocation')
    await expect(which.locator('option')).toHaveText(['New virtual account…'])
    await expect(moneyOut.getByLabel('New transfer row name')).toHaveCount(0)
    await moneyOut.getByRole('button', { name: 'Add', exact: true }).click()
    await expect(dlg.getByRole('heading', { name: 'New virtual account' })).toBeVisible()
    await dlg.getByLabel('Name').fill('Gifts')
    await dlg.getByLabel('Set aside each month (EUR)').fill('20')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    await expect(moneyOut.getByRole('button', { name: 'To Gifts: €20.00' })).toBeVisible()
    await expect(what).toHaveCount(0)

    // payment rows are added here only: the Statement's expenses offer a normal expense and nothing to pick
    await moneyOut.getByRole('button', { name: 'Add expense row' }).click()
    await expect(moneyOut.getByLabel('What the new expense row does')).toHaveCount(0)
    await moneyOut.getByLabel('New expense row name').press('Escape')

    // money taken out of an account can make that account too
    await moneyIn.getByRole('button', { name: 'Add transfer row' }).click()
    await expect(moneyIn.getByLabel('Account for the new transfer row').locator('option')).toHaveText(['Savings', 'New savings account…'])
  })

  test('a top-up on a virtual account whose amount a rule works out says that the month then keeps a typed amount', async ({ page }) => {
    await openStatement(page)
    await goToMonth(page, 'November 2026')
    const moneyOut = page.getByRole('region', { name: 'Money out' })
    const assets = page.getByRole('region', { name: 'Assets' })
    const dlg = page.getByRole('dialog')
    // Clothing gets 1% of income from November on
    await assets.getByRole('button', { name: 'Rule for Clothing: a fixed amount' }).click()
    await dlg.getByRole('radio', { name: 'A percentage of income' }).click()
    await dlg.getByLabel('Percentage of income').fill('1')
    await expect(dlg.getByTestId('rule-amount')).toHaveText('€74.05')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    // a coat that takes more than the virtual account then holds: the top-up is offered, and says what it does to the rule
    await page.getByRole('button', { name: 'Expand all' }).click()
    await moneyOut.getByRole('button', { name: /^Clothing: €180\.00/ }).click()
    await dlg.getByLabel('Item amount').fill('3000')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg.getByRole('heading', { name: 'Clothing is short in November 2026' })).toBeVisible()
    await expect(dlg.getByTestId('top-up-rule')).toHaveText('What Clothing gets is worked out by its rule (1% of income). A top-up fixes it for November 2026 at what it is now, €74.05, plus the top-up; the rule goes on the month after.')
    await expect(dlg).toHaveCSS('opacity', '1')
    await page.screenshot({ path: 'e2e/output/statement-top-up-rule.png' })
    await dlg.getByRole('button', { name: 'Top up' }).click()
    await expect(dlg).toBeHidden()
    // November holds what the rule gave plus the top-up; December follows the rule again
    await expect(moneyOut.getByRole('button', { name: 'To Clothing: €2,650.00' })).toBeVisible()
    await goToMonth(page, 'December 2026')
    await expect(moneyOut.getByRole('button', { name: 'Rule for To Clothing: 1% of income' })).toBeVisible()
    await expect(moneyOut.getByRole('button', { name: /^To Clothing: €2,650\.00/ })).toHaveCount(0)
  })

  test('a virtual account that runs short stops at zero and offers a top-up that leaves a record', async ({ page }) => {
    await openStatement(page)
    await goToMonth(page, 'November 2026')
    const moneyIn = page.getByRole('region', { name: 'Money in' })
    const moneyOut = page.getByRole('region', { name: 'Money out' })
    const assets = page.getByRole('region', { name: 'Assets' })
    const dlg = page.getByRole('dialog')
    const rest = async () => euros(await moneyOut.locator('[data-line]').filter({ has: page.locator('[data-rule="rest"]') }).innerText())
    const balanced = async () => expect((await total(page, 'in').innerText()).replace(/^Total in\s*/, '')).toBe((await total(page, 'out').innerText()).replace(/^Total out\s*/, ''))
    const poolLine = assets.locator('[data-line^="pool:"]').filter({ hasText: 'Clothing' })
    await expect(poolLine).toContainText('€270.00')

    // €3,000 of clothing out of a virtual account that holds €450 this month
    await page.getByRole('button', { name: 'Expand all' }).click()
    await moneyOut.getByRole('button', { name: /^Clothing: €180\.00/ }).click()
    // the row holds one item this month, the winter coat
    await dlg.getByLabel('Item amount').fill('3000')
    await dlg.getByRole('button', { name: 'Save' }).click()

    // the top-up is offered straight away; "Not now" keeps the expense and leaves the virtual account short
    await expect(dlg.getByRole('heading', { name: 'Clothing is short in November 2026' })).toBeVisible()
    await expect(dlg).toContainText('€3,000.00 comes out of Clothing this month and it holds €450.00: €2,550.00 is missing.')
    await dlg.getByRole('button', { name: 'Not now' }).click()
    await expect(dlg).toBeHidden()
    await expect(poolLine).toContainText('short €2,550.00')
    await expect(poolLine).toContainText('€0.00')
    await expect(moneyIn.locator('[data-line^="src:"]').filter({ hasText: 'Clothing' }).first()).toContainText('€2,550.00 more than it held, taken from Savings')
    expect(await rest()).toBe(2369)
    await balanced()
    await page.screenshot({ path: 'e2e/output/statement-short.png', fullPage: true })

    // from the tag: top it up from the savings it sits in
    await assets.getByRole('button', { name: 'Top up Clothing' }).click()
    await expect(dlg.getByRole('radio', { name: /^Savings, not set aside · €/ })).toBeChecked()
    await expect(dlg.getByLabel('Amount in EUR')).toHaveValue('2550')
    const preview = dlg.getByTestId('top-up-preview')
    await expect(preview).toContainText('Money in · From Savings€2,550.00')
    await expect(preview).toContainText('Money out · To Clothing, this month€2,650.00')
    await expect(dlg.getByTestId('top-up-balance')).toHaveText('€0.00')
    // a set-aside with a fixed amount has nothing to warn about
    await expect(dlg.getByTestId('top-up-rule')).toHaveCount(0)
    await expect(dlg).toHaveCSS('opacity', '1')
    await page.screenshot({ path: 'e2e/output/statement-top-up-dialog.png' })
    // Enter twice in a row tops up once: the second press finds a save already on its way
    await dlg.getByLabel('Amount in EUR').focus()
    await page.evaluate(() => {
      const field = document.activeElement as HTMLElement
      for (let i = 0; i < 2; i++) field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    await expect(dlg).toBeHidden()

    // both lines are there, the tag is gone, and the rest of the month did not move
    const fromSavings = moneyIn.getByRole('button', { name: 'From Savings: €2,550.00' })
    await expect(fromSavings).toBeVisible()
    await expect(moneyIn.locator('[data-line]').filter({ has: page.getByRole('button', { name: 'From Savings: €2,550.00' }) })).toContainText('Top-up for Clothing')
    await expect(moneyIn.locator('[data-line]').filter({ has: page.getByRole('button', { name: 'From Savings: €2,550.00' }) })).toContainText('savings account')
    await expect(moneyOut.getByRole('button', { name: /^To Clothing: €2,650\.00/ })).toBeVisible()
    await expect(poolLine).not.toContainText('short')
    await expect(assets.getByRole('button', { name: 'Top up Clothing' })).toHaveCount(0)
    expect(await rest()).toBe(2369)
    await balanced()
    await page.screenshot({ path: 'e2e/output/statement-topped-up.png', fullPage: true })
    // December is back to the usual €100, with nothing taken from savings
    await goToMonth(page, 'December 2026')
    await expect(moneyOut.getByRole('button', { name: /^To Clothing: €100\.00/ })).toBeVisible()
    await expect(moneyIn.getByRole('button', { name: /^From Savings:/ })).toHaveAccessibleName('From Savings: €0.00')
  })

  test('the rest moves to a new savings account from its line in the lower half', async ({ page }) => {
    await page.goto('?demo=1')
    await page.getByRole('button', { name: 'Load the demo household' }).click()
    await page.getByRole('link', { name: 'Household' }).click()
    await page.getByRole('button', { name: 'Add account' }).click()
    const dlg = page.getByRole('dialog')
    await dlg.getByLabel('Name', { exact: true }).fill('Rainy day')
    await dlg.getByLabel('Type').selectOption('savings')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    await page.getByRole('navigation', { name: 'Screens' }).getByRole('link', { name: 'Statement' }).click()
    await goToMonth(page, 'November 2026')
    const moneyOut = page.getByRole('region', { name: 'Money out' })
    const assets = page.getByRole('region', { name: 'Assets' })

    // an account no row feeds yet says so, and its symbol sets the rule up
    await assets.getByRole('button', { name: 'Set a rule for Rainy day' }).click()
    await expect(dlg.getByRole('heading', { name: 'How much goes to Rainy day?' })).toBeVisible()
    await expect(dlg).toContainText('Saving adds the row "To Rainy day" under Transfers.')
    await dlg.getByRole('radio', { name: 'The rest' }).click()
    await expect(dlg).toContainText('"To savings" takes the rest now. From November 2026 on it comes here instead')
    await expect(dlg.getByTestId('rule-amount')).toHaveText('€2,369.00')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()

    // the rest is on the new account and its new row; the account that had it gets nothing more
    await expect(assets.getByRole('button', { name: 'Rule for Rainy day: the rest' })).toBeVisible()
    await expect(moneyOut.getByRole('button', { name: 'To Rainy day: €2,369.00' })).toBeVisible()
    await expect(assets.getByRole('button', { name: 'Rule for Savings: a fixed amount' })).toBeVisible()
    await expect(moneyOut.getByRole('button', { name: 'To savings: €0.00' })).toBeVisible()
    expect((await total(page, 'in').innerText()).replace(/^Total in\s*/, '')).toBe((await total(page, 'out').innerText()).replace(/^Total out\s*/, ''))
    // October went to Savings and still does
    await goToMonth(page, 'October 2026')
    await expect(moneyOut.getByRole('button', { name: /^To savings: €2,009\.00/ })).toBeVisible()
    await expect(moneyOut.getByRole('button', { name: /^To Rainy day: / })).toHaveAccessibleName('To Rainy day: €0.00')
    // one undo takes the whole change back, the new row with it
    await page.getByRole('button', { name: 'Undo' }).click()
    await goToMonth(page, 'November 2026')
    await expect(moneyOut.getByRole('button', { name: 'Rule for To savings: the rest' })).toBeVisible()
    await expect(assets.getByRole('button', { name: 'Set a rule for Rainy day' })).toBeVisible()

    // an investment account can take the rest too: its own €500 goes back into what is left first
    await assets.getByRole('button', { name: 'Rule for Index fund: a fixed amount' }).click()
    await dlg.getByRole('radio', { name: 'The rest' }).click()
    await expect(dlg).toContainText('A month that overruns takes the difference back out of Index fund: it shows as money taken out of the investments.')
    await expect(dlg.getByTestId('rule-amount')).toHaveText('€2,869.00')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    await expect(moneyOut.getByRole('button', { name: 'To investments: €2,869.00' })).toBeVisible()
    await expect(assets.getByRole('button', { name: 'Rule for Index fund: the rest' })).toBeVisible()
    await expect(moneyOut.getByRole('button', { name: 'To savings: €0.00' })).toBeVisible()
    expect((await total(page, 'in').innerText()).replace(/^Total in\s*/, '')).toBe((await total(page, 'out').innerText()).replace(/^Total out\s*/, ''))
  })
})

test.describe('the Statement on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

  test('the two sides stack, each with its own total', async ({ page }) => {
    await openStatement(page)
    await goToMonth(page, 'September 2026')
    const inBox = await total(page, 'in').boundingBox()
    const outBox = await total(page, 'out').boundingBox()
    expect(inBox && outBox && outBox.y > inBox.y + inBox.height).toBeTruthy()
    await expect(total(page, 'in')).toContainText('€7,255.00')
    await expect(total(page, 'out')).toContainText('€7,255.00')
    await page.screenshot({ path: 'e2e/output/statement-phone.png', fullPage: true })

    // an open month: a row keeps its 44 px tick and opens the editor on a tap
    await goToMonth(page, 'November 2026')
    await page.getByRole('region', { name: 'Money out' }).getByRole('button', { name: 'Housing', exact: true }).tap()
    const tick = page.getByRole('checkbox', { name: 'The flat – Utilities done' })
    const box = await tick.boundingBox()
    expect(box && box.width >= 44 && box.height >= 44).toBeTruthy()
    await tick.tap()
    await expect(tick).toBeChecked()
    await page.getByRole('button', { name: /^The flat – Utilities:/ }).tap()
    await expect(page.getByRole('dialog').getByLabel('Amount in EUR')).toHaveValue('210')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toBeHidden()
    await page.screenshot({ path: 'e2e/output/statement-phone-working.png', fullPage: true })

    // the current accounts' real balances on a phone: a field per account
    await page.getByRole('region', { name: 'Assets' }).getByRole('button', { name: /^Current accounts balance:/ }).tap()
    const dlg = page.getByRole('dialog')
    await expect(dlg.getByRole('heading', { name: 'Current accounts · November 2026' })).toBeVisible()
    await dlg.getByLabel('Main account (EUR)').fill('1150')
    await dlg.getByLabel('Joint account (EUR)').fill('300')
    await expect(dlg.getByTestId('current-balance-sum')).toContainText('Together€1,450.00')
    await expect(dlg).toHaveCSS('opacity', '1')
    await page.screenshot({ path: 'e2e/output/statement-current-balance-phone.png' })
    await dlg.getByRole('button', { name: 'Cancel' }).tap()
    await expect(dlg).toBeHidden()
  })

  test('the row form under "Set aside, pay off" fits the screen, and makes a loan with its row', async ({ page }) => {
    await openStatement(page)
    await goToMonth(page, 'November 2026')
    const moneyOut = page.getByRole('region', { name: 'Money out' })
    const dlg = page.getByRole('dialog')
    await moneyOut.getByRole('button', { name: 'Add transfer row' }).tap()
    await moneyOut.getByLabel('What is it for?').selectOption('pay-off')
    await moneyOut.getByLabel('Which one').selectOption({ label: 'New loan…' })
    // nothing of the form reaches past the edge of the screen
    for (const part of [moneyOut.getByLabel('What is it for?'), moneyOut.getByLabel('Which one'), moneyOut.getByLabel('New transfer row name'), moneyOut.getByRole('button', { name: 'Cancel' }), moneyOut.getByTestId('add-row-text')]) {
      const box = await part.boundingBox()
      expect(box && box.x >= 0 && box.x + box.width <= 390).toBeTruthy()
    }
    await moneyOut.getByLabel('What is it for?').scrollIntoViewIfNeeded()
    await page.screenshot({ path: 'e2e/output/statement-row-first-phone.png' })
    await moneyOut.getByRole('button', { name: 'Add', exact: true }).tap()
    await dlg.getByLabel('Name', { exact: true }).fill('Car loan')
    await expect(dlg.getByTestId('acc-row')).toHaveText('Saving also adds the row "Car loan – Payment", linked to this account.')
    await expect(dlg).toHaveCSS('opacity', '1')
    await page.screenshot({ path: 'e2e/output/statement-row-first-account-phone.png' })
    await dlg.getByRole('button', { name: 'Save' }).tap()
    await expect(dlg.getByRole('heading', { name: 'Car loan – Payment · November 2026' })).toBeVisible()
    await dlg.getByRole('button', { name: 'Cancel' }).tap()
    await expect(moneyOut.locator('[data-line]').filter({ hasText: 'Car loan – Payment' })).toBeVisible()
  })
})
