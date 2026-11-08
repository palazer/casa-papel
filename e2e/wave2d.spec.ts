import { expect, test } from '@playwright/test'

test.use({ viewport: { width: 1400, height: 900 } })

async function loadDemo(page: import('@playwright/test').Page) {
  await page.goto('?demo=1')
  await page.getByRole('button', { name: 'Load the demo household' }).click()
  await expect(page.getByRole('button', { name: /^Rent Nov 2026/ })).toBeVisible()
}

test('the welcome screen offers three ways to start, and the wizard can go back to it', async ({ page }) => {
  await page.goto('/')
  for (const name of ['Start on this device', 'Sign in', 'I have an invite', 'Look at the demo first', 'Import a file']) {
    await expect(page.getByRole('button', { name, exact: true })).toBeVisible()
  }
  await expect(page.getByText('Welcome to Casa Papel')).toBeVisible()
  await page.screenshot({ path: 'e2e/output/welcome.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: 'e2e/output/welcome-phone.png', fullPage: true })
  await page.setViewportSize({ width: 1400, height: 900 })
  await page.getByRole('button', { name: 'Start on this device' }).click()
  await expect(page.getByLabel('Household name')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sign in' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Back to start' }).click()
  await expect(page.getByRole('button', { name: 'Start on this device' })).toBeVisible()
  // the sandbox leads with the demo
  await page.goto('?demo=1')
  await expect(page.getByRole('button', { name: 'Load the demo household' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Leave the demo' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sign in' })).toHaveCount(0)
})

test('the plan ends in a December and "Add <year>" appends a calendar year on every screen', async ({ page }) => {
  await loadDemo(page)
  // November: next year is already planned, so the button offers the year after
  await expect(page.getByText(/Sept? 2026 – Dec 2027/)).toBeVisible()
  await page.getByRole('button', { name: 'Add 2028' }).click()
  await expect(page.getByText(/– Dec 2028/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Dec 2028', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Add 2029' })).toBeVisible()

  // the Month view shares the range: at its last month Next gives way to the same action
  await page.getByRole('navigation', { name: 'Screens' }).getByRole('link', { name: 'Month' }).click()
  const next = page.getByRole('button', { name: 'Next month' })
  const add = page.getByRole('button', { name: 'Add 2029' })
  for (let i = 0; i < 40 && !(await add.isVisible()); i++) await next.click()
  await expect(add).toBeVisible()
  await expect(page.getByRole('heading', { name: 'December 2028' })).toBeVisible()
})

test('a pool account below zero is shown in the expense hue', async ({ page }) => {
  await loadDemo(page)
  const travel = page.getByRole('row', { name: /^Pool account · Travel/ })
  await expect(travel).toBeVisible()
  await expect(travel.locator('td.text-expense').first()).toBeVisible()
  await expect(travel.locator('td.text-expense').first()).toHaveText(/^-€/)
})
