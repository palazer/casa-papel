import { expect, test, type Page } from '@playwright/test'

async function loadDemo(page: Page) {
  await page.goto('?demo=1&screen=grid')
  await page.getByRole('button', { name: 'Load the demo household' }).click()
  await expect(page.getByRole('button', { name: /^The flat – Rent Nov 2026/ })).toBeVisible()
}

test.describe('done dots', () => {
  test.use({ viewport: { width: 1400, height: 900 } })

  test('this month shows a dot per cell; itemized cells go from partly to all done', async ({ page }) => {
    await loadDemo(page)
    // the Grid starts at the current month; the closed September is one button away
    await page.getByRole('button', { name: 'Earlier months (2)' }).click()
    const rent = page.getByRole('button', { name: /^The flat – Rent Nov 2026/ })
    await expect(rent.getByRole('img', { name: 'Not done yet' })).toBeVisible()
    // a closed month is done, so it carries the green dot; future months carry none
    await expect(page.getByRole('button', { name: /^The flat – Rent Sept 2026/ }).getByRole('img', { name: 'Done' })).toBeVisible()
    await expect(page.getByRole('button', { name: /^The flat – Rent Dec 2026/ }).getByRole('img')).toHaveCount(0)

    const groceries = page.getByRole('button', { name: /^Groceries Nov 2026/ })
    await groceries.click()
    const dlg = page.getByRole('dialog')
    await dlg.getByRole('tab', { name: 'Itemized' }).click()
    await dlg.getByRole('button', { name: 'Add item' }).click()
    await dlg.getByRole('button', { name: 'Add item' }).click()
    const amounts = dlg.getByLabel('Item amount')
    await amounts.nth(-2).fill('400')
    await amounts.last().fill('50')
    await dlg.getByLabel('Item status').last().selectOption('done')
    await expect(dlg.getByText(/^\d+ of \d+ done$/)).toBeVisible()
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    await expect(groceries.getByRole('img', { name: /^\d+ of \d+ done$/ })).toBeVisible()

    await groceries.click()
    await dlg.getByRole('button', { name: 'Mark all done' }).click()
    await expect(dlg.getByText('All done', { exact: true })).toBeVisible()
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    await expect(groceries.getByRole('img', { name: 'Done' })).toBeVisible()
    await page.screenshot({ path: 'e2e/output/done-dots.png' })
  })
})
