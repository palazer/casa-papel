import { expect, test } from '@playwright/test'

/** Tracking the month from the phone: ticks, the Paid sheet, the accordion, Hide done, automatic rows, a closed month. */
test.describe('month tracking on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

  test('ticks, the paid sheet, the accordion, hide done, automatic rows and a closed month', async ({ page }) => {
    await page.goto('?demo=1')
    await page.getByRole('button', { name: 'Load the demo household' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Month' })).toBeVisible()
    const progress = page.getByRole('status')
    await expect(progress).toHaveText('0 of 21 done · €8,065.00 still to pay · €7,405.00 to come in')
    await page.screenshot({ path: 'e2e/output/month-track.png', fullPage: true })

    // one tap: Rent is paid
    const rent = page.getByRole('checkbox', { name: 'The flat – Rent done' })
    await expect(rent).not.toBeChecked()
    await rent.tap()
    await expect(rent).toBeChecked()
    await expect(progress).toHaveText('1 of 21 done · €6,415.00 still to pay · €7,405.00 to come in')

    // the Paid sheet: Utilities actually cost 199 this month; December keeps its 210
    await page.getByRole('button', { name: /^The flat – Utilities:/ }).tap()
    const sheet = page.getByRole('dialog')
    await expect(sheet.getByRole('heading', { name: 'The flat – Utilities' })).toBeVisible()
    await expect(sheet.getByLabel('Amount in EUR')).toHaveValue('210')
    await expect(sheet.getByLabel('Date')).toHaveValue(/^\d{4}-\d{2}-\d{2}$/)
    await expect(sheet.getByRole('radio', { name: 'Done' })).toHaveAttribute('aria-checked', 'true')
    await sheet.getByLabel('Amount in EUR').fill('199')
    await page.waitForTimeout(250) // let the sheet's fade-in finish before the screenshot
    await page.screenshot({ path: 'e2e/output/month-paid-sheet.png' })
    await sheet.getByRole('button', { name: 'Save' }).tap()
    await expect(sheet).toBeHidden()
    await expect(page.getByRole('button', { name: /^The flat – Utilities: -€199\.00/ })).toBeVisible()
    await expect(page.getByRole('checkbox', { name: 'The flat – Utilities done' })).toBeChecked()
    await expect(progress).toHaveText('2 of 21 done · €6,216.00 still to pay · €7,405.00 to come in')
    await page.getByRole('button', { name: 'Next month' }).tap()
    await expect(page.getByRole('heading', { name: 'December 2026' })).toBeVisible()
    await expect(page.getByRole('button', { name: /^The flat – Utilities: -€210\.00/ })).toBeVisible()
    await page.getByRole('button', { name: 'Previous month' }).tap()
    await expect(page.getByRole('heading', { name: 'November 2026' })).toBeVisible()

    // the full editor is one tap away; two items make Groceries an accordion with a tick per item
    await page.getByRole('button', { name: /^Groceries:/ }).tap()
    await page.getByRole('dialog').getByRole('button', { name: 'Open full editor' }).tap()
    const editor = page.getByRole('dialog')
    await expect(editor.getByRole('heading', { name: /^Groceries/ })).toBeVisible()
    await editor.getByRole('tab', { name: 'Itemized' }).tap()
    await editor.getByRole('button', { name: 'Add item' }).tap()
    await editor.getByLabel('Item label').fill('Market')
    await editor.getByLabel('Item amount').fill('120')
    await editor.getByRole('button', { name: 'Save' }).tap()
    await expect(editor).toBeHidden()
    const groceries = page.getByRole('button', { name: /^Groceries: -€/ })
    await expect(groceries).toHaveAttribute('aria-expanded', 'false')
    await expect(progress).toHaveText('2 of 22 done · €6,216.00 still to pay · €7,405.00 to come in')
    await groceries.tap()
    await expect(groceries).toHaveAttribute('aria-expanded', 'true')
    const market = page.getByRole('checkbox', { name: 'Groceries: Market done' })
    await expect(market).toBeVisible()
    await market.tap()
    await expect(market).toBeChecked()
    await expect(page.getByRole('checkbox', { name: 'Groceries done' })).toHaveAttribute('aria-checked', 'mixed')
    await expect(progress).toHaveText('3 of 22 done · €6,096.00 still to pay · €7,405.00 to come in')
    await page.screenshot({ path: 'e2e/output/month-accordion.png', fullPage: true })
    await page.getByRole('checkbox', { name: 'Groceries done' }).tap()
    await expect(page.getByRole('checkbox', { name: 'Groceries done' })).toBeChecked()
    await expect(page.getByRole('checkbox', { name: 'Groceries: Amount done' })).toBeChecked()
    await expect(progress).toHaveText('4 of 22 done · €5,396.00 still to pay · €7,405.00 to come in')

    // an automatic row can be ticked too
    const toSavings = page.getByRole('checkbox', { name: 'To savings done' })
    await toSavings.tap()
    await expect(toSavings).toBeChecked()
    await expect(progress).toHaveText('5 of 22 done · €3,136.00 still to pay · €7,405.00 to come in')

    // hide what is done
    await page.getByRole('switch', { name: 'Hide done' }).tap()
    await expect(page.getByRole('checkbox', { name: 'The flat – Rent done' })).toHaveCount(0)
    await expect(page.getByRole('checkbox', { name: 'To savings done' })).toHaveCount(0)
    await expect(page.getByRole('checkbox', { name: 'Robin – Childcare done' })).toBeVisible()
    await page.getByRole('switch', { name: 'Hide done' }).tap()
    await expect(page.getByRole('checkbox', { name: 'The flat – Rent done' })).toBeVisible()

    // Moves agrees
    await page.getByRole('navigation', { name: 'Screens' }).getByRole('link', { name: 'Moves' }).tap()
    await expect(page.getByLabel('Rent paid')).toBeChecked()
    await expect(page.getByLabel('To savings transferred')).toBeChecked()
    await page.getByRole('navigation', { name: 'Screens' }).getByRole('link', { name: 'Month' }).tap()

    // a closed month: everything done, nothing to tick
    await page.getByRole('button', { name: 'Close month' }).tap()
    await expect(progress).toHaveText('Closed · all done')
    await expect(page.getByRole('checkbox', { name: 'Robin – Childcare done' })).toBeDisabled()
    await expect(page.getByRole('checkbox', { name: 'Robin – Childcare done' })).toBeChecked()
    await page.getByRole('button', { name: 'Reopen month' }).tap()
    await expect(progress).toHaveText(/of 22 done/)
    await expect(page.getByRole('checkbox', { name: 'Robin – Childcare done' })).toBeEnabled()
  })
})

test.describe('automatic rows on the desktop', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('ticking To savings in Moves puts the green dot on the grid', async ({ page }) => {
    await page.goto('?demo=1')
    await page.getByRole('button', { name: 'Load the demo household' }).click()
    await page.getByRole('button', { name: 'Earlier months (2)' }).click()
    const toSavings = page.getByRole('row').filter({ has: page.getByRole('rowheader', { name: /^To savings/ }) })
    // the closed September already counts as done; November gets its dot from the tick ("Not done yet" also contains "done", hence exact)
    const dots = toSavings.getByRole('img', { name: 'Done', exact: true })
    await expect(dots).toHaveCount(1)
    const dotsBefore = 1
    await page.getByRole('navigation', { name: 'Screens' }).getByRole('link', { name: 'Moves' }).click()
    await page.getByLabel('To savings transferred').click()
    await expect(page.getByLabel('To savings transferred')).toBeChecked()
    await page.getByRole('navigation', { name: 'Screens' }).getByRole('link', { name: 'Grid' }).click()
    await expect(dots).toHaveCount(dotsBefore + 1)
  })
})
