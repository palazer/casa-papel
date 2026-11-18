import { expect, saveAnyway, test } from './test'

/** The list of schedules under Household: a change made there names no month, so it counts from the current one. */
test.describe('the list of schedules', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('a new amount counts from the current month, and the months before keep theirs', async ({ page }) => {
    await page.goto('?demo=1&screen=grid')
    await page.getByRole('button', { name: 'Load the demo household' }).click()
    await expect(page.getByRole('button', { name: /^The flat – Rent Nov 2026/ })).toBeVisible()
    await page.getByRole('link', { name: 'Household' }).click()
    const dlg = page.getByRole('dialog')
    const schedules = page.getByRole('table').filter({ has: page.getByRole('columnheader', { name: 'When' }) })
    const rent = schedules.getByRole('row').filter({ has: page.getByRole('cell', { name: /^Rent/ }) })
    await expect(rent).toHaveCount(1)

    await page.getByRole('button', { name: 'Menu for Rent' }).click()
    await page.getByRole('menuitem', { name: 'Edit…' }).click()
    await expect(dlg.getByRole('heading', { name: 'Edit schedule' })).toBeVisible()
    await expect(dlg.getByText('A changed amount, source or rhythm counts from November 2026 on: earlier months keep what they had.')).toBeVisible()
    await dlg.getByLabel('Amount (EUR)').fill('1700')
    await page.screenshot({ path: 'e2e/output/schedule-edit.png' })
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()

    // the months before November keep their own entry, which can only be edited or deleted
    await expect(rent).toHaveCount(2)
    const before = rent.filter({ hasText: '(ended Oct 2026)' })
    await expect(before).toContainText('€1,650.00')
    await expect(rent.filter({ hasNotText: '(ended' })).toContainText('€1,700.00')
    await before.getByRole('button', { name: 'Menu for Rent' }).click()
    await expect(page.getByRole('menuitem')).toHaveText(['Edit…', 'Delete…'])
    await page.keyboard.press('Escape')

    // the Grid shows it: October as it was, November and later with the new amount
    await page.getByRole('link', { name: 'Grid' }).click()
    await page.getByRole('button', { name: 'Earlier months (2)' }).click()
    await expect(page.getByRole('button', { name: /^The flat – Rent Oct 2026/ })).toContainText('1,650')
    await expect(page.getByRole('button', { name: /^The flat – Rent Nov 2026/ })).toContainText('1,700')
    await expect(page.getByRole('button', { name: /^The flat – Rent Dec 2026/ })).toContainText('1,700')

    // one undo takes the change and its months back
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect(page.getByRole('button', { name: /^The flat – Rent Nov 2026/ })).toContainText('1,650')
  })

  test('a schedule that has ended says where its amount is changed, and "Reactivate" runs it from the current month', async ({ page }) => {
    await page.goto('?demo=1&screen=grid')
    await page.getByRole('button', { name: 'Load the demo household' }).click()
    await expect(page.getByRole('button', { name: /^The flat – Rent Nov 2026/ })).toBeVisible()
    await page.getByRole('link', { name: 'Household' }).click()
    const dlg = page.getByRole('dialog')

    // the list is on November; walk it back to September and end "Streaming" there
    await page.getByRole('button', { name: 'Previous month' }).click()
    await page.getByRole('button', { name: 'Previous month' }).click()
    await page.getByRole('button', { name: 'Menu for Streaming' }).click()
    await page.getByRole('menuitem', { name: 'End after Sept 2026' }).click()
    await saveAnyway(page)
    // back in November the list shows it as ended
    await page.getByRole('button', { name: 'Next month' }).click()
    await page.getByRole('button', { name: 'Next month' }).click()
    await expect(page.getByRole('cell', { name: /^Streaming\s*\(ended Sept 2026\)$/ })).toBeVisible()
    await page.getByRole('button', { name: 'Menu for Streaming' }).click()
    await page.getByRole('menuitem', { name: 'Edit…' }).click()
    await dlg.getByLabel('Amount (EUR)').fill('20')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg.getByRole('alert')).toHaveText('"Streaming" ended in Sept 2026, and a change made here counts from Nov 2026 on. Change the amount of a month that is over in that month, or give the schedule a later last month to run it again.')
    await dlg.getByRole('button', { name: 'Cancel' }).click()

    await page.getByRole('button', { name: 'Menu for Streaming' }).click()
    await page.getByRole('menuitem', { name: 'Reactivate' }).click()
    await page.getByRole('link', { name: 'Grid' }).click()
    await page.getByRole('button', { name: 'Earlier months (2)' }).click()
    // October is over and stays empty; November has it again
    await expect(page.getByRole('button', { name: /^Subscriptions Oct 2026/ })).toHaveAccessibleName('Subscriptions Oct 2026: empty')
    await expect(page.getByRole('button', { name: /^Subscriptions Nov 2026/ })).toContainText('18')
  })

  // Finding F12: the form read its amount in the household's currency, so 25000 typed for a row in Icelandic
  // krónur, which have no cents, landed as 2,500,000 kr.
  test('a schedule for a row in a currency without cents is read and shown in that currency', async ({ page }) => {
    // no rate service in a test: the króna simply has no rate here
    await page.route('https://api.frankfurter.dev/**', (r) => r.abort())
    await page.goto('?demo=1&screen=grid')
    await page.getByRole('button', { name: 'Load the demo household' }).click()
    await expect(page.getByRole('button', { name: /^The flat – Rent Nov 2026/ })).toBeVisible()
    const dlg = page.getByRole('dialog')
    await page.getByRole('button', { name: 'Row menu for Other income' }).click()
    await page.getByRole('menuitem', { name: 'Currency…' }).click()
    await dlg.getByLabel('Amounts in this row are in', { exact: true }).selectOption('ISK')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()

    await page.getByRole('link', { name: 'Household' }).click()
    await page.getByRole('button', { name: 'Add schedule' }).click()
    await dlg.getByLabel('Name', { exact: true }).fill('Cabin rent')
    // the amount is the row's: the field names the currency of the row that is chosen
    await dlg.getByLabel('Grid row').selectOption({ label: 'Other income' })
    await dlg.getByLabel('Amount (ISK)').fill('25000')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    const schedules = page.getByRole('table').filter({ has: page.getByRole('columnheader', { name: 'When' }) })
    await expect(schedules.getByRole('row').filter({ has: page.getByRole('cell', { name: /^Cabin rent/ }) })).toContainText(/ISK\s25,000/)

    // opened again, the form shows what was typed
    await page.getByRole('button', { name: 'Menu for Cabin rent' }).click()
    await page.getByRole('menuitem', { name: 'Edit…' }).click()
    await expect(dlg.getByLabel('Amount (ISK)')).toHaveValue('25000')
    await dlg.getByRole('button', { name: 'Cancel' }).click()

    // the row had 150.00 in November: moved to krónur it kept its digits (150, finding F13), and the schedule lands beside it
    await page.getByRole('link', { name: 'Grid' }).click()
    await expect(page.getByRole('button', { name: /^Other income Nov 2026/ })).toContainText(/ISK\s25,150/)
  })
})
