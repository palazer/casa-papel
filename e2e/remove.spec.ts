import { expect, test } from '@playwright/test'

/** The one dialog for removing things: what deleting loses, archive-only for closed history, blockers, Restore. */
test.describe('archive or delete', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('a row: delete with its impact and undo, archive one with closed history and restore it', async ({ page }) => {
    await page.goto('?demo=1&screen=grid')
    await page.getByRole('button', { name: 'Load the demo household' }).click()
    await expect(page.getByRole('button', { name: /^The flat – Rent Nov 2026/ })).toBeVisible()
    await page.getByRole('button', { name: 'Earlier months (2)' }).click()
    const dlg = page.getByRole('dialog')

    // Other income has no closed history: the dialog says what goes, Delete removes it, Undo brings it back
    await page.getByRole('button', { name: 'Row menu for Other income' }).click()
    await page.getByRole('menuitem', { name: 'Archive or delete…' }).click()
    await expect(dlg.getByRole('heading', { name: 'Row "Other income"' })).toBeVisible()
    await expect(dlg.getByText('Its amounts in 14 months (Nov 2026 – Dec 2027)')).toBeVisible()
    await expect(dlg.getByRole('button', { name: 'Archive from Nov 2026' })).toBeVisible()
    await page.screenshot({ path: 'e2e/output/remove-row.png' })
    await dlg.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(dlg).toBeHidden()
    await expect(page.getByRole('rowheader', { name: /^Other income/ })).toHaveCount(0)
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect(page.getByRole('rowheader', { name: /^Other income/ })).toBeVisible()

    // Groceries has amounts in September, which is closed: no Delete, only Archive
    await page.getByRole('button', { name: 'Row menu for Groceries' }).click()
    await page.getByRole('menuitem', { name: 'Archive or delete…' }).click()
    await expect(dlg.getByRole('heading', { name: 'Row "Groceries"' })).toBeVisible()
    await expect(dlg.getByText(/has amounts in closed months \(Sept 2026\), so it cannot be deleted/)).toBeVisible()
    await expect(dlg.getByRole('button', { name: 'Delete', exact: true })).toHaveCount(0)
    // September itself is refused as the archive month
    await dlg.getByLabel('Archive from: month').selectOption({ label: 'September' })
    await expect(dlg.getByText('Sept 2026 is closed and has amounts in it. Archive from Oct 2026 or later.')).toBeVisible()
    await expect(dlg.getByRole('button', { name: 'Archive from Sept 2026' })).toBeDisabled()
    await dlg.getByLabel('Archive from: month').selectOption({ label: 'November' })
    await page.screenshot({ path: 'e2e/output/remove-archive-only.png' })
    await dlg.getByRole('button', { name: 'Archive from Nov 2026' }).click()
    await expect(dlg).toBeHidden()
    // the row stays on the grid with its earlier months; from November the cells are blank
    await expect(page.getByRole('button', { name: /^Groceries Oct 2026/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /^Groceries Nov 2026/ })).toHaveCount(0)

    // Household lists it under Archived rows; Restore brings it back
    await page.getByRole('link', { name: 'Household' }).click()
    await expect(page.getByRole('heading', { name: 'Archived rows' })).toBeVisible()
    const archived = page.getByRole('listitem').filter({ hasText: 'Groceries' }).filter({ hasText: 'since Nov 2026' })
    await expect(archived).toBeVisible()
    await archived.getByRole('button', { name: 'Restore' }).click()
    await expect(page.getByRole('heading', { name: 'Archived rows' })).toHaveCount(0)
    await page.getByRole('link', { name: 'Grid' }).click()
    await expect(page.getByRole('button', { name: /^Groceries Nov 2026/ })).toBeVisible()
  })

  test('an account: a virtual account inside it blocks the delete; a schedule goes from the list', async ({ page }) => {
    await page.goto('?demo=1&screen=grid')
    await page.getByRole('button', { name: 'Load the demo household' }).click()
    await expect(page.getByRole('button', { name: /^The flat – Rent Nov 2026/ })).toBeVisible()
    await page.getByRole('link', { name: 'Household' }).click()
    const dlg = page.getByRole('dialog')

    // a new savings account opened this month (so no closed history) holding a new virtual account
    await page.getByRole('button', { name: 'Add account' }).click()
    await dlg.getByLabel('Name').fill('Holiday')
    await dlg.getByLabel('Type').selectOption({ label: 'Savings' })
    await dlg.getByRole('button', { name: /^More options/ }).click()
    await dlg.getByLabel('Opening month: month').selectOption({ label: 'November' })
    await expect(dlg.getByLabel('Holds at the start of November 2026 (EUR)')).toBeVisible()
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    await page.getByRole('button', { name: 'Add virtual account' }).click()
    await dlg.getByLabel('Name').fill('Gifts')
    await dlg.getByLabel('Held in').selectOption({ label: 'Holiday' })
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()

    // the account's dialog hands over to the remove dialog, which shows the blocker
    const holiday = page.getByRole('listitem').filter({ has: page.getByText('Holiday', { exact: true }) })
    const gifts = page.getByRole('listitem').filter({ has: page.getByText('Gifts', { exact: true }) })
    await holiday.getByRole('button', { name: 'Edit' }).click()
    await dlg.getByRole('button', { name: 'Archive or delete…' }).click()
    await expect(dlg.getByRole('heading', { name: 'Account "Holiday"' })).toBeVisible()
    await expect(dlg.getByText('Resolve these first')).toBeVisible()
    await expect(dlg.getByText(/The virtual account "Gifts" is held in it/)).toBeVisible()
    await expect(dlg.getByRole('button', { name: 'Delete', exact: true })).toBeDisabled()
    await page.screenshot({ path: 'e2e/output/remove-blocked.png' })
    await dlg.getByRole('button', { name: 'Cancel' }).click()
    await expect(dlg).toBeHidden()

    // the virtual account can go (nothing has moved through it yet); then the account can too
    await gifts.getByRole('button', { name: 'Edit' }).click()
    await dlg.getByRole('button', { name: 'Archive or delete…' }).click()
    await expect(dlg.getByRole('heading', { name: 'Virtual account "Gifts"' })).toBeVisible()
    await expect(dlg.getByText('The row "To Gifts" that fills it')).toBeVisible()
    await dlg.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(dlg).toBeHidden()
    await expect(gifts).toHaveCount(0)
    await holiday.getByRole('button', { name: 'Edit' }).click()
    await dlg.getByRole('button', { name: 'Archive or delete…' }).click()
    await expect(dlg.getByText('Only the account itself')).toBeVisible()
    await dlg.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(dlg).toBeHidden()
    await expect(holiday).toHaveCount(0)

    // a schedule from the list: Delete… opens the same dialog
    const schedules = page.getByRole('table').filter({ has: page.getByRole('columnheader', { name: 'When' }) })
    await expect(schedules.getByRole('cell', { name: 'Dog tax', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Menu for Dog tax' }).click()
    await page.getByRole('menuitem', { name: 'Delete…' }).click()
    await expect(dlg.getByRole('heading', { name: 'Schedule "Dog tax"' })).toBeVisible()
    await expect(dlg.getByText(/use "End after" in the schedules list/)).toBeVisible()
    await dlg.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(dlg).toBeHidden()
    await expect(schedules.getByRole('cell', { name: 'Dog tax', exact: true })).toHaveCount(0)
  })
})
