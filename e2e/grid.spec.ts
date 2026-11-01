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

    // Rent carries 1,650 forward from September; change November onwards to 1,700
    const rentNov = page.getByRole('button', { name: /^Rent Nov 2026/ })
    await expect(rentNov).toContainText('1,650')
    await rentNov.click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.getByLabel('Amount in EUR').fill('1700')
    await page.getByRole('radio', { name: 'This month and onwards' }).click()
    await page.screenshot({ path: 'e2e/output/editor.png' })
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByRole('button', { name: /^Rent Nov 2026/ })).toContainText('1,700')
    await expect(page.getByRole('button', { name: /^Rent Dec 2026/ })).toContainText('1,700')
    await expect(page.getByRole('button', { name: /^Rent Oct 2026/ })).toContainText('1,650')

    // only-this-month on December keeps January at 1,700
    await page.getByRole('button', { name: /^Rent Dec 2026/ }).click()
    await page.getByLabel('Amount in EUR').fill('1800')
    await page.getByRole('radio', { name: 'Only this month' }).click()
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByRole('button', { name: /^Rent Dec 2026/ })).toContainText('1,800')
    await expect(page.getByRole('button', { name: /^Rent Jan 2027/ })).toContainText('1,700')

    // itemize Groceries in November
    await page.getByRole('button', { name: /^Groceries Nov 2026/ }).click()
    await page.getByRole('tab', { name: 'Itemized' }).click()
    await page.getByRole('button', { name: 'Add item' }).click()
    const labels = page.getByLabel('Item label')
    await labels.last().fill('Birthday dinner')
    await page.getByLabel('Item amount').last().fill('120')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByRole('button', { name: /^Groceries Nov 2026/ })).toContainText('820')

    // undo the itemization with the keyboard
    await page.keyboard.press('ControlOrMeta+z')
    await expect(page.getByRole('button', { name: /^Groceries Nov 2026/ })).toContainText('700')

    // close November via the month header
    await page.getByRole('button', { name: 'Nov 2026', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Close month' }).click()
    await expect(page.getByRole('button', { name: 'Nov 2026, closed', exact: true })).toBeVisible()
    await page.getByRole('button', { name: /^Rent Nov 2026/ }).click()
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

  test('quick create a household on the real store', async ({ page }) => {
    await page.goto('/')
    await page.getByLabel('Household name').fill('Testers')
    await page.getByRole('button', { name: 'Create household' }).click()
    await expect(page.getByRole('banner').getByText('Testers')).toBeVisible()
    await expect(page.getByRole('button', { name: /^Salary Nov 2026/ })).toBeVisible()
    await page.getByRole('button', { name: 'Data' }).click()
    await page.getByLabel('Type WIPE to confirm').fill('WIPE')
    await page.getByRole('button', { name: 'Wipe this device' }).click()
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
