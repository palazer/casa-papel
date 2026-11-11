import { expect, test } from '@playwright/test'

/** The help system (DESIGN.md §8): (i) icons that open on hover or tap, and the legend behind one toolbar button. */
test.describe('help', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('an (i) opens on hover and closes when the mouse leaves; the legend explains the marks', async ({ page }) => {
    await page.goto('?demo=1&screen=grid')
    await page.getByRole('button', { name: 'Load the demo household' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Grid' })).toBeVisible()

    await page.getByRole('button', { name: 'About Income total' }).hover()
    const tip = page.getByRole('dialog').getByText(/All income rows of the month added up/)
    await expect(tip).toBeVisible()
    await page.screenshot({ path: 'e2e/output/help-tip.png' })
    await page.mouse.move(5, 5)
    await expect(tip).toBeHidden()

    // a section title and an automatic row carry one too
    await expect(page.getByRole('button', { name: 'About Expenses', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'About To savings', exact: true })).toBeVisible()

    await page.getByRole('button', { name: 'What the colours and marks mean' }).click()
    const legend = page.getByRole('dialog')
    await expect(legend.getByText('Kinds of money')).toBeVisible()
    await expect(legend.getByText('Virtual accounts', { exact: true })).toBeVisible()
    await expect(legend.getByText('Done: the money has moved')).toBeVisible()
    await page.waitForTimeout(250) // let the fade-in finish so the screenshot shows the popover opaque
    await page.screenshot({ path: 'e2e/output/help-legend.png' })
    await page.keyboard.press('Escape')
    await expect(legend).toBeHidden()
  })
})

test.describe('help on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

  test('a tap opens the (i) on the Statement and the legend is there too', async ({ page }) => {
    await page.goto('?demo=1')
    await page.getByRole('button', { name: 'Load the demo household' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Statement' })).toBeVisible()

    await page.getByRole('button', { name: 'About Progress' }).tap()
    await expect(page.getByRole('dialog').getByText(/Every line with an amount counts once/)).toBeVisible()
    await page.waitForTimeout(250)
    await page.screenshot({ path: 'e2e/output/help-phone.png' })
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'About The month' }).tap()
    await expect(page.getByRole('dialog').getByText(/Money in on the left, money out on the right/)).toBeVisible()
    await page.keyboard.press('Escape')

    await page.getByRole('button', { name: 'What the colours and marks mean' }).tap()
    await expect(page.getByRole('dialog').getByText('Kinds of money')).toBeVisible()
  })
})
