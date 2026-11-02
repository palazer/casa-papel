import { expect, test, type Page } from '@playwright/test'

async function loadDemo(page: Page) {
  await page.goto('?demo=1')
  await page.getByRole('button', { name: 'Load the demo household' }).click()
  await expect(page.getByRole('button', { name: /^Rent Nov 2026/ })).toBeVisible()
}

test.describe('done dots', () => {
  test.use({ viewport: { width: 1400, height: 900 } })

  test('this month shows a dot per cell; itemized cells go from partly to all done', async ({ page }) => {
    await loadDemo(page)
    const rent = page.getByRole('button', { name: /^Rent Nov 2026/ })
    await expect(rent.getByRole('img', { name: 'Not done yet' })).toBeVisible()
    // closed and future months carry no dot
    await expect(page.getByRole('button', { name: /^Rent Sept 2026/ }).getByRole('img')).toHaveCount(0)
    await expect(page.getByRole('button', { name: /^Rent Dec 2026/ }).getByRole('img')).toHaveCount(0)

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

test.describe('done dots phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

  test('month view shows the same dots', async ({ page }) => {
    await page.goto('?demo=1')
    await page.getByRole('button', { name: 'Load the demo household' }).click()
    await expect(page.getByRole('heading', { name: 'November 2026' })).toBeVisible()
    await expect(page.getByRole('button', { name: /^Rent:/ }).getByRole('img', { name: 'Not done yet' })).toBeVisible()
    await page.screenshot({ path: 'e2e/output/done-dots-phone.png', fullPage: true })
  })
})
