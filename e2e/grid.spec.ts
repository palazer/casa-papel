import { expect, test, type Page } from '@playwright/test'

async function loadDemo(page: Page) {
  await page.goto('?demo=1&screen=grid')
  await page.getByRole('button', { name: 'Load the demo household' }).click()
  await expect(page.getByRole('button', { name: /^The flat – Rent Nov 2026/ })).toBeVisible()
}

test.describe('grid', () => {
  test.use({ viewport: { width: 1400, height: 900 } })

  test('edit a cell, itemize, close and reopen a month', async ({ page }) => {
    await loadDemo(page)
    await page.screenshot({ path: 'e2e/output/grid.png' })
    // an estimate sits on the yellow shade here as on the Statement; a certain amount is plain
    await expect(page.getByRole('button', { name: /^The flat – Utilities Nov 2026/ }).locator('.bg-estimate')).toHaveText(/210/)
    await expect(page.getByRole('button', { name: /^The flat – Rent Nov 2026/ }).locator('.bg-estimate')).toHaveCount(0)
    // the months before the current one are needed here: September is the closed month, October the one that keeps its amount
    await page.getByRole('button', { name: 'Earlier months (2)' }).click()

    // Utilities carry 210 forward from September (Rent is recurring-driven now); change November onwards to 250
    const utilNov = page.getByRole('button', { name: /^The flat – Utilities Nov 2026/ })
    await expect(utilNov).toContainText('210')
    await utilNov.click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.getByLabel('Amount in EUR').fill('250')
    await page.getByRole('radio', { name: 'Every month' }).click()
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
    await dlg.getByLabel(/^Owed at the start of/).fill('5000')
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
    await page.getByRole('radio', { name: 'Every month' }).click()
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByRole('dialog')).toBeHidden()
    await expect(page.getByRole('button', { name: /^Car loan · outstanding Nov 2026/ })).toContainText('4,800')
    await expect(page.getByRole('button', { name: /^Car loan · outstanding Dec 2026/ })).toContainText('4,600')
    await page.getByRole('button', { name: 'Row menu for Car loan payment' }).click()
    await expect(page.getByRole('menuitem', { name: 'Pays off…' })).toBeVisible()
    await page.keyboard.press('Escape')
  })
})

test.describe('grid: the current accounts', () => {
  test.use({ viewport: { width: 1400, height: 900 } })

  test('have a row under Balances that counts in Net worth and takes their real balances', async ({ page }) => {
    await loadDemo(page)
    // the row is named like the Statement's line and sits first under Balances
    await expect(page.getByRole('rowheader', { name: /^Current accounts/ })).toBeVisible()
    const nov = page.getByRole('button', { name: /^Current accounts Nov 2026:/ })
    await expect(nov).toHaveText('€78.00')
    // with it the rows add up: 78 + 14,236 savings + 13,729.16 investments − 78 on the card
    const netWorth = page.getByRole('row', { name: /^Net worth/ }).getByRole('cell').first()
    await expect(netWorth).toHaveText('€27,965.16')

    // a click on a month opens the same dialog as on the Statement
    await nov.click()
    const dlg = page.getByRole('dialog')
    await expect(dlg.getByRole('heading', { name: 'Current accounts · November 2026' })).toBeVisible()
    await dlg.getByLabel('Main account (EUR)').fill('1150')
    await dlg.getByLabel('Joint account (EUR)').fill('300')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    // the entered month is underlined, net worth follows, and December continues from the real number:
    // 1,450 plus the 18 bought on the card that month and not yet paid
    await expect(nov).toHaveText('€1,450.00')
    await expect(nov).toHaveClass(/underline/)
    await expect(netWorth).toHaveText('€29,337.16')
    const dec = page.getByRole('button', { name: /^Current accounts Dec 2026:/ })
    await expect(dec).toHaveText('€1,468.00')
    await expect(dec).not.toHaveClass(/underline/)
    await page.screenshot({ path: 'e2e/output/grid-current-accounts.png' })

    // the Statement shows the same month as entered
    await page.getByRole('navigation', { name: 'Screens' }).getByRole('link', { name: 'Statement' }).click()
    await expect(page.getByRole('region', { name: 'Assets' }).getByRole('button', { name: 'Current accounts balance: €1,450.00, entered' })).toBeVisible()
  })
})
