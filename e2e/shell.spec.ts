import { expect, test } from '@playwright/test'

/** The app shell (DESIGN.md §2): the rail on desktop, the bottom tabs on phones, the page header's toolbar. */
test.describe('shell', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('rail switches screens, the address follows and a reload keeps the screen', async ({ page }) => {
    await page.goto('?demo=1')
    await page.getByRole('button', { name: 'Load the demo household' }).click()
    const rail = page.getByRole('navigation', { name: 'Screens' })
    await expect(rail).toBeVisible()
    await expect(rail.getByRole('link', { name: 'Grid' })).toHaveAttribute('aria-current', 'page')
    await expect(page.getByRole('heading', { level: 1, name: 'Grid' })).toBeVisible()
    await page.screenshot({ path: 'e2e/output/shell-grid.png' })

    await rail.getByRole('link', { name: 'Household' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Household' })).toBeVisible()
    await expect(rail.getByRole('link', { name: 'Household' })).toHaveAttribute('aria-current', 'page')
    expect(new URL(page.url()).searchParams.get('screen')).toBe('household')
    expect(new URL(page.url()).searchParams.get('demo')).toBe('1')
    await page.screenshot({ path: 'e2e/output/shell-household.png', fullPage: true })

    await page.reload()
    await expect(page.getByRole('heading', { level: 1, name: 'Household' })).toBeVisible()

    await rail.getByRole('link', { name: 'Moves' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Moves' })).toBeVisible()
    await page.screenshot({ path: 'e2e/output/shell-moves.png', fullPage: true })
  })

  test('undo and redo live in the page header toolbar', async ({ page }) => {
    await page.goto('?demo=1')
    await page.getByRole('button', { name: 'Load the demo household' }).click()
    await page.getByRole('button', { name: /^Groceries Nov 2026/ }).click()
    const dlg = page.getByRole('dialog')
    await dlg.getByLabel('Amount').fill('650')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    await expect(page.getByRole('button', { name: /^Groceries Nov 2026: -€650\.00/ })).toBeVisible()
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect(page.getByRole('button', { name: /^Groceries Nov 2026: -€700\.00/ })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Redo' })).toBeEnabled()
  })
})

test.describe('shell on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

  test('bottom tabs replace the rail and the month opens first', async ({ page }) => {
    await page.goto('?demo=1')
    await page.getByRole('button', { name: 'Load the demo household' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Month' })).toBeVisible()
    const tabs = page.getByRole('navigation', { name: 'Screens' })
    await expect(tabs).toHaveCount(1)
    await expect(tabs.getByRole('link', { name: 'Month' })).toHaveAttribute('aria-current', 'page')
    const box = await tabs.boundingBox()
    expect(box && box.y + box.height).toBeGreaterThan(800)
    await page.screenshot({ path: 'e2e/output/shell-month-phone.png', fullPage: true })

    await tabs.getByRole('link', { name: 'Data' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Data' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Where your data lives' })).toBeVisible()
  })
})
