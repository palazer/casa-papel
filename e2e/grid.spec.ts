import { expect, test, type Page } from '@playwright/test'

async function loadDemo(page: Page) {
  await page.goto('?demo=1')
  await page.getByRole('button', { name: 'Load the demo household' }).click()
  await expect(page.getByRole('button', { name: /^The flat – Rent Nov 2026/ })).toBeVisible()
}

test.describe('grid', () => {
  test.use({ viewport: { width: 1400, height: 900 } })

  test('edit a cell, itemize, close and reopen a month', async ({ page }) => {
    await loadDemo(page)
    await page.screenshot({ path: 'e2e/output/grid.png' })

    // Utilities carry 210 forward from September (Rent is recurring-driven now); change November onwards to 250
    const utilNov = page.getByRole('button', { name: /^The flat – Utilities Nov 2026/ })
    await expect(utilNov).toContainText('210')
    await utilNov.click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.getByLabel('Amount in EUR').fill('250')
    await page.getByRole('radio', { name: 'This month and onwards' }).click()
    await page.screenshot({ path: 'e2e/output/editor.png' })
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByRole('dialog')).toBeHidden()
    await expect(page.getByRole('button', { name: /^The flat – Utilities Nov 2026/ })).toContainText('250')
    await expect(page.getByRole('button', { name: /^The flat – Utilities Dec 2026/ })).toContainText('250')
    await expect(page.getByRole('button', { name: /^The flat – Utilities Oct 2026/ })).toContainText('210')

    // only-this-month on December keeps January at 250
    await page.getByRole('button', { name: /^The flat – Utilities Dec 2026/ }).click()
    await page.getByLabel('Amount in EUR').fill('300')
    await page.getByRole('radio', { name: 'Only this month' }).click()
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByRole('dialog')).toBeHidden()
    await expect(page.getByRole('button', { name: /^The flat – Utilities Dec 2026/ })).toContainText('300')
    await expect(page.getByRole('button', { name: /^The flat – Utilities Jan 2027/ })).toContainText('250')

    // "How sure" on a single amount survives reopening as a single amount
    await page.getByRole('button', { name: /^The flat – Utilities Jan 2027/ }).click()
    await page.getByRole('radio', { name: 'Done' }).click()
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByRole('dialog')).toBeHidden()
    await expect(page.getByRole('button', { name: /^The flat – Utilities Jan 2027/ }).getByRole('img', { name: 'Done' })).toBeVisible()
    await page.getByRole('button', { name: /^The flat – Utilities Jan 2027/ }).click()
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
    await page.getByRole('button', { name: /^The flat – Utilities Nov 2026/ }).click()
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
    await page.getByRole('button', { name: /^The flat – Rent:/ }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.getByRole('button', { name: 'Cancel' }).click()
  })
})

test.describe('grid: add a transfer row', () => {
  test.use({ viewport: { width: 1400, height: 900 } })

  test('a new transfer row can be a deposit into an investment account', async ({ page }) => {
    await loadDemo(page)
    await page.getByRole('button', { name: 'Add transfer row' }).click()
    const what = page.getByLabel('What the new transfer row does')
    await expect(what).toHaveValue('plain')
    // "To savings" takes the rest already; a further savings row is offered and gets an amount of its own
    await expect(what.locator('option[value="to-savings"]')).toHaveCount(1)
    await what.selectOption('to-investment')
    await expect(page.getByLabel('Account for the new transfer row')).toHaveValue(/./)
    await expect(page.getByText('deposited total and return')).toBeVisible()
    await page.getByLabel('New transfer row name').fill('Extra deposits')
    await page.keyboard.press('Enter')
    await expect(page.getByRole('button', { name: /^Extra deposits Nov 2026/ })).toBeVisible()
    await page.getByRole('button', { name: 'Row menu for Extra deposits' }).click()
    await expect(page.getByRole('menuitem', { name: 'Goes into…' })).toBeVisible()
  })
})

test.describe('grid: a row that pays off a loan', () => {
  test.use({ viewport: { width: 1400, height: 900 } })

  test('"Add row" under Expenses can bring a loan down', async ({ page }) => {
    await loadDemo(page)
    await page.getByRole('link', { name: 'Household' }).click()
    await page.getByRole('button', { name: 'Add account' }).click()
    const dlg = page.getByRole('dialog')
    await dlg.getByLabel('Name', { exact: true }).fill('Car loan')
    await dlg.getByLabel('Type').selectOption('loan')
    await dlg.getByLabel('Opening balance').fill('5000')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()

    await page.getByRole('link', { name: 'Grid' }).click()
    await page.getByRole('button', { name: 'Add expense row' }).click()
    await page.getByLabel('What the new expense row does').selectOption('pay-off')
    await expect(page.getByLabel('Account for the new expense row')).toHaveValue(/./)
    await expect(page.getByText('brings down what is owed')).toBeVisible()
    await page.getByLabel('New expense row name').fill('Car loan payment')
    await page.keyboard.press('Enter')
    const cell = page.getByRole('button', { name: /^Car loan payment Nov 2026/ })
    await expect(cell).toBeVisible()
    await cell.click()
    await page.getByLabel('Amount in EUR').fill('200')
    await page.getByRole('radio', { name: 'This month and onwards' }).click()
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByRole('dialog')).toBeHidden()
    await expect(page.getByRole('button', { name: /^Car loan · outstanding Nov 2026/ })).toContainText('4,800')
    await expect(page.getByRole('button', { name: /^Car loan · outstanding Dec 2026/ })).toContainText('4,600')
    await page.getByRole('button', { name: 'Row menu for Car loan payment' }).click()
    await expect(page.getByRole('menuitem', { name: 'Pays off…' })).toBeVisible()
    await page.keyboard.press('Escape')
  })
})
