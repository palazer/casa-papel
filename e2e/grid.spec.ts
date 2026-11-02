import { expect, test, type Page } from '@playwright/test'

async function loadDemo(page: Page) {
  await page.goto('?demo=1')
  await page.getByRole('button', { name: 'Load the demo household' }).click()
  await expect(page.getByRole('button', { name: /^Rent Nov 2026/ })).toBeVisible()
}

test.describe('grid', () => {
  test.use({ viewport: { width: 1400, height: 900 } })

  test('edit a cell, itemize, close and reopen a month', async ({ page }) => {
    await loadDemo(page)
    await page.screenshot({ path: 'e2e/output/grid.png' })

    // Utilities carry 210 forward from September (Rent is recurring-driven now); change November onwards to 250
    const utilNov = page.getByRole('button', { name: /^Utilities Nov 2026/ })
    await expect(utilNov).toContainText('210')
    await utilNov.click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.getByLabel('Amount in EUR').fill('250')
    await page.getByRole('radio', { name: 'This month and onwards' }).click()
    await page.screenshot({ path: 'e2e/output/editor.png' })
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByRole('dialog')).toBeHidden()
    await expect(page.getByRole('button', { name: /^Utilities Nov 2026/ })).toContainText('250')
    await expect(page.getByRole('button', { name: /^Utilities Dec 2026/ })).toContainText('250')
    await expect(page.getByRole('button', { name: /^Utilities Oct 2026/ })).toContainText('210')

    // only-this-month on December keeps January at 250
    await page.getByRole('button', { name: /^Utilities Dec 2026/ }).click()
    await page.getByLabel('Amount in EUR').fill('300')
    await page.getByRole('radio', { name: 'Only this month' }).click()
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByRole('dialog')).toBeHidden()
    await expect(page.getByRole('button', { name: /^Utilities Dec 2026/ })).toContainText('300')
    await expect(page.getByRole('button', { name: /^Utilities Jan 2027/ })).toContainText('250')

    // "How sure" on a single amount survives reopening as a single amount
    await page.getByRole('button', { name: /^Utilities Jan 2027/ }).click()
    await page.getByRole('radio', { name: 'Done' }).click()
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByRole('dialog')).toBeHidden()
    await expect(page.getByRole('button', { name: /^Utilities Jan 2027/ }).locator('svg.lucide-check')).toBeVisible()
    await page.getByRole('button', { name: /^Utilities Jan 2027/ }).click()
    await expect(page.getByRole('tab', { name: 'Single amount' })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('radio', { name: 'Done' })).toBeChecked()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toBeHidden()

    // itemize Groceries in November
    await page.getByRole('button', { name: /^Groceries Nov 2026/ }).click()
    await page.getByRole('tab', { name: 'Itemized' }).click()
    await page.getByRole('button', { name: 'Add item' }).click()
    const labels = page.getByLabel('Item label')
    await labels.last().fill('Birthday dinner')
    await page.getByLabel('Item amount').last().fill('120')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByRole('dialog')).toBeHidden()
    await expect(page.getByRole('button', { name: /^Groceries Nov 2026/ })).toContainText('820')

    // undo the itemization with the keyboard
    await page.keyboard.press('ControlOrMeta+z')
    await expect(page.getByRole('button', { name: /^Groceries Nov 2026/ })).toContainText('700')

    // close November via the month header
    await page.getByRole('button', { name: 'Nov 2026', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Close month' }).click()
    await expect(page.getByRole('button', { name: 'Nov 2026, closed', exact: true })).toBeVisible()
    await page.getByRole('button', { name: /^Utilities Nov 2026/ }).click()
    await expect(page.getByText('This month is closed.')).toBeVisible()
    await page.getByRole('button', { name: /^Reopen Nov 2026/ }).click()
    await expect(page.getByRole('button', { name: 'Nov 2026', exact: true })).toBeVisible()

    // keyboard navigation between cells
    await page.getByRole('button', { name: /^Sam – Salary Oct 2026/ }).focus()
    await page.keyboard.press('ArrowRight')
    await expect(page.getByRole('button', { name: /^Sam – Salary Nov 2026/ })).toBeFocused()
    await page.keyboard.press('ArrowDown')
    await expect(page.getByRole('button', { name: /^Alex – Salary Nov 2026/ })).toBeFocused()

    // add a row
    await page.getByRole('button', { name: 'Add expense row' }).click()
    await page.getByLabel('New expense row name').fill('Haircuts')
    await page.keyboard.press('Enter')
    await expect(page.getByRole('button', { name: /^Haircuts Nov 2026/ })).toBeVisible()
  })

})

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

  test('month view shows totals and rows, editor opens', async ({ page }) => {
    await page.goto('?demo=1')
    await page.getByRole('button', { name: 'Load the demo household' }).click()
    await expect(page.getByRole('heading', { name: 'November 2026' })).toBeVisible()
    await expect(page.getByText('Kept in account')).toBeVisible()
    await page.screenshot({ path: 'e2e/output/month-phone.png', fullPage: true })
    await page.getByRole('button', { name: /^Rent:/ }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.getByRole('button', { name: 'Cancel' }).click()
  })
})
