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
    // pool accounts sit under the savings account that holds them
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
    // a closed month is locked: nothing to tick, no line opens the editor
    await expect(page.getByRole('checkbox')).toHaveCount(0)
    await expect(moneyOut.getByRole('button', { name: /^Alex – Personal:/ })).toHaveCount(0)
    await page.screenshot({ path: 'e2e/output/statement-closed.png', fullPage: true })

    // "Open all" and "Close all"
    await page.getByRole('button', { name: 'Open all' }).click()
    await expect(moneyOut.getByText('The flat – Rent')).toBeVisible()
    await page.getByRole('button', { name: 'Close all' }).click()
    await expect(moneyOut.getByText('The flat – Rent')).toHaveCount(0)
    await expect(assetsSide.getByText('Not set aside')).toHaveCount(0)
  })

  test('spending from a pool account shows on both sides', async ({ page }) => {
    await openStatement(page)
    await goToMonth(page, 'October 2026')
    const moneyIn = page.getByRole('region', { name: 'Money in' })
    await expect(moneyIn.locator('[data-line="sources"]')).toContainText('From savings and pool accounts')
    await expect(moneyIn.locator('[data-line="sources"]')).toContainText('€480.00')
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
    await expect(utilities.locator('[data-estimate]')).toHaveText('€210.00')
    // a certain amount is plain
    await expect(moneyOut.getByRole('button', { name: /^The flat – Rent:/ })).toHaveAccessibleName('The flat – Rent: €1,650.00')
    const rest = moneyOut.locator('[data-line]').filter({ hasText: 'the rest' })
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
    await expect(utilities.locator('[data-estimate]')).toHaveCount(0)
    await expect(housing.locator('[data-estimate]')).toHaveCount(0)
    await expect(housing).toContainText('€1,849.00')
    // the 11 saved goes to the rest, and the two sides still agree
    expect(euros(await rest.innerText())).toBe(restBefore + 11)
    expect((await total(page, 'in').innerText()).replace(/^Total in\s*/, '')).toBe((await total(page, 'out').innerText()).replace(/^Total out\s*/, ''))

    // one click on a tick marks a row done; the Month screen sees the same
    await moneyOut.getByRole('button', { name: 'Family & pets', exact: true }).click()
    const childcare = page.getByRole('checkbox', { name: 'Robin – Childcare done' })
    await expect(childcare).not.toBeChecked()
    await childcare.click()
    await expect(childcare).toBeChecked()

    // an automatic row can be ticked as moved but not typed over
    await moneyOut.getByRole('button', { name: 'Pocket money', exact: true }).click()
    await expect(moneyOut.getByRole('button', { name: /^Sam – Pocket:/ })).toHaveCount(0)
    await expect(page.getByRole('checkbox', { name: 'Sam – Pocket done' })).toBeVisible()

    // an itemized row opens to its items, each with a tick of its own
    await moneyOut.getByRole('button', { name: 'Living', exact: true }).click()
    await moneyOut.getByRole('button', { name: /^Health:/ }).click()
    await dlg.getByRole('tab', { name: 'Itemized' }).click()
    await dlg.getByRole('button', { name: 'Add item' }).click()
    await dlg.getByLabel('Item label').last().fill('Physio')
    await dlg.getByLabel('Item amount').last().fill('45')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    await expect(moneyOut.getByRole('button', { name: /^Health:/ })).toHaveAccessibleName(/^Health: €75\.00/)
    await moneyOut.getByRole('button', { name: 'Items of Health' }).click()
    const physio = page.getByRole('checkbox', { name: 'Health: Physio done' })
    await physio.click()
    await expect(physio).toBeChecked()
    await expect(page.getByRole('checkbox', { name: 'Health done' })).toHaveAttribute('aria-checked', 'mixed')
    await page.screenshot({ path: 'e2e/output/statement-working.png', fullPage: true })

    await page.getByRole('navigation', { name: 'Screens' }).getByRole('link', { name: 'Month' }).click()
    await expect(page.getByRole('heading', { level: 2, name: 'November 2026' })).toBeVisible()
    await expect(page.getByRole('checkbox', { name: 'Robin – Childcare done' })).toBeChecked()
    await expect(page.getByRole('checkbox', { name: 'Health done' })).toHaveAttribute('aria-checked', 'mixed')
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

  test('a goal is set from the line it watches, which then carries its mark and opens to the bar', async ({ page }) => {
    await openStatement(page)
    await goToMonth(page, 'September 2026')
    const assets = page.getByRole('region', { name: 'Assets' })
    const dlg = page.getByRole('dialog')

    // a debt offers a goal to clear it
    await page.getByRole('region', { name: 'Debts and net worth' }).getByRole('button', { name: 'Set a goal for Credit card' }).click()
    await expect(dlg.getByRole('heading', { name: 'New goal' })).toBeVisible()
    await expect(dlg.getByLabel('Kind')).toHaveValue('pay-off')
    await dlg.getByRole('button', { name: 'Cancel' }).click()

    // a pool account: the dialog opens with the line already chosen
    await assets.getByRole('button', { name: 'Set a goal for Travel' }).click()
    await expect(dlg.getByLabel('Kind')).toHaveValue('pool-balance')
    await expect(dlg.getByLabel('Tracks').locator('option:checked')).toHaveText('Travel')
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
    await dlg.getByRole('button', { name: 'Cancel' }).click()
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
  })
})
