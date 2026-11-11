import { expect, test, type Page } from '@playwright/test'

async function loadDemo(page: Page) {
  await page.goto('?demo=1&screen=grid')
  await page.getByRole('button', { name: 'Load the demo household' }).click()
  await expect(page.getByRole('button', { name: /^The flat – Rent Nov 2026/ })).toBeVisible()
}

/** The Guide (DESIGN.md §2): a reading page under Settings with the topics, a search that filters them, and its entry points. */
test.describe('guide', () => {
  test.use({ viewport: { width: 1400, height: 900 } })

  test('reads, searches as you type and opens the screen a topic is about', async ({ page }) => {
    await loadDemo(page)
    const rail = page.getByRole('navigation', { name: 'Screens' })
    await rail.getByRole('link', { name: 'Guide' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Guide' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'What Casa Papel is' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Try the demo' })).toHaveCount(0) // hidden in the sandbox
    await expect(page.getByRole('link', { name: 'Open on GitHub' })).toHaveAttribute('href', /github\.com/)
    const contents = page.getByRole('navigation', { name: 'Topics' })
    await expect(contents.getByRole('link')).toHaveCount(16)
    // the Guide starts where the app does: the Statement first, then the Grid as the planning view
    await expect(contents.getByRole('link').nth(0)).toContainText('Start & the Statement')
    await expect(contents.getByRole('link').nth(1)).toContainText('The grid: planning ahead')
    await expect(page.getByText('It opens on the Statement, one month in accounting form', { exact: false })).toBeVisible()
    await expect(page.getByText(/Month view|\bMoves (shows|lists)\b/)).toHaveCount(0)
    await page.screenshot({ path: 'e2e/output/guide.png' })

    // the contents jump to a topic
    await contents.getByRole('link', { name: /^Pool accounts/ }).click()
    await expect(page.locator('#guide-pools')).toBeInViewport()
    await expect(page.locator('#guide-pools').getByRole('heading', { name: 'Pool accounts', exact: true })).toBeVisible()

    // search: every typed word must appear somewhere in a topic, including its (i) texts; matches are marked
    const search = page.getByLabel('Search the guide')
    const results = page.getByRole('navigation', { name: 'Results' })
    await search.fill('lisbon')
    await expect(page.getByRole('status')).toHaveText('1 topic matches "lisbon"')
    await expect(results.getByRole('link')).toHaveCount(1)
    await expect(results.getByRole('link').first()).toContainText('Pool accounts')
    await expect(results.locator('mark').first()).toHaveText('Lisbon')
    await expect(page.getByRole('heading', { name: 'Pool accounts', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Income', exact: true })).toHaveCount(0)
    await expect(contents).toHaveCount(0)
    await search.fill('honest')
    await expect(page.getByRole('status')).toHaveText('1 topic matches "honest"')
    await expect(page.getByRole('heading', { name: 'Debts & cards', exact: true })).toBeVisible()
    await search.fill('pool')
    await expect(page.getByRole('status')).toHaveText(/^\d+ topics match "pool"$/)
    // the best result first: the topic with "pool" in its title; a click on a result jumps to its topic
    await expect(results.getByRole('link').first()).toContainText('Pool accounts')
    await results.getByRole('link').last().click()
    const lastKey = await results.getByRole('link').last().getAttribute('href')
    await expect(page.locator(lastKey!)).toBeInViewport()
    await search.fill('xyzzy')
    await expect(page.getByRole('status')).toHaveText('Nothing matches "xyzzy". Try another word.')
    await search.press('Escape')
    await expect(search).toHaveValue('')
    await expect(page.getByRole('heading', { name: 'Income', exact: true })).toBeVisible()
    await expect(contents).toBeVisible()

    // a topic's button opens the screen it is about
    await page.locator('#guide-pools').getByRole('button', { name: 'Open Household' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Household' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Pool accounts', exact: true })).toBeVisible()
    await rail.getByRole('link', { name: 'Guide' }).click()
    await page.locator('#guide-statement').getByRole('button', { name: 'Open Statement' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Statement' })).toBeVisible()
  })

  test('the welcome screen and the legend lead into the Guide', async ({ page }) => {
    // without a household
    await page.goto('/')
    await page.getByRole('button', { name: 'How it works' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Guide' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Try the demo' })).toBeVisible()

    // from the legend to the Marks & keyboard topic; leaving the Guide drops the hash again
    await loadDemo(page)
    await page.getByRole('button', { name: 'What the colours and marks mean' }).click()
    await page.getByRole('button', { name: 'More in the Guide' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Guide' })).toBeVisible()
    expect(page.url()).toContain('#guide-marks')
    await expect(page.locator('#guide-marks')).toBeInViewport()
    await page.getByRole('navigation', { name: 'Screens' }).getByRole('link', { name: 'Grid' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Grid' })).toBeVisible()
    expect(page.url()).not.toContain('#guide-')
  })
})

test.describe('guide on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

  test('Settings opens Household, the tab row opens the Guide, the search field runs full width', async ({ page }) => {
    await page.goto('?demo=1')
    await page.getByRole('button', { name: 'Load the demo household' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Statement' })).toBeVisible()
    const tabs = page.getByRole('navigation', { name: 'Screens' })
    await tabs.getByRole('link', { name: 'Settings' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Household' })).toBeVisible()
    await page.getByRole('tablist', { name: 'Settings pages' }).getByRole('tab', { name: 'Guide' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Guide' })).toBeVisible()
    const search = page.getByLabel('Search the guide')
    const box = await search.boundingBox()
    expect(box && box.width).toBeGreaterThan(300)
    await search.fill('lisbon')
    await expect(page.getByRole('status')).toHaveText('1 topic matches "lisbon"')
    // the results list sits right under the field, on the first screen
    const results = page.getByRole('navigation', { name: 'Results' })
    const top = await results.boundingBox()
    expect(top && top.y).toBeLessThan(400)
    await expect(results.getByRole('link').first()).toContainText('Pool accounts')
    await page.screenshot({ path: 'e2e/output/guide-phone.png', fullPage: true })
  })
})
