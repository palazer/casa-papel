import { expect, test } from './test'

/** The app shell (DESIGN.md §2): the rail on desktop with its Settings group, the bottom tabs on phones, the page header's toolbar. */
test.describe('shell', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('rail switches screens, the address follows and a reload keeps the screen', async ({ page }) => {
    await page.goto('?demo=1')
    await page.getByRole('button', { name: 'Load the demo household' }).click()
    const rail = page.getByRole('navigation', { name: 'Screens' })
    await expect(rail).toBeVisible()
    // the Statement is the first screen; the rail holds it, the Grid and the Settings group
    await expect(rail.getByRole('link', { name: 'Statement' })).toHaveAttribute('aria-current', 'page')
    await expect(page.getByRole('heading', { level: 1, name: 'Statement' })).toBeVisible()
    await expect(page.getByRole('heading', { level: 2, name: 'November 2026' })).toBeVisible()
    await expect(rail.getByRole('link', { name: 'Month' })).toHaveCount(0)
    await expect(rail.getByRole('link', { name: 'Moves' })).toHaveCount(0)
    await page.screenshot({ path: 'e2e/output/shell-statement.png' })
    await rail.getByRole('link', { name: 'Grid' }).click()
    await expect(rail.getByRole('link', { name: 'Grid' })).toHaveAttribute('aria-current', 'page')
    await expect(page.getByRole('heading', { level: 1, name: 'Grid' })).toBeVisible()
    expect(new URL(page.url()).searchParams.get('screen')).toBe('grid')
    // Settings groups Household, Data and the Guide; it starts unfolded
    const settings = rail.getByRole('button', { name: 'Settings' })
    await expect(settings).toHaveAttribute('aria-expanded', 'true')
    await expect(rail.getByRole('group', { name: 'Settings' }).getByRole('link')).toHaveText(['Household', 'Data', 'Guide'])
    await page.screenshot({ path: 'e2e/output/shell-grid.png' })

    await rail.getByRole('link', { name: 'Household' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Household' })).toBeVisible()
    await expect(rail.getByRole('link', { name: 'Household' })).toHaveAttribute('aria-current', 'page')
    expect(new URL(page.url()).searchParams.get('screen')).toBe('household')
    expect(new URL(page.url()).searchParams.get('demo')).toBe('1')
    await page.screenshot({ path: 'e2e/output/shell-household.png', fullPage: true })

    await page.reload()
    await expect(page.getByRole('heading', { level: 1, name: 'Household' })).toBeVisible()

    // folded while a Settings page is open, the group's tile stands for it; unfolding brings the links back
    await settings.click()
    await expect(settings).toHaveAttribute('aria-expanded', 'false')
    await expect(rail.getByRole('link', { name: 'Household' })).toHaveCount(0)
    await expect(settings).toHaveAttribute('aria-current', 'page')
    await page.screenshot({ path: 'e2e/output/rail-settings.png' })
    await settings.click()
    await expect(rail.getByRole('link', { name: 'Household' })).toHaveAttribute('aria-current', 'page')

    await rail.getByRole('link', { name: 'Guide' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Guide' })).toBeVisible()
    await expect(page.getByText('What Casa Papel is')).toBeVisible()

    // a device that had the Month view or Moves open last, or a bookmark of one, opens the Statement
    await page.evaluate(() => window.localStorage.setItem('casa.screen', JSON.stringify('month')))
    await page.goto('?demo=1&screen=moves')
    await expect(page.getByRole('heading', { level: 1, name: 'Statement' })).toBeVisible()
    await expect(rail.getByRole('link', { name: 'Statement' })).toHaveAttribute('aria-current', 'page')
  })

  test('undo and redo live in the page header toolbar', async ({ page }) => {
    await page.goto('?demo=1&screen=grid')
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

  test('on the Statement the month, its controls and the count of the month stay at the top while the page scrolls', async ({ page }) => {
    await page.goto('?demo=1')
    await page.getByRole('button', { name: 'Load the demo household' }).click()
    const title = page.getByRole('heading', { level: 1, name: 'Statement' })
    const month = page.getByRole('heading', { level: 2, name: 'November 2026' })
    const bar = page.locator('[data-sticky-bar]')
    await expect(title).toBeVisible()
    await expect(month).toBeVisible()
    // nothing scrolled: the bar stands in its place under the name of the screen, without a line under it
    await expect(bar).toHaveAttribute('data-stuck', 'false')
    await expect(bar).toHaveCSS('box-shadow', 'none')
    await page.getByRole('button', { name: 'Expand all' }).click()

    // scrolled down: the name of the screen is gone; the month, its buttons and the line that counts the month are still there
    await page.evaluate(() => window.scrollTo(0, 500))
    await expect(bar).toHaveAttribute('data-stuck', 'true')
    await expect(title).not.toBeInViewport()
    await expect(month).toBeInViewport()
    await expect(page.getByRole('button', { name: 'Balances…' })).toBeInViewport()
    await expect(page.getByTestId('progress')).toBeInViewport()
    const box = (await bar.boundingBox())!
    expect(box.y).toBe(0)
    // it is on the page's ground from the rail to the window's edge, with a hairline under it: nothing shows through or beside it
    expect(box.x).toBe(72)
    expect(box.x + box.width).toBe(1440)
    await expect(bar).not.toHaveCSS('box-shadow', 'none')
    expect(await bar.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(await page.evaluate(() => getComputedStyle(document.body).backgroundColor))
    await page.screenshot({ path: 'e2e/output/statement-month-bar.png' })

    // the month is changed from there, and the page stays where it was
    await page.getByRole('button', { name: 'Next month' }).click()
    await expect(page.getByRole('heading', { level: 2, name: 'December 2026' })).toBeInViewport()
    await page.getByRole('button', { name: 'Previous month' }).click()
    await expect(month).toBeInViewport()

    // a line the page goes to stops below the bar, not under it
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    await page.getByRole('region', { name: 'Assets' }).getByRole('button', { name: /^Filled by To investments: go there/ }).click()
    const row = page.getByRole('region', { name: 'Money out' }).locator('[data-line]').filter({ hasText: 'To investments' }).first()
    await expect(row).toHaveAttribute('data-marked', 'true')
    await expect(async () => {
      const line = (await row.boundingBox())!
      const top = (await bar.boundingBox())!
      expect(line.y).toBeGreaterThanOrEqual(top.y + top.height)
      expect(line.y + line.height).toBeLessThanOrEqual(900)
    }).toPass()
  })
})

test.describe('shell on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

  test('bottom tabs replace the rail, the Statement opens first, Settings opens its pages through a tab row', async ({ page }) => {
    await page.goto('?demo=1')
    await page.getByRole('button', { name: 'Load the demo household' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Statement' })).toBeVisible()
    const tabs = page.getByRole('navigation', { name: 'Screens' })
    await expect(tabs).toHaveCount(1)
    await expect(tabs.getByRole('link')).toHaveText(['Statement', 'Grid', 'Settings'])
    await expect(tabs.getByRole('link', { name: 'Statement' })).toHaveAttribute('aria-current', 'page')
    const box = await tabs.boundingBox()
    expect(box && box.y + box.height).toBeGreaterThan(800)
    // the toolbar wraps and nothing runs off the side
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.screenshot({ path: 'e2e/output/shell-statement-phone.png' })

    await tabs.getByRole('link', { name: 'Settings' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Household' })).toBeVisible()
    await expect(tabs.getByRole('link', { name: 'Settings' })).toHaveAttribute('aria-current', 'page')
    const pages = page.getByRole('tablist', { name: 'Settings pages' })
    await expect(pages.getByRole('tab')).toHaveText(['Household', 'Data', 'Guide'])
    await pages.getByRole('tab', { name: 'Data' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Data' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Where your data lives' })).toBeVisible()
    // the Grid on a phone: the plan from this month on, in its own scroll box
    await tabs.getByRole('link', { name: 'Grid' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Grid' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Earlier months (2)' })).toBeVisible()
    await expect(page.getByRole('button', { name: /^The flat – Rent Nov 2026/ })).toBeVisible()
    await page.screenshot({ path: 'e2e/output/grid-phone.png' })
    // the group remembers the page open last
    await tabs.getByRole('link', { name: 'Statement' }).click()
    await tabs.getByRole('link', { name: 'Settings' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Data' })).toBeVisible()
    await page.screenshot({ path: 'e2e/output/shell-settings-phone.png', fullPage: true })
  })

  test('the Statement\'s toolbar scrolls away with the page: on a phone it takes three lines', async ({ page }) => {
    await page.goto('?demo=1')
    await page.getByRole('button', { name: 'Load the demo household' }).click()
    const month = page.getByRole('heading', { level: 2, name: 'November 2026' })
    await expect(month).toBeInViewport()
    await page.evaluate(() => window.scrollTo(0, 600))
    await expect(month).not.toBeInViewport()
    await expect(page.locator('[data-sticky-bar]')).toHaveAttribute('data-stuck', 'false')
  })
})
