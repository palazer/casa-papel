import { expect, test } from '@playwright/test'

test.describe('archiving people and things', () => {
  test.use({ viewport: { width: 1400, height: 900 } })

  test('the dialog explains, archives from a month, and archived entries can be restored', async ({ page }) => {
    await page.goto('?demo=1')
    await page.getByRole('button', { name: 'Load the demo household' }).click()
    await expect(page.getByRole('button', { name: /^Rent Nov 2026/ })).toBeVisible()
    await page.getByRole('link', { name: 'Household' }).click()
    const dlg = page.getByRole('dialog')

    // Robin's rows have amounts in the closed September: archive only
    const robin = page.getByRole('listitem').filter({ hasText: 'Robin' }).first()
    await robin.getByRole('button', { name: 'Archive or delete…' }).click()
    await expect(dlg.getByRole('heading', { name: 'Child "Robin"' })).toBeVisible()
    await expect(dlg.getByText('Hidden from People & things from Nov 2026; its rows and earlier months stay as they are')).toBeVisible()
    await expect(dlg.getByText(/"Robin" has amounts in closed months \(Sept 2026\)/)).toBeVisible()
    await expect(dlg.getByRole('button', { name: 'Delete', exact: true })).toHaveCount(0)
    await dlg.getByRole('button', { name: 'Cancel' }).click()
    await expect(dlg).toBeHidden()
    await expect(page.getByText('Archived', { exact: true })).toHaveCount(0)

    await robin.getByRole('button', { name: 'Archive or delete…' }).click()
    await dlg.getByRole('button', { name: 'Archive from Nov 2026' }).click()
    await expect(dlg).toBeHidden()
    await expect(page.getByText('Archived', { exact: true })).toBeVisible()
    const archivedRobin = page.getByRole('listitem').filter({ hasText: 'Robin' }).filter({ hasText: 'since Nov 2026' })
    await expect(archivedRobin).toBeVisible()
    await expect(page.getByLabel('Who pays for Robin')).toHaveCount(0)

    await archivedRobin.getByRole('button', { name: 'Restore' }).click()
    await expect(page.getByText('Archived', { exact: true })).toHaveCount(0)
    await expect(page.getByLabel('Who pays for Robin')).toBeVisible()

    // The car has nothing in a closed month: it can be deleted, and the dialog says what changes
    const car = page.getByRole('listitem').filter({ hasText: 'The car' }).first()
    await car.getByRole('button', { name: 'Archive or delete…' }).click()
    await expect(dlg.getByRole('heading', { name: 'Vehicle "The car"' })).toBeVisible()
    await expect(dlg.getByText('"Car insurance" loses its tag')).toBeVisible()
    await dlg.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(dlg).toBeHidden()
    await expect(page.getByRole('listitem').filter({ hasText: 'The car' })).toHaveCount(0)
  })
})
