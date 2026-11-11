import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'

async function loadDemo(page: Page) {
  await page.goto('?demo=1&screen=grid')
  await expect(page.getByText('Welcome to Casa Papel')).toBeVisible()
  await page.getByRole('button', { name: 'Load the demo household' }).click()
  await expect(page.getByText(/^Demo household ·/)).toBeVisible()
  await expect(page.getByRole('button', { name: /^The flat – Rent Nov 2026/ })).toBeVisible()
}

test('demo → export → wipe → import → offline reload', async ({ page, context }) => {
  await loadDemo(page)

  await page.getByRole('link', { name: 'Data' }).click()
  await expect(page.getByText('Where your data lives')).toBeVisible()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export now' }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(/^casa-papel-demo-household-\d{4}-\d{2}-\d{2}\.json$/)
  const filePath = 'e2e/output/export.json'
  await download.saveAs(filePath)
  const exported = JSON.parse(readFileSync(filePath, 'utf8'))
  expect(exported.format).toBe('casa-papel')
  expect(exported.tables.rows.length).toBeGreaterThan(15)

  await page.getByLabel('Type WIPE to confirm').fill('WIPE')
  await page.getByRole('button', { name: 'Wipe this device' }).click()
  await expect(page.getByText('All data removed from this browser.')).toBeVisible()
  await page.getByRole('link', { name: 'Grid' }).click()
  await expect(page.getByText('Welcome to Casa Papel')).toBeVisible()

  await page.getByRole('link', { name: 'Data' }).click()
  await page.locator('input[type=file]').setInputFiles(filePath)
  await expect(page.getByText(/history entries$/)).toBeVisible()
  await page.getByRole('button', { name: 'Replace everything here' }).click()
  await expect(page.getByText(/Replaced everything with/)).toBeVisible()
  await page.getByRole('link', { name: 'Grid' }).click()
  await expect(page.getByRole('button', { name: /^The flat – Rent Nov 2026/ })).toBeVisible()

  await page.evaluate(() => navigator.serviceWorker.ready)
  await context.setOffline(true)
  await page.reload()
  await expect(page.getByRole('button', { name: /^The flat – Rent Nov 2026/ })).toBeVisible({ timeout: 15_000 })
  await context.setOffline(false)
})

test('the built page carries its content security policy and no screen trips it', async ({ page }) => {
  const violations: string[] = []
  page.on('console', (msg) => {
    if (/Content Security Policy/i.test(msg.text())) violations.push(msg.text())
  })
  await loadDemo(page)
  const policy = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content')
  expect(policy).toContain("script-src 'self'")
  expect(policy).toContain('https://api.frankfurter.dev')

  for (const screen of ['Statement', 'Household', 'Data', 'Guide', 'Grid']) {
    await page.getByRole('link', { name: screen, exact: true }).click()
    await expect(page.getByRole('heading', { level: 1, name: screen })).toBeVisible()
  }
  // a cell editor and a dropdown: the UI library's popups are where a runtime <style> or inline handler would show up
  await page.getByRole('button', { name: /^The flat – Rent Nov 2026/ }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  expect(violations).toEqual([])
})

test('real store and demo sandbox are separate databases', async ({ page }) => {
  await loadDemo(page)
  await page.goto('/')
  await expect(page.getByText('Welcome to Casa Papel')).toBeVisible()
})
