import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'

async function loadDemo(page: Page) {
  await page.goto('?demo=1')
  await expect(page.getByText('Welcome to Casa Papel')).toBeVisible()
  await page.getByRole('button', { name: 'Load the demo household' }).click()
  await expect(page.getByText('Demo household', { exact: true })).toBeVisible()
  await expect(page.getByText(/rows · .* filled cells/)).toBeVisible()
}

test('demo → export → wipe → import → offline reload', async ({ page, context }) => {
  await loadDemo(page)
  await page.screenshot({ path: 'e2e/output/home.png', fullPage: true })

  // export
  await page.getByRole('button', { name: 'Data' }).click()
  await expect(page.getByText('Where your data lives')).toBeVisible()
  await page.screenshot({ path: 'e2e/output/data.png', fullPage: true })
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export now' }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(/^casa-papel-demo-household-\d{4}-\d{2}-\d{2}\.json$/)
  const filePath = 'e2e/output/export.json'
  await download.saveAs(filePath)
  const exported = JSON.parse(readFileSync(filePath, 'utf8'))
  expect(exported.format).toBe('casa-papel')
  expect(exported.tables.rows.length).toBeGreaterThan(15)
  await expect(page.getByText(/since last export: 0/)).toBeVisible()

  // wipe
  await page.getByLabel('Type WIPE to confirm').fill('WIPE')
  await page.getByRole('button', { name: 'Wipe this device' }).click()
  await expect(page.getByText('All data removed from this browser.')).toBeVisible()
  await page.getByRole('button', { name: 'Home' }).click()
  await expect(page.getByText('Welcome to Casa Papel')).toBeVisible()

  // import (replace)
  await page.getByRole('button', { name: 'Data' }).click()
  await page.locator('input[type=file]').setInputFiles(filePath)
  await expect(page.getByText(/history entries$/)).toBeVisible()
  await page.getByRole('button', { name: 'Replace everything here' }).click()
  await expect(page.getByText(/Replaced everything with/)).toBeVisible()
  await page.getByRole('button', { name: 'Home' }).click()
  await expect(page.getByText('Demo household', { exact: true })).toBeVisible()

  // offline: service worker must serve the app shell
  await page.evaluate(() => navigator.serviceWorker.ready)
  await context.setOffline(true)
  await page.reload()
  await expect(page.getByText('Demo household', { exact: true })).toBeVisible({ timeout: 15_000 })
  await context.setOffline(false)
})

test('real store and demo sandbox are separate databases', async ({ page }) => {
  await loadDemo(page)
  await page.goto('/')
  await expect(page.getByText('Welcome to Casa Papel')).toBeVisible()
})
