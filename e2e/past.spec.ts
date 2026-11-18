import { expect, test, type Page } from './test'

/** The demo household starts in September 2026; on the test's day, 15 November 2026, September and October are over. */
async function loadDemo(page: Page) {
  await page.goto('?demo=1&screen=grid')
  await page.getByRole('button', { name: 'Load the demo household' }).click()
  await expect(page.getByRole('button', { name: /^The flat – Rent Nov 2026/ })).toBeVisible()
  await page.getByRole('button', { name: 'Earlier months (2)' }).click()
}

test.describe('the question before a change alters a month that is over (rule T4)', () => {
  test.use({ viewport: { width: 1400, height: 900 } })

  test('October asks first: Cancel goes back with what was typed, Escape too, Save anyway saves, and Undo takes it back', async ({ page }) => {
    await loadDemo(page)
    const utilOct = page.getByRole('button', { name: /^The flat – Utilities Oct 2026/ })
    const before = (await utilOct.textContent()) ?? ''
    await utilOct.click()
    const editor = page.getByRole('dialog').first()
    const question = page.getByTestId('past-question')
    await editor.getByLabel('Amount in EUR').fill('215')
    await editor.getByRole('radio', { name: 'Only this month' }).click()
    await editor.getByRole('button', { name: 'Save' }).click()

    // the question, over the dialog: the month, the amount, and where the money went
    await expect(question).toBeVisible()
    await expect(question.getByRole('heading', { name: 'This changes months that are over' })).toBeVisible()
    await expect(question).toContainText('Oct 2026 changes:')
    await expect(question.getByRole('list', { name: 'What changes' })).toContainText('"The flat – Utilities", Oct 2026:')
    await expect(question.getByRole('list', { name: 'What changes' })).toContainText('→ €215.00')
    await expect(question.locator('[data-slot="dialog-footer"]').getByRole('button')).toHaveText(['Cancel', 'Save anyway'])
    await expect(question).toHaveCSS('opacity', '1')
    await page.screenshot({ path: 'e2e/output/past-question.png' })

    // Cancel: back in the dialog, nothing saved, what was typed still there, and no error
    await question.getByRole('button', { name: 'Cancel' }).click()
    await expect(question).toBeHidden()
    await expect(editor).toBeVisible()
    await expect(editor.getByLabel('Amount in EUR')).toHaveValue('215')
    await expect(editor.getByRole('alert')).toHaveCount(0)

    // Escape closes the question alone, as Cancel does
    await editor.getByRole('button', { name: 'Save' }).click()
    await expect(question).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(question).toBeHidden()
    await expect(editor).toBeVisible()

    // Save anyway
    await editor.getByRole('button', { name: 'Save' }).click()
    await question.getByRole('button', { name: 'Save anyway' }).click()
    await expect(question).toBeHidden()
    await expect(editor).toBeHidden()
    await expect(utilOct).toContainText('215')

    // one Undo takes it back
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect(utilOct).toHaveText(before)
  })

  test('a change in the current month asks nothing', async ({ page }) => {
    await loadDemo(page)
    await page.getByRole('button', { name: /^The flat – Utilities Nov 2026/ }).click()
    const editor = page.getByRole('dialog')
    await editor.getByLabel('Amount in EUR').fill('230')
    await editor.getByRole('button', { name: 'Save' }).click()
    await expect(editor).toBeHidden()
    await expect(page.getByTestId('past-question')).toHaveCount(0)
    await expect(page.getByRole('button', { name: /^The flat – Utilities Nov 2026/ })).toContainText('230')
  })
})

test.describe('growth from a month on', () => {
  test.use({ viewport: { width: 1400, height: 900 } })

  test('a new growth for "Index fund" can count from November on: the form then names both rates', async ({ page }) => {
    await page.goto('?demo=1&screen=statement')
    await page.getByRole('button', { name: 'Load the demo household' }).click()
    const assets = page.getByRole('region', { name: 'Assets' })
    const fund = assets.getByRole('button', { name: /^Index fund balance:/ })
    const balance = (await fund.getAttribute('aria-label')) ?? ''
    const editor = page.getByRole('dialog').first()
    const question = page.getByTestId('past-question')
    await assets.getByRole('button', { name: 'Edit Index fund' }).click()
    await expect(editor.getByLabel('Growth per year (%)')).toHaveValue('5')
    await editor.getByLabel('Growth per year (%)').fill('8')
    await editor.getByRole('button', { name: 'Save' }).click()
    // October would end with more (September holds a real balance): the question offers the version that leaves it
    await expect(question).toContainText('Oct 2026 changes:')
    await expect(question).toContainText('"Index fund" at the end of Oct 2026:')
    await expect(question.locator('[data-slot="dialog-footer"]').getByRole('button')).toHaveText(['Cancel', 'Only from November 2026 on', 'Save anyway'])
    await question.getByRole('button', { name: 'Only from November 2026 on' }).click()
    await expect(editor).toBeHidden()
    // November grows at 8% now; October ends where it did
    await expect(fund).not.toHaveAccessibleName(balance)
    await assets.getByRole('button', { name: 'Edit Index fund' }).click()
    await expect(editor.getByLabel('Growth per year (%)')).toHaveValue('8')
    await expect(editor.getByTestId('growth-changes')).toHaveText('5% a year until October 2026, 8% from November 2026.')
  })
})

test.describe('the question on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('fits the screen over the dialog', async ({ page }) => {
    await page.goto('?demo=1&screen=statement')
    await page.getByRole('button', { name: 'Load the demo household' }).click()
    await page.getByRole('button', { name: 'Previous month' }).click()
    await expect(page.getByRole('heading', { level: 2, name: 'October 2026' })).toBeVisible()
    await page.getByRole('button', { name: 'Expand all' }).click()
    await page.getByRole('button', { name: /^Groceries: / }).click()
    const editor = page.getByRole('dialog').first()
    await editor.getByLabel('Amount in EUR').fill('640')
    await editor.getByRole('button', { name: 'Save' }).click()
    const question = page.getByTestId('past-question')
    await expect(question).toBeVisible()
    await expect(question).toBeInViewport({ ratio: 1 })
    await expect(question).toHaveCSS('opacity', '1')
    await page.screenshot({ path: 'e2e/output/past-question-phone.png' })
    await question.getByRole('button', { name: 'Cancel' }).click()
    await expect(question).toBeHidden()
  })
})
