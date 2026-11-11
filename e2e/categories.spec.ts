import { expect, test, type Page } from '@playwright/test'

/** Categories: label lines and faint bands on the grid, a row's category from its menu, the card under Household. */
test.describe('categories', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  const rowNames = async (page: Page) => (await page.getByRole('rowheader').allInnerTexts()).map((t) => t.split('\n')[0].trim())
  const rowOf = (page: Page, name: string) => page.getByRole('row').filter({ has: page.getByRole('rowheader', { name: new RegExp(`^${name}`) }) })
  const background = (page: Page, name: string) => rowOf(page, name).evaluate((el) => getComputedStyle(el).backgroundColor)

  test('bands and labels on the grid, assign from the row menu, manage under Household', async ({ page }) => {
    await page.goto('?demo=1&screen=grid')
    await page.getByRole('button', { name: 'Load the demo household' }).click()
    await expect(page.getByRole('button', { name: /^The flat – Rent Nov 2026/ })).toBeVisible()

    // one label line per category, rows grouped under them; every other group carries the band
    const table = page.getByRole('table')
    for (const label of ['Housing', 'Living', 'Transport', 'Family & pets', 'Fun', 'Personal']) await expect(table.getByText(label, { exact: true })).toBeVisible()
    const names = await rowNames(page)
    expect(names.indexOf('The flat – Rent')).toBeLessThan(names.indexOf('Groceries'))
    expect(names.indexOf('Groceries')).toBeLessThan(names.indexOf('Public transport'))
    expect(await background(page, 'The flat – Rent')).toBe(await background(page, 'The flat – Utilities'))
    expect(await background(page, 'The flat – Rent')).not.toBe(await background(page, 'Groceries'))
    await page.screenshot({ path: 'e2e/output/categories-grid.png' })

    // the row menu moves Public transport into Living, at the end of that group
    await page.getByRole('button', { name: 'Row menu for Public transport' }).click()
    await page.getByRole('menuitem', { name: 'Category…' }).click()
    const dlg = page.getByRole('dialog')
    await dlg.getByLabel('Category', { exact: true }).selectOption({ label: 'Living' })
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    await expect.poll(async () => {
      const n = await rowNames(page)
      return n.indexOf('Public transport') > n.indexOf('Health') && n.indexOf('Public transport') < n.indexOf('The car – Insurance')
    }).toBe(true)

    // under Household: rename Fun, move Personal up, remove Transport (its rows stay, without a category)
    await page.getByRole('link', { name: 'Household' }).click()
    await expect(page.getByRole('heading', { name: 'Categories' })).toBeVisible()
    const fun = page.getByLabel('Name of the category Fun')
    await fun.fill('Leisure')
    await fun.press('Enter')
    await expect(page.getByLabel('Name of the category Leisure')).toBeVisible()
    await page.getByRole('button', { name: 'Move Personal up' }).click()
    await page.getByRole('button', { name: 'Remove Transport' }).click()
    await expect(dlg.getByRole('heading', { name: 'Category "Transport"' })).toBeVisible()
    // Public transport moved to Living above, so Transport holds one row now
    await expect(dlg.getByText('"The car – Insurance" keeps its place without a category')).toBeVisible()
    await dlg.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(dlg).toBeHidden()
    await expect(page.getByLabel('Name of the category Transport')).toHaveCount(0)
    await expect(page.getByLabel('Category for The car – Insurance')).toHaveValue('')
    await page.getByLabel('Category for The car – Insurance').selectOption({ label: 'Leisure' })
    await page.screenshot({ path: 'e2e/output/categories-card.png', fullPage: true })

    // the grid follows
    await page.getByRole('link', { name: 'Grid' }).click()
    await expect(table.getByText('Leisure', { exact: true })).toBeVisible()
    await expect(table.getByText('Transport', { exact: true })).toHaveCount(0)
    // Personal moved above Leisure, so its rows now come before the pool rows
    const after = await rowNames(page)
    expect(after.indexOf('Sam – Personal')).toBeLessThan(after.indexOf('Travel'))
    expect(after.indexOf('The car – Insurance')).toBeGreaterThan(after.indexOf('Sam – Personal'))
  })
})
