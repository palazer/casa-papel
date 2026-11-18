import { expect, test } from './test'

/** The one dialog for removing things: what deleting loses, which months that are over change with it, blockers, Restore. */
test.describe('archive or delete', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('a row: delete with its impact and undo, archive one with amounts in months that are over and restore it', async ({ page }) => {
    await page.goto('?demo=1&screen=grid')
    await page.getByRole('button', { name: 'Load the demo household' }).click()
    await expect(page.getByRole('button', { name: /^The flat – Rent Nov 2026/ })).toBeVisible()
    await page.getByRole('button', { name: 'Earlier months (2)' }).click()
    const dlg = page.getByRole('dialog')

    // Other income begins in the current month: the dialog says what goes, Delete removes it, Undo brings it back
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

    // Travel has an amount in October, which is over: the dialog says that deleting changes that month too
    await page.getByRole('button', { name: 'Row menu for Travel' }).click()
    await page.getByRole('menuitem', { name: 'Archive or delete…' }).click()
    await expect(dlg.getByRole('heading', { name: 'Row "Travel"' })).toBeVisible()
    await expect(dlg.getByText('Its amounts in 15 months (Oct 2026 – Dec 2027)')).toBeVisible()
    await expect(dlg.getByText('1 of these months is over (Oct 2026): it changes too')).toBeVisible()
    await page.screenshot({ path: 'e2e/output/remove-months-over.png' })
    await dlg.getByRole('button', { name: 'Cancel' }).click()
    await expect(dlg).toBeHidden()

    // Groceries has amounts in September and October, which are over: the dialog says so, and still offers both ways
    await page.getByRole('button', { name: 'Row menu for Groceries' }).click()
    await page.getByRole('menuitem', { name: 'Archive or delete…' }).click()
    await expect(dlg.getByRole('heading', { name: 'Row "Groceries"' })).toBeVisible()
    await expect(dlg.getByText('2 of these months are over (Sept–Oct 2026): they change too')).toBeVisible()
    await expect(dlg.getByText(/cannot be deleted/)).toHaveCount(0)
    await expect(dlg.getByRole('button', { name: 'Delete', exact: true })).toBeEnabled()
    // an archive can start in any month of the household, its first one too
    await dlg.getByLabel('Archive from: month').selectOption({ label: 'September' })
    await expect(dlg.getByRole('alert')).toHaveCount(0)
    await expect(dlg.getByRole('button', { name: 'Archive from Sept 2026' })).toBeEnabled()
    await dlg.getByLabel('Archive from: month').selectOption({ label: 'November' })
    await page.screenshot({ path: 'e2e/output/remove-archive-or-delete.png' })
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

  test('restore says what came back with it, and "Undo" beside the message archives everything again', async ({ page }) => {
    await page.goto('?demo=1&screen=grid')
    await page.getByRole('button', { name: 'Load the demo household' }).click()
    const rentNov = page.getByRole('button', { name: /^The flat – Rent Nov 2026/ })
    await expect(rentNov).toBeVisible()
    await page.getByRole('button', { name: 'Earlier months (2)' }).click()
    const dlg = page.getByRole('dialog')
    const said = page.getByRole('status').filter({ hasText: 'Restored' })

    // Rent is on a schedule: archiving ends it, and the dialog says that restoring puts back what it lists
    await page.getByRole('button', { name: 'Row menu for The flat – Rent' }).click()
    await page.getByRole('menuitem', { name: 'Archive or delete…' }).click()
    await expect(dlg.getByText('Restore any time under Household: restoring puts back what is listed here.')).toBeVisible()
    await dlg.getByRole('button', { name: 'Archive from Nov 2026' }).click()
    await expect(dlg).toBeHidden()
    await expect(rentNov).toHaveCount(0)

    // the row's own menu restores it in the Grid: the schedule runs again, and the message says so
    await page.getByRole('button', { name: 'Row menu for The flat – Rent' }).click()
    await page.getByRole('menuitem', { name: 'Restore' }).click()
    await expect(said).toHaveText(/^Restored "The flat – Rent": its schedule "Rent" runs again\./)
    await expect(rentNov).toContainText('1,650')
    await page.screenshot({ path: 'e2e/output/restore-row.png' })

    // "Undo" beside the message takes the whole restore back, and the message goes with it
    await said.getByRole('button', { name: 'Undo' }).click()
    await expect(rentNov).toHaveCount(0)
    await expect(said).toHaveCount(0)

    // the same from Household's list of archived rows
    await page.getByRole('link', { name: 'Household' }).click()
    const archivedRent = page.getByRole('listitem').filter({ hasText: 'The flat – Rent' }).filter({ hasText: 'since Nov 2026' })
    await archivedRent.getByRole('button', { name: 'Restore' }).click()
    await expect(said).toHaveText(/^Restored "The flat – Rent": its schedule "Rent" runs again\./)
    await expect(page.getByRole('heading', { name: 'Archived rows' })).toHaveCount(0)
    await said.getByRole('button', { name: 'Dismiss' }).click()
    await expect(said).toHaveCount(0)

    // an account takes its virtual accounts with it, and brings them back: their rows, and what came out of them
    const savings = page.getByRole('listitem').filter({ has: page.getByText('Savings', { exact: true }) })
    await savings.getByRole('button', { name: 'Edit' }).click()
    await dlg.getByRole('button', { name: 'Archive or delete…' }).click()
    await expect(dlg.getByRole('heading', { name: 'Account "Savings"' })).toBeVisible()
    await dlg.getByRole('button', { name: 'Archive from Nov 2026' }).click()
    await expect(dlg).toBeHidden()
    const archivedSavings = page.getByRole('listitem').filter({ hasText: 'Savings' }).filter({ hasText: 'since Nov 2026' })
    await expect(archivedSavings).toBeVisible()
    // a virtual account of an archived account is not restored by itself
    const archivedTravel = page.getByRole('listitem').filter({ has: page.getByText('Travel', { exact: true }) }).filter({ hasText: 'since Nov 2026' })
    await archivedTravel.getByRole('button', { name: 'Restore' }).click()
    await expect(page.getByRole('alert').filter({ hasText: 'Restore the account first.' })).toHaveText('"Travel" is held in "Savings", which is archived. Restore the account first.')
    // nor the row that fills it, which waits under "Archived rows"
    await page.getByRole('listitem').filter({ hasText: 'To Travel' }).filter({ hasText: 'since Nov 2026' }).getByRole('button', { name: 'Restore' }).click()
    await expect(page.getByRole('alert').filter({ hasText: 'its row comes back with it' })).toHaveText('"To Travel" fills the virtual account "Travel", which is archived. Restore the virtual account: its row comes back with it.')
    await archivedSavings.getByRole('button', { name: 'Restore' }).click()
    await expect(said).toHaveText(/^Restored "Savings": its virtual accounts "Travel" and "Clothing" are back, filled by "To Travel" and "To Clothing" again; "Travel" comes out of "Travel" again; "Clothing" comes out of "Clothing" again\./)
    await expect(archivedTravel).toHaveCount(0)
    await page.screenshot({ path: 'e2e/output/restore-account.png' })
    await page.getByRole('link', { name: 'Grid' }).click()
    await expect(page.getByRole('button', { name: /^To Travel Nov 2026/ })).toBeVisible()
  })

  test('an account: a virtual account inside it blocks the delete; a schedule goes from the list', async ({ page }) => {
    await page.goto('?demo=1&screen=grid')
    await page.getByRole('button', { name: 'Load the demo household' }).click()
    await expect(page.getByRole('button', { name: /^The flat – Rent Nov 2026/ })).toBeVisible()
    await page.getByRole('link', { name: 'Household' }).click()
    const dlg = page.getByRole('dialog')

    // a new savings account opened this month (so nothing of it is over) holding a new virtual account
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
