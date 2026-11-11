import { expect, test } from '@playwright/test'

/** Working the month on the Statement from the phone: ticks, the progress line, the real amount, items, automatic rows, a closed month. */
test.describe('tracking the month on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

  test('ticks and the progress line, what it really was, items, automatic rows and a closed month', async ({ page }) => {
    await page.goto('?demo=1')
    await page.getByRole('button', { name: 'Load the demo household' }).click()
    // the Statement is the first screen on a phone too, on the current month
    await expect(page.getByRole('heading', { level: 1, name: 'Statement' })).toBeVisible()
    await expect(page.getByRole('heading', { level: 2, name: 'November 2026' })).toBeVisible()
    const progress = page.getByTestId('progress')
    await expect(progress).toHaveText('0 of 21 done · €8,065.00 still to pay · €7,405.00 to come in')
    await expect(page.getByRole('button', { name: 'Close month' })).toBeVisible()
    await page.screenshot({ path: 'e2e/output/statement-track-phone.png', fullPage: true })
    const moneyOut = page.getByRole('region', { name: 'Money out' })

    // one tap: Rent is paid
    await moneyOut.getByRole('button', { name: 'Housing', exact: true }).tap()
    const rent = page.getByRole('checkbox', { name: 'The flat – Rent done' })
    await expect(rent).not.toBeChecked()
    await rent.tap()
    await expect(rent).toBeChecked()
    await expect(progress).toHaveText('1 of 21 done · €6,415.00 still to pay · €7,405.00 to come in')

    // what it really was: Utilities cost 199 this month and are paid; December keeps its 210
    await moneyOut.getByRole('button', { name: /^The flat – Utilities:/ }).tap()
    const editor = page.getByRole('dialog')
    await expect(editor.getByRole('heading', { name: /The flat – Utilities/ })).toBeVisible()
    await expect(editor.getByLabel('Amount in EUR')).toHaveValue('210')
    await editor.getByLabel('Amount in EUR').fill('199')
    await editor.getByRole('radio', { name: 'Only this month' }).tap()
    await editor.getByRole('radio', { name: 'Done' }).tap()
    await page.waitForTimeout(250) // let the dialog's fade-in finish before the screenshot
    await page.screenshot({ path: 'e2e/output/statement-editor-phone.png' })
    await editor.getByRole('button', { name: 'Save' }).tap()
    await expect(editor).toBeHidden()
    await expect(moneyOut.getByRole('button', { name: /^The flat – Utilities:/ })).toHaveAccessibleName('The flat – Utilities: €199.00')
    await expect(page.getByRole('checkbox', { name: 'The flat – Utilities done' })).toBeChecked()
    await expect(progress).toHaveText('2 of 21 done · €6,216.00 still to pay · €7,405.00 to come in')
    await page.getByRole('button', { name: 'Next month' }).tap()
    await expect(page.getByRole('heading', { name: 'December 2026' })).toBeVisible()
    await expect(moneyOut.getByRole('button', { name: /^The flat – Utilities:/ })).toHaveAccessibleName('The flat – Utilities: €210.00, an estimate')
    await page.getByRole('button', { name: 'Previous month' }).tap()
    await expect(page.getByRole('heading', { name: 'November 2026' })).toBeVisible()

    // two items make Groceries a row that opens, with a tick per item
    await moneyOut.getByRole('button', { name: 'Living', exact: true }).tap()
    await moneyOut.getByRole('button', { name: /^Groceries:/ }).tap()
    await expect(editor.getByRole('heading', { name: /^Groceries/ })).toBeVisible()
    await editor.getByRole('tab', { name: 'Itemized' }).tap()
    await editor.getByRole('button', { name: 'Add item' }).tap()
    await editor.getByLabel('Item label').last().fill('Market')
    await editor.getByLabel('Item amount').last().fill('120')
    await editor.getByRole('button', { name: 'Save' }).tap()
    await expect(editor).toBeHidden()
    // one more thing to tick; the 120 more for groceries is 120 less for savings, so the open amount stays
    await expect(progress).toHaveText('2 of 22 done · €6,216.00 still to pay · €7,405.00 to come in')
    const items = moneyOut.getByRole('button', { name: 'Items of Groceries' })
    await expect(items).toHaveAttribute('aria-expanded', 'false')
    await items.tap()
    await expect(items).toHaveAttribute('aria-expanded', 'true')
    const market = page.getByRole('checkbox', { name: 'Groceries: Market done' })
    await expect(market).toBeVisible()
    await market.tap()
    await expect(market).toBeChecked()
    await expect(page.getByRole('checkbox', { name: 'Groceries done' })).toHaveAttribute('aria-checked', 'mixed')
    await expect(progress).toHaveText('3 of 22 done · €6,096.00 still to pay · €7,405.00 to come in')
    await page.screenshot({ path: 'e2e/output/statement-items-phone.png', fullPage: true })
    await page.getByRole('checkbox', { name: 'Groceries done' }).tap()
    await expect(page.getByRole('checkbox', { name: 'Groceries done' })).toBeChecked()
    await expect(page.getByRole('checkbox', { name: 'Groceries: Amount done' })).toBeChecked()
    await expect(progress).toHaveText('4 of 22 done · €5,396.00 still to pay · €7,405.00 to come in')

    // an automatic row can be ticked too
    const toSavings = page.getByRole('checkbox', { name: 'To savings done' })
    await toSavings.tap()
    await expect(toSavings).toBeChecked()
    await expect(progress).toHaveText('5 of 22 done · €3,136.00 still to pay · €7,405.00 to come in')

    // the Grid shows the same ticks as done dots
    const tabs = page.getByRole('navigation', { name: 'Screens' })
    await tabs.getByRole('link', { name: 'Grid' }).tap()
    await expect(page.getByRole('button', { name: /^The flat – Rent Nov 2026/ }).getByRole('img', { name: 'Done', exact: true })).toBeVisible()
    await tabs.getByRole('link', { name: 'Statement' }).tap()
    await expect(progress).toHaveText(/^5 of 22 done/)

    // a closed month: everything counts as done, nothing to tick. Reopening brings the ticks back; the items closing
    // marked as done (a schedule's posting, an itemized row) stay done
    await page.getByRole('button', { name: 'Close month' }).tap()
    await expect(progress).toHaveText('Closed · all done')
    await expect(page.getByText('closed', { exact: true })).toBeVisible()
    await expect(page.getByRole('checkbox')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Close month' })).toHaveCount(0)
    await page.screenshot({ path: 'e2e/output/statement-closed-phone.png' })
    await page.getByRole('button', { name: 'Reopen month' }).tap()
    await expect(progress).toHaveText(/^\d+ of 22 done/)
    await expect(page.getByRole('button', { name: 'Close month' })).toBeVisible()
    await expect(page.getByRole('checkbox', { name: 'To savings done' })).toBeChecked()
    await expect(page.getByRole('checkbox', { name: 'To savings done' })).toBeEnabled()
  })
})

test.describe('automatic rows on the desktop', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('ticking To savings on the Statement puts the green dot on the grid', async ({ page }) => {
    await page.goto('?demo=1&screen=grid')
    await page.getByRole('button', { name: 'Load the demo household' }).click()
    await page.getByRole('button', { name: 'Earlier months (2)' }).click()
    const toSavings = page.getByRole('row').filter({ has: page.getByRole('rowheader', { name: /^To savings/ }) })
    // the closed September already counts as done; November gets its dot from the tick ("Not done yet" also contains "done", hence exact)
    const dots = toSavings.getByRole('img', { name: 'Done', exact: true })
    await expect(dots).toHaveCount(1)
    const dotsBefore = 1
    await page.getByRole('navigation', { name: 'Screens' }).getByRole('link', { name: 'Statement' }).click()
    const moved = page.getByRole('checkbox', { name: 'To savings done' })
    await moved.click()
    await expect(moved).toBeChecked()
    await page.getByRole('navigation', { name: 'Screens' }).getByRole('link', { name: 'Grid' }).click()
    await expect(dots).toHaveCount(dotsBefore + 1)
  })
})
