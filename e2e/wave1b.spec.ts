import { expect, test, type Page } from '@playwright/test'

async function loadDemo(page: Page) {
  await page.goto('?demo=1')
  await page.getByRole('button', { name: 'Load the demo household' }).click()
  await expect(page.getByRole('button', { name: /^Rent Nov 2026/ })).toBeVisible()
}

test.describe('wave 1b', () => {
  test.use({ viewport: { width: 1400, height: 900 } })

  test('setup wizard creates a household with people, things, accounts and suggested rows', async ({ page }) => {
    await page.goto('/')
    await page.getByLabel('Household name').fill('Testers')
    await page.getByRole('button', { name: 'Next' }).click()
    await page.getByLabel('Adult 1 name').fill('Ana')
    await page.getByLabel('Adult 2 name').fill('Ben')
    await page.getByRole('button', { name: 'Add child' }).click()
    await page.getByLabel('Child name').fill('Cal')
    await page.getByLabel('Paid by').selectOption({ label: 'Paid by Ben' })
    await page.getByRole('button', { name: 'Next' }).click()
    await page.getByRole('button', { name: 'Add pet' }).click()
    await page.getByLabel('Name').fill('Rex')
    await page.getByRole('button', { name: 'Next' }).click()
    await page.getByLabel('Opening balance').nth(1).fill('5000')
    await page.getByRole('button', { name: 'Next' }).click()
    // rows: one subject at a time, grouped by money in / spending / moving money
    await expect(page.getByRole('heading', { name: 'Rows for the household' })).toBeVisible()
    await expect(page.getByRole('group', { name: /^Money in/ })).toBeVisible()
    await expect(page.getByRole('group', { name: /^Spending/ })).toBeVisible()
    await page.getByLabel('Your own row name').fill('Garden')
    await page.getByRole('button', { name: 'Add row' }).click()
    await page.screenshot({ path: 'e2e/output/wizard-rows.png', fullPage: true })
    // subject tabs jump straight to a person or thing; Next still walks them in order
    await page.getByRole('tab', { name: /^Rex/ }).click()
    await expect(page.getByRole('heading', { name: 'Rows for Rex' })).toBeVisible()
    await page.getByRole('tab', { name: /^Ana/ }).click()
    await expect(page.getByRole('heading', { name: 'Rows for Ana' })).toBeVisible()
    for (const who of ['Ben', 'Cal', 'Rex']) {
      await page.getByRole('button', { name: 'Next' }).click()
      await expect(page.getByRole('heading', { name: `Rows for ${who}` })).toBeVisible()
    }
    await page.getByRole('button', { name: 'Next' }).click()
    await expect(page.getByText('from November 2026')).toBeVisible()
    await page.getByRole('button', { name: 'Create household' }).click()
    await expect(page.getByRole('banner').getByText('Testers')).toBeVisible()
    await expect(page.getByText('Pocket – Ana', { exact: true })).toBeVisible()
    await expect(page.getByText('To savings', { exact: true })).toBeVisible()
    for (const name of ['Ana – Salary', 'Ben – Salary', 'Child benefit – Cal', 'Food & supplies – Rex', 'Groceries', 'Travel', 'Garden']) {
      await expect(page.getByRole('button', { name: new RegExp(`^${name} Nov 2026`) })).toBeVisible()
    }
    await page.getByRole('button', { name: 'Household' }).click()
    await expect(page.getByLabel('Who pays for Cal').locator('option:checked')).toHaveText('Paid by Ben')
    await page.getByRole('button', { name: 'Data' }).click()
    await page.getByLabel('Type WIPE to confirm').fill('WIPE')
    await page.getByRole('button', { name: 'Wipe this device' }).click()
  })

  test('recurring items post into due months only and can be ticked paid', async ({ page }) => {
    await loadDemo(page)
    // demo car insurance is quarterly from January: October yes, November no
    await expect(page.getByRole('button', { name: /^Car insurance Oct 2026/ })).toContainText('210')
    await expect(page.getByRole('button', { name: /^Car insurance Nov 2026: empty/ })).toBeVisible()

    await page.getByRole('button', { name: 'Household' }).click()
    await page.getByRole('button', { name: 'Add recurring' }).click()
    // an income row is paid into an account and has no funding source
    await page.getByLabel('Grid row').selectOption({ index: 0 })
    await expect(page.getByText('Paid into')).toBeVisible()
    await expect(page.getByRole('dialog').getByText('Comes out of')).toHaveCount(0)
    await page.getByRole('dialog').last().getByLabel('Name', { exact: true }).fill('Water bill')
    await page.getByLabel('Grid row').selectOption('__new__')
    await page.getByLabel('New row name').fill('Water')
    await page.getByLabel('Amount (EUR)').fill('90')
    await page.getByLabel('How often').selectOption('3')
    await page.getByLabel('Starting from which month of the year').selectOption({ label: 'Feb' })
    await page.getByLabel('From month: month').selectOption('11')
    await page.getByLabel('From month: year').selectOption('2026')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByRole('dialog')).toBeHidden()
    await expect(page.getByRole('cell', { name: 'Every 3 months (Feb, May, Aug, Nov)' })).toBeVisible()
    await page.screenshot({ path: 'e2e/output/register.png' })

    await page.getByRole('button', { name: 'Grid' }).click()
    await expect(page.getByRole('button', { name: /^Water Nov 2026/ })).toContainText('90')
    // a recurring item straight from a cell, prefilled with the row and its amount
    await page.getByRole('button', { name: /^Groceries Nov 2026/ }).click()
    await page.getByRole('button', { name: 'Make recurring…' }).click()
    await expect(page.getByLabel('Amount (EUR)')).toHaveValue('700')
    await page.getByRole('dialog').last().getByLabel('Name', { exact: true }).fill('Weekly shop')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByRole('dialog')).toBeHidden()
    await page.getByRole('button', { name: 'Household' }).click()
    await expect(page.getByRole('cell', { name: 'Weekly shop', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Grid' }).click()
    await expect(page.getByRole('button', { name: /^Water Dec 2026: empty/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /^Water Feb 2027/ })).toContainText('90')

    await page.getByRole('button', { name: 'Moves' }).click()
    await expect(page.getByText('Payments due')).toBeVisible()
    await page.getByLabel('Rent paid').click()
    await expect(page.getByLabel('Rent paid')).toBeChecked()
    await page.screenshot({ path: 'e2e/output/moves.png', fullPage: true })
    await page.getByRole('button', { name: 'Household' }).click()
    await expect(page.getByLabel('Rent paid in Nov 2026')).toBeChecked()
    await page.getByRole('button', { name: 'Grid' }).click()
    await expect(page.getByRole('button', { name: /^Rent Nov 2026/ }).locator('svg')).toBeVisible()
  })
})

test.describe('recurring from the grid', () => {
  test.use({ viewport: { width: 1400, height: 900 } })

  test('change for one month or from now on, skip a month, end a schedule', async ({ page }) => {
    await loadDemo(page)
    const rent = (m: string) => page.getByRole('button', { name: new RegExp(`^Rent ${m}`) })

    // amount change from November on: October keeps the old amount
    await rent('Nov 2026').click()
    await expect(page.getByText('Posted from a schedule')).toBeVisible()
    await page.getByLabel('Item amount').fill('1700')
    await page.getByRole('radio', { name: 'This and following months' }).click()
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByRole('dialog')).toBeHidden()
    await expect(rent('Oct 2026')).toContainText('1,650')
    await expect(rent('Nov 2026')).toContainText('1,700')
    await expect(rent('Dec 2026')).toContainText('1,700')
    await expect(rent('Mar 2027')).toContainText('1,700')

    // only this month on December (the default choice)
    await rent('Dec 2026').click()
    await page.getByLabel('Item amount').fill('1800')
    await expect(page.getByRole('radio', { name: 'Only this month' })).toHaveAttribute('aria-checked', 'true')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByRole('dialog')).toBeHidden()
    await expect(rent('Dec 2026')).toContainText('1,800')
    await expect(rent('Jan 2027')).toContainText('1,700')

    // skip January only
    await rent('Jan 2027').click()
    await page.getByRole('button', { name: 'Remove item' }).click()
    await page.getByRole('button', { name: 'Only this month' }).click()
    await expect(page.getByText('Skipped this month')).toBeVisible()
    await page.screenshot({ path: 'e2e/output/recurring-skip.png' })
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toBeHidden()
    await expect(page.getByRole('button', { name: /^Rent Jan 2027: empty/ })).toBeVisible()
    await expect(rent('Feb 2027')).toContainText('1,700')

    // end car insurance for good: due months empty out, nothing comes back
    await page.getByRole('button', { name: /^Car insurance Oct 2026/ }).click()
    await page.getByRole('button', { name: 'Remove item' }).click()
    await page.getByRole('button', { name: 'All occurrences' }).click()
    await expect(page.getByRole('dialog')).toBeHidden()
    await expect(page.getByRole('button', { name: /^Car insurance Oct 2026: empty/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /^Car insurance Jan 2027: empty/ })).toBeVisible()

    // the list under Household reflects it
    await page.getByRole('button', { name: 'Household' }).click()
    await expect(page.getByRole('cell', { name: 'Car insurance', exact: true })).toHaveCount(0)
    // the schedule was split: the old one ended in October, the new one runs from November
    await expect(page.getByText('(ended Oct 2026)')).toBeVisible()
    await expect(page.getByRole('cell', { name: 'Rent', exact: true })).toHaveCount(3)
  })
})
