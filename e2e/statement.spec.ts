import { expect, test, type Page } from '@playwright/test'

async function openStatement(page: Page) {
  await page.goto('?demo=1')
  await page.getByRole('button', { name: 'Load the demo household' }).click()
  await page.getByRole('navigation', { name: 'Screens' }).getByRole('link', { name: 'Statement' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Statement' })).toBeVisible()
}

/** The demo household starts in September 2026: walk back to it, then forward to the month wanted. */
async function goToMonth(page: Page, name: string) {
  const prev = page.getByRole('button', { name: 'Previous month' })
  while (await prev.isEnabled()) await prev.click()
  await expect(page.getByRole('heading', { level: 2, name: 'September 2026' })).toBeVisible()
  for (let i = 0; i < 24 && !(await page.getByRole('heading', { level: 2, name }).isVisible()); i++) await page.getByRole('button', { name: 'Next month' }).click()
  await expect(page.getByRole('heading', { level: 2, name })).toBeVisible()
}

const total = (page: Page, side: 'in' | 'out' | 'assets' | 'claims') => page.getByTestId(`total-${side}`)

test.describe('the Statement', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('a closed month: both halves balance, categories open to rows and items', async ({ page }) => {
    await openStatement(page)
    await expect(page.getByRole('navigation', { name: 'Screens' }).getByRole('link', { name: 'Statement' })).toHaveAttribute('aria-current', 'page')
    await goToMonth(page, 'September 2026')
    await expect(page.getByText('closed', { exact: true })).toBeVisible()

    // the month: money in equals money out
    await expect(total(page, 'in')).toHaveText('Total in€7,255.00')
    await expect(total(page, 'out')).toHaveText('Total out€7,255.00')
    const moneyOut = page.getByRole('region', { name: 'Money out' })
    await expect(moneyOut.locator('[data-line="expenses"]')).toContainText('€4,357.00')
    await expect(moneyOut.locator('[data-line="rowless"]')).toHaveCount(0)

    // the position: assets equal debts and net worth, in balances and in the month's change
    const assets = (await total(page, 'assets').innerText()).replace(/^Total\s*/, '')
    const claims = (await total(page, 'claims').innerText()).replace(/^Total\s*/, '')
    expect(assets).toBe(claims)
    await expect(total(page, 'assets')).toContainText('€23,060.00')
    const position = page.getByRole('region', { name: 'Debts and net worth' })
    await expect(position.locator('[data-line="net-worth"]')).toContainText('€23,018.00')
    await expect(position.locator('[data-line="free"]')).toContainText('€21,968.00')
    // pool accounts sit under the savings account that holds them
    const assetsSide = page.getByRole('region', { name: 'Assets' })
    await expect(assetsSide.getByText('Travel', { exact: true })).toBeVisible()
    await expect(assetsSide.getByText('Not set aside')).toBeVisible()
    // the demo has a main and a joint account: one line for what stays in them
    await expect(assetsSide.getByText('Current accounts')).toBeVisible()

    // a category opens to its rows, an itemized row to its items
    await expect(moneyOut.getByText('Sam – Personal')).toHaveCount(0)
    await moneyOut.getByRole('button', { name: 'Personal', exact: true }).click()
    await expect(moneyOut.getByText('Sam – Personal')).toBeVisible()
    await expect(moneyOut.getByText('Concert tickets')).toHaveCount(0)
    await moneyOut.getByRole('button', { name: 'Sam – Personal' }).click()
    await expect(moneyOut.getByText('Concert tickets')).toBeVisible()
    await expect(moneyOut.getByText('Books')).toBeVisible()
    await page.screenshot({ path: 'e2e/output/statement-closed.png', fullPage: true })

    // "Open all" and "Close all"
    await page.getByRole('button', { name: 'Open all' }).click()
    await expect(moneyOut.getByText('The flat – Rent')).toBeVisible()
    await page.getByRole('button', { name: 'Close all' }).click()
    await expect(moneyOut.getByText('The flat – Rent')).toHaveCount(0)
    await expect(assetsSide.getByText('Not set aside')).toHaveCount(0)
  })

  test('spending from a pool account shows on both sides', async ({ page }) => {
    await openStatement(page)
    await goToMonth(page, 'October 2026')
    const moneyIn = page.getByRole('region', { name: 'Money in' })
    await expect(moneyIn.locator('[data-line="sources"]')).toContainText('From savings and pool accounts')
    await expect(moneyIn.locator('[data-line="sources"]')).toContainText('€480.00')
    const totalIn = (await total(page, 'in').innerText()).replace(/^Total in\s*/, '')
    const totalOut = (await total(page, 'out').innerText()).replace(/^Total out\s*/, '')
    expect(totalIn).toBe(totalOut)
    await page.screenshot({ path: 'e2e/output/statement.png', fullPage: true })
  })
})

test.describe('the Statement on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

  test('the two sides stack, each with its own total', async ({ page }) => {
    await openStatement(page)
    await goToMonth(page, 'September 2026')
    const inBox = await total(page, 'in').boundingBox()
    const outBox = await total(page, 'out').boundingBox()
    expect(inBox && outBox && outBox.y > inBox.y + inBox.height).toBeTruthy()
    await expect(total(page, 'in')).toContainText('€7,255.00')
    await expect(total(page, 'out')).toContainText('€7,255.00')
    await page.screenshot({ path: 'e2e/output/statement-phone.png', fullPage: true })
  })
})
