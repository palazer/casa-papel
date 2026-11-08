import { expect, test, type Page } from '@playwright/test'

async function loadDemo(page: Page) {
  await page.goto('?demo=1')
  await page.getByRole('button', { name: 'Load the demo household' }).click()
  await expect(page.getByRole('button', { name: /^Rent Nov 2026/ })).toBeVisible()
}

const money = (text: string) => Number(text.replace(/[^\d.-]/g, ''))

test.describe('row sources, accounts and followers', () => {
  test.use({ viewport: { width: 1400, height: 900 } })

  test('a single amount can come out of a pool account', async ({ page }) => {
    await loadDemo(page)
    const headers = await page.getByRole('columnheader').allInnerTexts()
    const novIdx = headers.findIndex((h) => h.startsWith('Nov 2026')) - 1
    const travel = page.getByRole('row', { name: /^Pool account · Travel/ })
    const before = money(await travel.getByRole('cell').nth(novIdx).innerText())

    const groceries = page.getByRole('button', { name: /^Groceries Nov 2026/ })
    await groceries.click()
    const dlg = page.getByRole('dialog')
    await expect(dlg.getByLabel('Comes out of', { exact: true })).toHaveValue('cash')
    await dlg.getByLabel('Comes out of', { exact: true }).selectOption({ label: 'Pool account: Travel' })
    await page.screenshot({ path: 'e2e/output/cell-source.png' })
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()

    // the pool went down by the groceries amount, and the cell reopens as a single amount from the pool
    await expect.poll(async () => money(await travel.getByRole('cell').nth(novIdx).innerText())).toBe(before - 700)
    await groceries.click()
    await expect(dlg.getByRole('tab', { name: 'Single amount' })).toHaveAttribute('aria-selected', 'true')
    await expect(dlg.getByLabel('Comes out of', { exact: true })).toHaveValue(/^pool:/)
    await page.keyboard.press('Escape')
    await expect(dlg).toBeHidden()
  })

  test('the row menu changes where a row comes out of', async ({ page }) => {
    await loadDemo(page)
    await page.getByRole('button', { name: 'Row menu for Public transport' }).click()
    await page.getByRole('menuitem', { name: 'Comes out of…' }).click()
    const dlg = page.getByRole('dialog')
    await expect(dlg.getByRole('heading', { name: 'Comes out of' })).toBeVisible()
    await dlg.getByLabel('Single amounts in this row come out of').selectOption('savings')
    await expect(dlg.getByText(/Earlier months stay as they are/)).toBeVisible()
    await dlg.getByRole('radio', { name: 'All months, past included' }).click()
    await expect(dlg.getByText(/Earlier months change too/)).toBeVisible()
    await page.screenshot({ path: 'e2e/output/row-source.png' })
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()

    await page.getByRole('button', { name: /^Public transport Nov 2026/ }).click()
    await expect(dlg.getByLabel('Comes out of', { exact: true })).toHaveValue('savings')
    await expect(dlg.getByRole('option', { name: 'Savings balance (row default)' })).toHaveCount(1)
    await page.keyboard.press('Escape')
  })

  test('a transfer row can follow the child benefit, and stop again', async ({ page }) => {
    await loadDemo(page)
    const menu = page.getByRole('button', { name: 'Row menu for To investments' })
    await menu.click()
    await page.getByRole('menuitem', { name: 'Follow another row…' }).click()
    const dlg = page.getByRole('dialog')
    await dlg.getByLabel('Same amount as').selectOption({ label: 'Child benefit' })
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()

    // the row is now read-only and mirrors the benefit
    await expect(page.getByRole('button', { name: /^To investments Nov 2026/ })).toHaveCount(0)
    const row = page.getByRole('row', { name: /^To investments/ })
    await expect(row).toContainText('= Child benefit')
    await expect(row).toContainText('255')
    await page.screenshot({ path: 'e2e/output/row-follows.png' })

    await menu.click()
    await page.getByRole('menuitem', { name: 'Follows Child benefit…' }).click()
    await dlg.getByLabel('Same amount as').selectOption('')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    await expect(page.getByRole('button', { name: /^To investments Nov 2026/ })).toContainText('500')
  })

  test('the account dialog offers only accounts of the right kind', async ({ page }) => {
    await loadDemo(page)
    await page.getByRole('button', { name: 'Row menu for To investments' }).click()
    await page.getByRole('menuitem', { name: 'Goes into…' }).click()
    const dlg = page.getByRole('dialog')
    const select = dlg.getByLabel('Goes into')
    await expect(select.getByRole('option')).toHaveCount(1)
    await expect(select.getByRole('option', { name: 'Index fund' })).toHaveCount(1)
    await expect(dlg.getByText(/deposits go to/)).toBeVisible()
    await dlg.getByRole('button', { name: 'Cancel' }).click()
    await expect(dlg).toBeHidden()

    await page.getByRole('button', { name: 'Row menu for Groceries' }).click()
    await page.getByRole('menuitem', { name: 'Paid from…' }).click()
    await expect(dlg.getByLabel('Paid from')).toHaveValue(/./)
    await expect(dlg.getByLabel('Paid from').getByRole('option')).toHaveCount(6)
    await dlg.getByRole('button', { name: 'Cancel' }).click()
  })
})
