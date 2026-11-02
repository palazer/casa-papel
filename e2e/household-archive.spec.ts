import { expect, test } from '@playwright/test'

test.describe('archiving people and things', () => {
  test.use({ viewport: { width: 1400, height: 900 } })

  test('archive asks first, archived entries can be restored', async ({ page }) => {
    await page.goto('?demo=1')
    await page.getByRole('button', { name: 'Load the demo household' }).click()
    await expect(page.getByRole('button', { name: /^Rent Nov 2026/ })).toBeVisible()
    await page.getByRole('button', { name: 'Household' }).click()

    const robin = page.getByRole('listitem').filter({ hasText: 'Robin' }).first()
    await robin.getByRole('button', { name: 'Archive', exact: true }).click()
    await expect(robin.getByText('Archiving hides Robin')).toBeVisible()
    await robin.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByText('Archived', { exact: true })).toHaveCount(0)

    await robin.getByRole('button', { name: 'Archive', exact: true }).click()
    await robin.getByRole('button', { name: 'Really archive' }).click()
    await expect(page.getByText('Archived', { exact: true })).toBeVisible()
    const archivedRobin = page.getByRole('listitem').filter({ hasText: 'Robin' }).filter({ hasText: 'since' })
    await expect(archivedRobin).toBeVisible()
    await expect(page.getByLabel('Who pays for Robin')).toHaveCount(0)

    await archivedRobin.getByRole('button', { name: 'Restore' }).click()
    await expect(page.getByText('Archived', { exact: true })).toHaveCount(0)
    await expect(page.getByLabel('Who pays for Robin')).toBeVisible()
  })
})
