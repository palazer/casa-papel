import { readFileSync, writeFileSync } from 'node:fs'
import { expect, saveAnyway, test, type Page } from './test'

/**
 * Rule B9: one main account. A file from before the rule, with the demo's main account, a joint account and a
 * current account in dollars, is brought in; the app puts it right and asks once which is the main account.
 */
async function olderFile(page: Page, path: string): Promise<void> {
  await page.goto('?demo=1&screen=grid')
  await page.getByRole('button', { name: 'Load the demo household' }).click()
  await expect(page.getByRole('button', { name: /^Main account Nov 2026:/ })).toBeVisible()
  await page.getByRole('link', { name: 'Data' }).click()
  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export now' }).click()
  const exported = 'e2e/output/main-account-export.json'
  await (await downloading).saveAs(exported)
  // the same household as the app before rule B9 wrote it: no mark, and two more current accounts
  const file = JSON.parse(readFileSync(exported, 'utf8'))
  file.schemaVersion = 19
  for (const h of file.tables.household) delete h.askMainAccount
  const main = file.tables.accounts.find((a: { type: string }) => a.type === 'checking')
  file.tables.accounts.push(
    { ...main, id: '0B9J0NT0000000000000000000', name: 'Joint account', type: 'joint', order: `${main.order}V`, openingBalance: 300_00 },
    { ...main, id: '0B9D000000000000000000000A', name: 'Dollar account', type: 'checking', currency: 'USD', order: `${main.order}W`, openingBalance: 0 },
  )
  writeFileSync(path, JSON.stringify(file))
}

async function bringIn(page: Page, path: string): Promise<void> {
  await page.locator('input[type=file]').setInputFiles(path)
  await page.getByRole('button', { name: 'Replace everything here' }).click()
}

test.describe('one main account', () => {
  test.use({ viewport: { width: 1400, height: 900 } })

  test('a file from before: the app asks once which is the main account, and the others keep a balance of their own', async ({ page }) => {
    const path = 'e2e/output/before-b9.json'
    await olderFile(page, path)
    await bringIn(page, path)

    const question = page.getByTestId('main-account-question')
    await expect(question.getByRole('heading', { name: 'Which is your main account?' })).toBeVisible()
    const choice = question.getByRole('radiogroup', { name: 'Main account' })
    // the two in euros are offered, the upgrade's pick is chosen, and the one in dollars is said apart
    await expect(choice.getByRole('radio')).toHaveText(['Main account', 'Joint account'])
    await expect(choice.getByRole('radio', { name: 'Main account' })).toHaveAttribute('aria-checked', 'true')
    await expect(question).toContainText('"Dollar account" is in USD: it keeps its own balance, and its worth moves with the rate.')
    await expect(question).toHaveCSS('opacity', '1')
    await page.screenshot({ path: 'e2e/output/main-account-question.png' })

    await choice.getByRole('radio', { name: 'Joint account' }).click()
    await question.getByRole('button', { name: 'Save' }).click()
    await expect(question).toBeHidden()

    // the Statement: the line is the chosen account, and the other two stand among the other assets
    await page.getByRole('link', { name: 'Statement' }).click()
    const assets = page.getByRole('region', { name: 'Assets' })
    const mainLine = assets.locator('[data-line="main"]')
    await expect(mainLine).toContainText('Joint account')
    await expect(mainLine).toContainText('main account')
    const other = (name: string) => assets.locator('[data-line^="acc:"]').filter({ hasText: name })
    await expect(assets.locator('[data-line="other-assets"]')).toBeVisible()
    await expect(other('Main account')).toContainText('current account')
    await expect(other('Dollar account')).toContainText('current account')
    await expect(assets.locator('[data-line^="cur:"]')).toHaveCount(0)
    await page.screenshot({ path: 'e2e/output/main-account-statement.png', fullPage: true })

    // asked once: not again after a reload
    await page.reload()
    await expect(mainLine).toContainText('Joint account')
    await expect(question).toHaveCount(0)

    // "Balances…": one field pair for the main account, the others with their own
    await page.getByRole('button', { name: 'Balances…' }).click()
    const balances = page.getByTestId('month-balances-dialog')
    await expect(balances.getByLabel('Joint account: at the end of November 2026 (EUR)')).toHaveAttribute('placeholder', /^€/)
    await expect(balances.getByLabel('Main account: at the end of November 2026 (EUR)')).toHaveAttribute('placeholder', '€0.00')
    await expect(balances.getByTestId('current-together')).toHaveCount(0)
    await balances.getByRole('button', { name: 'Cancel' }).click()

    // the account form offers no second main account; the main account itself has no currency to choose
    const dlg = page.getByRole('dialog')
    await assets.getByRole('button', { name: 'Add account' }).click()
    await expect(dlg.getByLabel('Type').locator('option')).toHaveText(['Other current account', 'Savings', 'Investments', 'Other asset', 'Cash'])
    await expect(dlg.getByTestId('acc-type-help')).toContainText('The main account is "Joint account".')
    await dlg.getByRole('button', { name: 'Cancel' }).click()
    await mainLine.getByRole('button', { name: 'Edit Joint account' }).click()
    await expect(dlg.getByLabel('Type')).toHaveValue('checking')
    await expect(dlg.getByTestId('acc-main-currency')).toContainText('the main account is always in the household\'s currency')
    await dlg.getByRole('button', { name: 'Cancel' }).click()

    // money moves into an other current account with a transfer row, and an expense can come out of it
    const moneyOut = page.getByRole('region', { name: 'Money out' })
    await moneyOut.getByRole('button', { name: 'Add transfer row' }).click()
    await moneyOut.getByLabel('What is it for?').selectOption('plain')
    // the other current accounts are offered; the main account, where the money comes from, is not
    const which = moneyOut.getByLabel('Which one')
    await expect(which.locator('option', { hasText: 'Main account' })).toHaveCount(1)
    await expect(which.locator('option', { hasText: 'Dollar account' })).toHaveCount(1)
    await expect(which.locator('option', { hasText: 'Joint account' })).toHaveCount(0)
    await moneyOut.getByLabel('Which one').selectOption({ label: 'Main account' })
    await moneyOut.getByRole('button', { name: 'Add', exact: true }).click()
    await dlg.getByLabel('Amount in EUR').fill('100')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    await expect(assets.getByRole('button', { name: 'Main account balance: €100.00' })).toBeVisible()
    await moneyOut.getByRole('button', { name: 'Living', exact: true }).click()
    await moneyOut.getByRole('button', { name: /^Health:/ }).click()
    await dlg.getByLabel('Comes out of', { exact: true }).selectOption({ label: 'Current account: Main account' })
    await dlg.getByRole('textbox', { name: /^Amount in EUR/ }).fill('40')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    await expect(assets.getByRole('button', { name: 'Main account balance: €60.00' })).toBeVisible()
  })

  test('keeping the upgrade\'s pick: the first current account stays the main account', async ({ page }) => {
    const path = 'e2e/output/before-b9-keep.json'
    await olderFile(page, path)
    await bringIn(page, path)
    const question = page.getByTestId('main-account-question')
    await question.getByRole('button', { name: 'Save' }).click()
    await expect(question).toBeHidden()
    await page.getByRole('link', { name: 'Statement' }).click()
    const assets = page.getByRole('region', { name: 'Assets' })
    await expect(assets.locator('[data-line="main"]')).toContainText('Main account')
    await expect(assets.locator('[data-line^="acc:"]').filter({ hasText: 'Joint account' })).toContainText('current account')
  })
})

test.describe('the main account in the account form', () => {
  test.use({ viewport: { width: 1400, height: 900 } })

  test('an account in dollars made the main account is refused with the reason, and keeps its dollars', async ({ page }) => {
    await page.goto('?demo=1&screen=grid')
    await page.getByRole('button', { name: 'Load the demo household' }).click()
    await expect(page.getByRole('button', { name: /^Main account Nov 2026:/ })).toBeVisible()
    await page.getByRole('link', { name: 'Statement' }).click()
    const assets = page.getByRole('region', { name: 'Assets' })
    const dlg = page.getByRole('dialog')
    // the demo's main account becomes an other current account: the household has no main account any more
    await assets.locator('[data-line="main"]').getByRole('button', { name: 'Edit Main account' }).click()
    await dlg.getByLabel('Type').selectOption('joint')
    await dlg.getByRole('button', { name: 'Save' }).click()
    // it has a balance of its own in the months that are over too: the question about the past asks first (rule T4)
    await saveAnyway(page)
    await expect(dlg).toBeHidden()
    // an account in dollars
    await assets.getByRole('button', { name: 'Add account' }).click()
    await expect(dlg.getByLabel('Type').locator('option', { hasText: /^Main account$/ })).toHaveCount(1)
    await dlg.getByLabel('Type').selectOption('joint')
    await dlg.getByLabel('Name', { exact: true }).fill('Dollar account')
    await dlg.getByRole('button', { name: /^More options/ }).click()
    await dlg.getByLabel('Currency').selectOption('USD')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    // made the main account: refused where it is asked, and nothing is saved
    await assets.getByRole('button', { name: 'Edit Dollar account' }).click()
    await dlg.getByLabel('Type').selectOption('checking')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg.getByRole('alert')).toHaveText('The main account is in the household\'s currency, EUR. An account in USD is an "Other current account".')
    await dlg.getByRole('button', { name: 'Cancel' }).click()
    await expect(assets.locator('[data-line^="acc:"]').filter({ hasText: 'Dollar account' })).toContainText('USD')
  })
})

test.describe('the main account question on a phone', () => {
  test.use({ viewport: { width: 1400, height: 900 } })

  test('fits the screen', async ({ page }) => {
    const path = 'e2e/output/before-b9-phone.json'
    await olderFile(page, path)
    await bringIn(page, path)
    await page.setViewportSize({ width: 390, height: 844 })
    const question = page.getByTestId('main-account-question')
    await expect(question.getByRole('heading', { name: 'Which is your main account?' })).toBeVisible()
    await expect(question).toHaveCSS('opacity', '1')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.screenshot({ path: 'e2e/output/main-account-question-phone.png' })
    await question.getByRole('button', { name: 'Save' }).click()
    await expect(question).toBeHidden()
  })
})
