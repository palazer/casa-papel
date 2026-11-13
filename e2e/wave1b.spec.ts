import { expect, test, type Locator, type Page } from '@playwright/test'

const WIDE = { width: 1440, height: 900 }
const PHONE = { width: 390, height: 844 }

async function loadDemo(page: Page) {
  await page.goto('?demo=1&screen=grid')
  await page.getByRole('button', { name: 'Load the demo household' }).click()
  await expect(page.getByRole('button', { name: /^The flat – Rent Nov 2026/ })).toBeVisible()
}

test.describe('wave 1b', () => {
  test.use({ viewport: { width: 1400, height: 900 } })

  test('a new household is set up on the Statement: the facts first, then the guide leads through six steps, each of which can be skipped', async ({ page }) => {
    // the page moves at once, so a screenshot never catches it on the way
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/')
    await page.getByRole('button', { name: 'Start on this device' }).click()

    // the first screen: the format, the first month, the people and things. Nothing about accounts or how money is shared
    await expect(page.getByRole('heading', { name: 'Set up your household' })).toBeVisible()
    await page.getByLabel('Household name').fill('Testers')
    await page.getByLabel('Adult 1 name').fill('Ana')
    await page.getByLabel('Adult 2 name').fill('ana')
    await expect(page.getByRole('alert')).toContainText('"Ana" is used more than once')
    await expect(page.getByRole('button', { name: 'Open the Statement' })).toBeDisabled()
    await page.getByLabel('Adult 2 name').fill('Ben')
    await page.getByRole('button', { name: 'Add child' }).click()
    await page.getByLabel('Child name').fill('Cal')
    await page.getByRole('button', { name: 'Add home' }).click()
    await page.getByLabel('Home name').fill('The flat')
    await expect(page.getByTestId('start-summary')).toHaveText('Makes Ana, Ben, Cal, The flat and the usual expense categories. Nothing else yet.')
    await expect(page.getByLabel('Month-end rule')).toHaveCount(0)
    await expect(page.getByLabel('How you share money')).toHaveCount(0)
    await page.screenshot({ path: 'e2e/output/setup-start.png', fullPage: true })
    await page.getByRole('button', { name: 'Open the Statement' }).click()

    // the Statement opens on the first month: empty, balanced, the guide on its first step with everything still to do
    await page.setViewportSize(WIDE)
    await expect(page.getByRole('heading', { level: 1, name: 'Statement' })).toBeVisible()
    await expect(page.getByRole('heading', { level: 2, name: 'November 2026' })).toBeVisible()
    const guide = page.getByTestId('setup-guide')
    const number = (n: number) => guide.locator('[data-step]').nth(n - 1)
    const title = guide.getByTestId('setup-title')
    const count = guide.getByTestId('setup-count')
    // a locked part is not there for anything that reads the page by its roles, so the parts are found by what they are
    const group = (name: string) => page.locator(`[data-testid="suggestions"][aria-label="Suggestions for ${name}"]`)
    const side = (key: string) => page.locator(`section[data-side="${key}"]`)
    const moneyIn = side('in')
    const moneyOut = side('out')
    const assets = side('assets')
    const claims = side('claims')
    const part = (id: string) => page.locator(`li:has(> [data-line="${id}"])`)
    // the row, not the group it is in: "To savings, investments and debts"
    const toSavings = moneyOut.locator('[data-line]').filter({ hasText: /^To Savings/ })
    const leftover = moneyOut.locator('[data-line]').filter({ hasText: 'Leftover' })
    const lockedParts = page.locator('section[data-side][inert], li[inert], [data-testid="per-person"][inert]')
    const dlg = page.getByRole('dialog')
    /** One step: the sides and the groups that are not part of it are locked, and nothing else in the two halves is. */
    async function expectLocked(sides: string[], groups: string[]) {
      await expect(page.locator('section[data-side][inert]')).toHaveCount(sides.length)
      for (const key of sides) await expect(side(key)).toHaveAttribute('inert', '')
      await expect(page.locator('li[inert]')).toHaveCount(groups.length)
      for (const id of groups) await expect(part(id)).toHaveAttribute('inert', '')
    }
    /** A control in a locked part takes no cursor and no press. */
    async function expectDead(control: Locator) {
      await control.focus()
      await expect(control).not.toBeFocused()
      const box = (await control.boundingBox())!
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
      await expect(dlg).toHaveCount(0)
    }
    /** After a step change the step's part is on the screen, under the guide and not behind it. */
    async function expectUnderGuide(lit: Locator) {
      await expect(guide).toBeInViewport()
      await expect(lit).toBeInViewport()
      await expect(async () => {
        const bar = (await guide.boundingBox())!
        expect((await lit.boundingBox())!.y).toBeGreaterThanOrEqual(bar.y + bar.height)
      }).toPass()
    }
    await expect(guide.locator('[data-step]')).toHaveCount(6)
    for (let n = 1; n <= 6; n++) await expect(number(n)).toHaveAttribute('data-done', 'false')
    await expect(count).toHaveText('1 of 6')
    await expect(title).toHaveText('Your first income')
    await expect(guide.getByTestId('setup-text')).toContainText('Type what comes in each month')
    await expect(number(1)).toHaveAttribute('aria-current', 'step')
    await expect(number(1)).toHaveAccessibleName('Step 1, Income: still to do')
    await expect(guide.getByRole('button', { name: 'Back' })).toBeDisabled()
    await expect(guide.getByRole('button', { name: 'Skip' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Suggestions', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId('total-in')).toHaveText('Total in€0.00')
    await expect(page.getByTestId('total-out')).toHaveText('Total out€0.00')
    // only the step's part is lit, the income group; everything else is dimmed, and "Per person" with it
    await expectLocked(['out', 'assets', 'claims'], ['from-accounts'])
    await expect(page.getByTestId('per-person')).toHaveAttribute('inert', '')
    // and only the step's own suggestions are offered
    await expect(page.getByTestId('suggestions')).toHaveCount(1)
    await expect(page.getByTestId('account-suggestions')).toHaveCount(0)
    await expectDead(assets.locator('button').filter({ hasText: 'Add account' }))
    await page.screenshot({ path: 'e2e/output/setup-step-1.png' })
    await page.screenshot({ path: 'e2e/output/setup-statement-empty.png', fullPage: true })

    // step 1, income: its number goes to its part with the cursor in the first amount; Enter adds the row
    const income = group('Income')
    await expect(income.locator('[data-suggestion]')).toHaveText([/^Ana – Salary/, /^Ben – Salary/, /^Cal – Child benefit/, /^Other income/, /^Ana – Extra income/, /^Ben – Extra income/])
    await expect(page.getByRole('button', { name: /suggestions \(/ })).toHaveCount(0)
    await number(1).click()
    await expect(income.getByLabel('Amount per month for Ana – Salary')).toBeFocused()
    await income.getByLabel('Amount per month for Ana – Salary').fill('3000')
    await income.getByLabel('Amount per month for Ana – Salary').press('Enter')
    await income.getByLabel('Amount per month for Ben – Salary').fill('2500')
    await income.getByRole('button', { name: 'Add Ben – Salary' }).click()
    await expect(page.getByTestId('total-in')).toHaveText('Total in€5,500.00')
    // the step has what it asks for: its number is ticked, and the guide stays until it is told to move on
    await expect(number(1)).toHaveAttribute('data-done', 'true')
    await expect(number(1)).toHaveAccessibleName('Step 1, Income: done')
    await expect(title).toHaveText('Your first income')
    await expect(guide.getByRole('button', { name: 'Skip' })).toHaveCount(0)
    // not for us: the line leaves the page, and the two rarer ones stay listed
    await income.getByRole('button', { name: 'Dismiss Other income' }).click()
    await expect(income.locator('[data-suggestion]')).toHaveCount(3)
    await expect(income.locator('[data-suggestion]').filter({ hasText: 'Other income' })).toHaveCount(0)
    // nothing takes the rest yet, so the month shows what is left over: read on the locked side, which still counts
    await expect(leftover).toContainText('€5,500.00')

    // step 2, expenses: the lit part moves to the right side's first group, and each category offers its rows
    await guide.getByRole('button', { name: 'Next' }).click()
    await expect(count).toHaveText('2 of 6')
    await expect(title).toHaveText('Your first expenses')
    await expect(number(2)).toHaveAttribute('aria-current', 'step')
    await expectLocked(['in', 'assets', 'claims'], ['set-aside'])
    // income's suggestions went with their step, and a virtual account waits for its own
    await expect(income).toHaveCount(0)
    await expect(page.locator('[data-suggestion]').filter({ hasText: /^Travel/ })).toHaveCount(0)
    await page.screenshot({ path: 'e2e/output/setup-step-2.png' })
    // the row of the step before is locked now: no cursor, no press, no dialog
    await expectDead(moneyIn.locator('button[aria-label^="Ana – Salary:"]'))
    const housing = group('Housing')
    await expect(housing.locator('[data-suggestion]')).toHaveCount(5)
    await expect(housing.locator('[data-suggestion]').nth(0)).toHaveText(/^The flat – Rent or mortgage/)
    await expect(housing.locator('[data-suggestion]').nth(1)).toHaveText(/^The flat – Utilities/)
    await housing.getByLabel('Amount per month for The flat – Rent or mortgage').fill('1400')
    await housing.getByLabel('Amount per month for The flat – Rent or mortgage').press('Enter')
    await expect(moneyOut.getByRole('button', { name: /^The flat – Rent or mortgage: €1,400\.00/ })).toBeVisible()
    await expect(number(2)).toHaveAttribute('data-done', 'true')
    await expect(leftover).toContainText('€4,100.00')
    // pocket money is a line per adult with an amount of its own
    const general = group('Expenses')
    await general.getByLabel('Amount per month for Ana – Pocket').fill('300')
    await general.getByLabel('Amount per month for Ana – Pocket').press('Enter')
    await expect(moneyOut.getByRole('button', { name: /^Ana – Pocket: €300\.00/ })).toBeVisible()
    await expect(leftover).toContainText('€3,800.00')
    // on a phone the two sides stand under each other: the step's part is brought up, under the guide
    await page.setViewportSize(PHONE)
    await number(2).click()
    await expectUnderGuide(part('expenses'))
    await page.screenshot({ path: 'e2e/output/setup-step-2-phone.png' })
    await page.setViewportSize(WIDE)

    // Back goes to the step before, and a number straight to its step; a step with nothing yet is skipped, not blocked
    await guide.getByRole('button', { name: 'Back' }).click()
    await expect(title).toHaveText('Your first income')
    await expectLocked(['out', 'assets', 'claims'], ['from-accounts'])
    await number(6).click()
    await expect(title).toHaveText('Loans and cards')
    await expect(count).toHaveText('6 of 6')
    await expect(guide.getByRole('button', { name: 'Finish' })).toBeVisible()
    await expectLocked(['in', 'assets'], ['expenses'])
    await number(3).click()

    // step 3, savings: Assets is lit, and the second group on the right, where what is saved shows. The usual two
    // accounts are offered under Assets; a savings account is asked to take the rest
    await expect(title).toHaveText('Savings, and where the rest goes')
    await expect(guide.getByRole('button', { name: 'Skip' })).toBeVisible()
    await expectLocked(['in', 'claims'], ['expenses'])
    await page.screenshot({ path: 'e2e/output/setup-step-3.png' })
    const offered = page.getByTestId('account-suggestions')
    await expect(offered.locator('[data-suggestion]')).toHaveText([/^Main account/, /^Savings/])
    await offered.getByRole('button', { name: 'Add Main account' }).click()
    await expect(dlg.getByLabel('Name', { exact: true })).toHaveValue('Main account')
    await expect(dlg.getByLabel('Type')).toHaveValue('checking')
    await dlg.getByLabel('Holds at the start of November 2026 (EUR)').fill('500')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    await expect(offered.locator('[data-suggestion]')).toHaveText([/^Savings/])
    await expect(guide.getByRole('button', { name: 'Choose where the rest goes' })).toHaveCount(0)
    await offered.getByRole('button', { name: 'Add Savings' }).click()
    await expect(dlg.getByLabel('Type')).toHaveValue('savings')
    await dlg.getByLabel('Holds at the start of November 2026 (EUR)').fill('9000')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg.getByRole('heading', { name: 'How much goes to Savings?' })).toBeVisible()
    await expect(dlg.getByRole('radio', { name: 'The rest' })).toBeChecked()
    // put off for now: the account is there, the step is not done, and the guide offers the question again
    await dlg.getByRole('button', { name: 'Cancel' }).click()
    await expect(number(3)).toHaveAttribute('data-done', 'false')
    await guide.getByRole('button', { name: 'Choose where the rest goes' }).click()
    await expect(dlg.getByRole('heading', { name: 'How much goes to Savings?' })).toBeVisible()
    await expect(dlg.getByRole('radio', { name: 'The rest' })).toBeChecked()
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    await expect(number(3)).toHaveAttribute('data-done', 'true')
    await expect(guide.getByRole('button', { name: 'Choose where the rest goes' })).toHaveCount(0)
    await expect(moneyOut.getByRole('button', { name: 'To Savings: €3,800.00' })).toBeVisible()
    await expect(assets.locator('[data-line^="acc:"]').filter({ hasText: 'Savings' })).toContainText('€12,800.00')
    await expect(page.getByTestId('account-suggestions')).toHaveCount(0)

    // step 4, a virtual account: the usual ones are offered under Assets, where they will sit inside the savings
    // account, each with what goes in per month
    await guide.getByRole('button', { name: 'Next' }).click()
    await expect(title).toHaveText('Your first virtual account')
    await expectLocked(['in', 'claims'], ['expenses'])
    const pools = group('Virtual accounts')
    await expect(pools.locator('[data-suggestion]')).toHaveText([/^Travel/, /^Clothing/, /^Entertainment & dining out/])
    await expect(page.getByTestId('suggestions')).toHaveCount(1)
    await expect(pools.getByLabel('Set aside per month for Travel')).toBeFocused()
    await page.screenshot({ path: 'e2e/output/setup-step-4.png' })
    await page.setViewportSize(PHONE)
    await number(4).click()
    await expectUnderGuide(pools)
    await page.screenshot({ path: 'e2e/output/setup-step-4-phone.png' })
    await page.setViewportSize(WIDE)
    await pools.getByLabel('Set aside per month for Travel').fill('200')
    await pools.getByLabel('Set aside per month for Travel').press('Enter')
    await expect(assets.locator('[data-line^="pool:"]').filter({ hasText: 'Travel' })).toContainText('€200.00')
    await expect(moneyOut.getByRole('button', { name: 'To Savings: €3,600.00' })).toBeVisible()
    await expect(number(4)).toHaveAttribute('data-done', 'true')
    await expect(pools.locator('[data-suggestion]')).toHaveText([/^Clothing/, /^Entertainment & dining out/])
    // one of your own is added with the button beside "Add account"
    await expect(assets.getByRole('button', { name: 'Add virtual account' })).toBeVisible()

    // step 5, an investment account: the rows the second group offers for it wait for the account, and "Add account"
    // starts on the kind the step asks for; the new account is asked how much goes in
    await guide.getByRole('button', { name: 'Next' }).click()
    await expect(title).toHaveText('Your first investment')
    await expectLocked(['in', 'claims'], ['expenses'])
    await expect(pools).toHaveCount(0)
    const second = group('To savings, investments and debts')
    await expect(second.locator('[data-suggestion]')).toHaveText([/^Cal – Long-term savings/])
    await expect(second.getByRole('button', { name: 'Add an investment account for Cal – Long-term savings' })).toBeVisible()
    await page.screenshot({ path: 'e2e/output/setup-step-5.png' })
    await assets.getByRole('button', { name: 'Add account' }).click()
    await expect(dlg.getByLabel('Type')).toHaveValue('investment')
    await dlg.getByLabel('Name', { exact: true }).fill('Fund')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg.getByRole('heading', { name: 'How much goes to Fund?' })).toBeVisible()
    await dlg.getByLabel('Amount per month in EUR').fill('100')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    await expect(number(5)).toHaveAttribute('data-done', 'true')
    await expect(moneyOut.getByRole('button', { name: 'To Savings: €3,500.00' })).toBeVisible()

    // step 6, loans and cards: Debts is lit, and the second group, where the payments show. A loan comes with the row
    // that pays it off; the last step ends the guide with "Finish"
    await guide.getByRole('button', { name: 'Next' }).click()
    await expect(title).toHaveText('Loans and cards')
    await expect(guide.getByRole('button', { name: 'Next' })).toHaveCount(0)
    await expectLocked(['in', 'assets'], ['expenses'])
    await page.screenshot({ path: 'e2e/output/setup-step-6.png' })
    await claims.getByRole('button', { name: 'Add a card or loan' }).click()
    await dlg.getByLabel('Name', { exact: true }).fill('Car loan')
    await dlg.getByLabel('Type').selectOption('loan')
    await expect(dlg.getByRole('checkbox', { name: 'Add the row that pays it off' })).toBeChecked()
    await dlg.getByRole('button', { name: 'Save' }).click()
    // one Save made both; the row asks for its amount, which this household leaves for later
    await expect(dlg.getByRole('heading', { name: 'Car loan – Payment · November 2026' })).toBeVisible()
    await dlg.getByRole('button', { name: 'Cancel' }).click()
    await expect(dlg).toBeHidden()
    await expect(number(6)).toHaveAttribute('data-done', 'true')
    await expect(part('set-aside').locator('[data-line]').filter({ hasText: 'Car loan – Payment' })).toBeVisible()
    await expect(claims.locator('[data-line^="acc:"]').filter({ hasText: 'Car loan' })).toBeVisible()
    // a card is asked in plain words what is recorded for it
    await claims.getByRole('button', { name: 'Add a card or loan' }).click()
    await dlg.getByLabel('Name', { exact: true }).fill('Visa')
    await expect(dlg.getByLabel('Type')).toHaveValue('credit-card')
    await dlg.getByRole('radio', { name: 'Only what I pay to it' }).click()
    await expect(dlg).toContainText('Only the payment is a row')
    // the row that pays it off is offered with the card; this household adds it later
    await dlg.getByRole('checkbox', { name: 'Add the row that pays it off' }).uncheck()
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    await expect(claims.locator('[data-line^="acc:"]').filter({ hasText: 'Visa' })).toBeVisible()
    for (let n = 1; n <= 6; n++) await expect(number(n)).toHaveAttribute('data-done', 'true')
    await expect(page.getByTestId('total-in')).toHaveText('Total in€5,500.00')
    await expect(page.getByTestId('total-out')).toHaveText('Total out€5,500.00')
    await page.screenshot({ path: 'e2e/output/setup-statement.png', fullPage: true })
    // the guide stays at the top while the page scrolls, on a phone too
    await page.setViewportSize(PHONE)
    await claims.scrollIntoViewIfNeeded()
    await expect(guide).toBeInViewport()
    await page.screenshot({ path: 'e2e/output/setup-statement-phone.png' })
    await page.setViewportSize(WIDE)
    await claims.scrollIntoViewIfNeeded()
    await expect(guide).toBeInViewport()
    // the step is kept for this household across a reload, and its part is the lit one again
    await number(2).click()
    await page.reload()
    await expect(title).toHaveText('Your first expenses')
    await expect(count).toHaveText('2 of 6')
    await expectLocked(['in', 'assets', 'claims'], ['set-aside'])
    // what was open is not kept across a reload
    await moneyOut.getByRole('button', { name: 'Pocket money', exact: true }).click()

    // while setting up, deleting is one click: the row goes, a line says so and offers the way back
    const menu = page.getByRole('menu')
    const gone = page.getByRole('status').filter({ hasText: 'Deleted' })
    await moneyOut.getByRole('button', { name: 'Row menu for Ana – Pocket' }).click()
    await expect(menu.getByRole('menuitem', { name: 'Archive or delete…' })).toHaveCount(0)
    await menu.getByRole('menuitem', { name: 'Delete', exact: true }).click()
    await expect(gone).toContainText('Deleted "Ana – Pocket".')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(moneyOut.getByRole('button', { name: /^Ana – Pocket: / })).toHaveCount(0)
    await expect(toSavings).toContainText('€3,800.00')
    // what a suggestion made is offered again once it is deleted
    await expect(general.locator('[data-suggestion]').first()).toContainText('Ana – Pocket')
    await page.screenshot({ path: 'e2e/output/setup-deleted.png' })
    // on a phone the message sits above the bottom tabs
    await page.setViewportSize(PHONE)
    await expect(gone).toBeInViewport({ ratio: 1 })
    await page.screenshot({ path: 'e2e/output/setup-deleted-phone.png' })
    await page.setViewportSize(WIDE)
    await gone.getByRole('button', { name: 'Undo' }).click()
    await expect(moneyOut.getByRole('button', { name: /^Ana – Pocket: €300\.00/ })).toBeVisible()
    await expect(gone).toHaveCount(0)
    // a category with nothing in it goes the same way; one that has rows asks first and says they are kept
    await moneyOut.getByRole('button', { name: 'Category menu for Transport' }).click()
    await menu.getByRole('menuitem', { name: 'Delete', exact: true }).click()
    await expect(gone).toContainText('Deleted "Transport".')
    await expect(moneyOut.getByRole('button', { name: 'Transport', exact: true })).toHaveCount(0)
    await moneyOut.getByRole('button', { name: 'Category menu for Housing' }).click()
    await menu.getByRole('menuitem', { name: 'Delete', exact: true }).click()
    await expect(dlg.getByRole('heading', { name: 'Category "Housing"' })).toBeVisible()
    await expect(dlg).toContainText('keeps its place without a category')
    await dlg.getByRole('button', { name: 'Cancel' }).click()
    // an account is reached in its own step. One nothing points at is deleted from its dialog in one click; one that
    // is in use says what stands in the way
    await number(6).click()
    await claims.getByRole('button', { name: 'Edit Visa' }).click()
    await expect(dlg.getByRole('button', { name: 'Archive or delete…' })).toHaveCount(0)
    await dlg.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(gone).toContainText('Deleted "Visa".')
    await expect(claims.locator('[data-line^="acc:"]').filter({ hasText: 'Visa' })).toHaveCount(0)
    await number(3).click()
    await assets.getByRole('button', { name: 'Edit Savings' }).click()
    await dlg.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(dlg.getByRole('heading', { name: 'Account "Savings"' })).toBeVisible()
    await expect(dlg).toContainText('Resolve these first')
    await dlg.getByRole('button', { name: 'Cancel' }).click()

    // pocket money added without an amount asks straight away how much: an amount or a percentage, never the rest
    await number(2).click()
    await general.getByRole('button', { name: 'Add Ben – Pocket' }).click()
    await expect(dlg.getByRole('heading', { name: 'Ben – Pocket · November 2026' })).toBeVisible()
    await expect(dlg.getByRole('radio', { name: 'A fixed amount' })).toBeChecked()
    await expect(dlg.getByRole('radio', { name: 'The rest' })).toHaveCount(0)
    await dlg.getByRole('radio', { name: 'A percentage of Ben\'s income' }).click()
    await dlg.getByLabel('Percentage of Ben\'s income').fill('10')
    await expect(dlg.getByTestId('rule-preview')).toContainText('10% of €2,500.00, Ben\'s take-home income')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    await expect(moneyOut.getByRole('button', { name: 'Ben – Pocket: €250.00' })).toBeVisible()
    await expect(moneyOut.getByRole('button', { name: 'Rule for Ben – Pocket: 10% of their own income' })).toBeVisible()
    await expect(toSavings).toContainText('€3,250.00')
    await page.screenshot({ path: 'e2e/output/setup-pocket-rule.png' })

    // "Leave setup" unlocks everything at once and puts the guide and the suggestions away; the month stays where it
    // was. Undo brings the guide back, on its step, with its locks
    await guide.getByRole('button', { name: 'Leave setup' }).click()
    await expect(guide).toHaveCount(0)
    await expect(lockedParts).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Suggestions', exact: true })).toHaveAttribute('aria-pressed', 'false')
    await expect(page.getByTestId('suggestions')).toHaveCount(0)
    await expect(page.getByRole('heading', { level: 2, name: 'November 2026' })).toBeVisible()
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect(title).toHaveText('Your first expenses')
    await expectLocked(['in', 'assets', 'claims'], ['set-aside'])
    // "Finish" on the last step does the same, for good
    await number(6).click()
    await guide.getByRole('button', { name: 'Finish' }).click()
    await expect(guide).toHaveCount(0)
    await expect(lockedParts).toHaveCount(0)
    await expect(page.getByTestId('suggestions')).toHaveCount(0)
    // from now on removing is the controlled way: archive from a month, or delete, in the dialog
    await moneyOut.getByRole('button', { name: 'Row menu for Ana – Pocket' }).click()
    await expect(menu.getByRole('menuitem', { name: 'Delete', exact: true })).toHaveCount(0)
    await menu.getByRole('menuitem', { name: 'Archive or delete…' }).click()
    await expect(dlg.getByRole('heading', { name: 'Row "Ana – Pocket"' })).toBeVisible()
    await dlg.getByRole('button', { name: 'Cancel' }).click()

    // the Grid shows the same household: the amounts start in the first month and the rest has its row
    await page.getByRole('navigation', { name: 'Screens' }).getByRole('link', { name: 'Grid' }).click()
    await expect(page.getByText(/^Testers ·/)).toBeVisible()
    await expect(page.getByRole('rowheader', { name: /^To Savings/ })).toContainText('= the rest')
    await expect(page.getByRole('button', { name: /^Ana – Salary Nov 2026: €3,000\.00/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /^The flat – Rent or mortgage Nov 2026: -?€1,400\.00/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /^To Travel Nov 2026: -?€200\.00/ })).toBeVisible()
    // neither the month-end rule nor how money is shared is a setting any more; the rule on a line is the one place
    await page.getByRole('link', { name: 'Household' }).click()
    await expect(page.getByLabel(/^Cash kept in the account at month end/)).toBeVisible()
    await expect(page.getByLabel('Month-end rule')).toHaveCount(0)
    await expect(page.getByLabel('How you share money')).toHaveCount(0)
    await page.getByRole('link', { name: 'Data' }).click()
    await page.getByLabel('Type WIPE to confirm').fill('WIPE')
    await page.getByRole('button', { name: 'Wipe this device' }).click()
  })

  test('recurring items post into due months only and can be ticked paid', async ({ page }) => {
    await loadDemo(page)
    await page.getByRole('button', { name: 'Earlier months (2)' }).click()
    // demo car insurance is quarterly from January: October yes, November no
    await expect(page.getByRole('button', { name: /^The car – Insurance Oct 2026/ })).toContainText('210')
    await expect(page.getByRole('button', { name: /^The car – Insurance Nov 2026: empty/ })).toBeVisible()

    await page.getByRole('link', { name: 'Household' }).click()
    await page.getByRole('button', { name: 'Add schedule' }).click()
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

    await page.getByRole('link', { name: 'Grid' }).click()
    await expect(page.getByRole('button', { name: /^Water Nov 2026/ })).toContainText('90')
    // an amount goes on a schedule where it is typed: "Repeats" in the cell's own dialog, and no second form
    await page.getByRole('button', { name: /^Groceries Nov 2026/ }).click()
    const dlg = page.getByRole('dialog')
    await expect(dlg.getByRole('button', { name: 'Make recurring…' })).toHaveCount(0)
    await expect(dlg.getByLabel('Amount in EUR')).toHaveValue('700')
    await expect(dlg.getByRole('radiogroup', { name: 'Repeats' }).getByRole('radio')).toHaveText(['Every month', 'On a schedule', 'Only this month'])
    await dlg.getByRole('radio', { name: 'On a schedule' }).click()
    // it starts on every year in the month on screen, and says where it lands
    await expect(dlg.getByLabel('How often, Groceries')).toHaveValue('12')
    await expect(dlg.getByTestId('repeat-lands')).toHaveText('Lands in November each year.')
    await dlg.getByLabel('How often, Groceries').selectOption({ label: 'Every 2 months' })
    await expect(dlg.getByTestId('repeat-lands')).toHaveText('Lands in Jan, Mar, May, Jul, Sept and Nov.')
    await dlg.getByLabel('From which month, Groceries').selectOption({ label: 'December' })
    await expect(dlg.getByTestId('repeat-lands')).toHaveText('Lands in Feb, Apr, Jun, Aug, Oct and Dec. Not in November 2026; next: December 2026.')
    await page.screenshot({ path: 'e2e/output/repeats-single.png' })
    await dlg.getByLabel('From which month, Groceries').selectOption({ label: 'November' })
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    // it lands in November and not in December; the row's name carries the repeat symbol
    await expect(page.getByRole('button', { name: /^Groceries Nov 2026/ })).toContainText('700')
    await expect(page.getByRole('button', { name: /^Groceries Dec 2026: empty/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /^Groceries Jan 2027/ })).toContainText('700')
    await expect(page.getByRole('rowheader', { name: /^Groceries/ }).getByRole('img', { name: 'Repeats: Every 2 months (Jan, Mar, May, Jul, Sept, Nov)' })).toBeVisible()
    // the schedule is named after its row, and the full list has it
    await page.getByRole('link', { name: 'Household' }).click()
    await expect(page.getByRole('cell', { name: 'Every 2 months (Jan, Mar, May, Jul, Sept, Nov)' })).toBeVisible()
    await page.getByRole('link', { name: 'Grid' }).click()
    await expect(page.getByRole('button', { name: /^Water Dec 2026: empty/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /^Water Feb 2027/ })).toContainText('90')

    // a schedule's posting is ticked on the Statement like any other line; the schedule then shows the month as paid
    await page.getByRole('link', { name: 'Statement' }).click()
    await expect(page.getByRole('heading', { level: 2, name: 'November 2026' })).toBeVisible()
    await page.getByRole('region', { name: 'Money out' }).getByRole('button', { name: 'Housing', exact: true }).click()
    const rentDone = page.getByRole('checkbox', { name: 'The flat – Rent done' })
    await expect(rentDone).not.toBeChecked()
    await rentDone.click()
    await expect(rentDone).toBeChecked()
    await page.getByRole('link', { name: 'Household' }).click()
    await expect(page.getByLabel('Rent paid in Nov 2026')).toBeChecked()
    await page.getByRole('link', { name: 'Grid' }).click()
    await expect(page.getByRole('button', { name: /^The flat – Rent Nov 2026/ }).getByRole('img', { name: 'Done' })).toBeVisible()
  })
})

test.describe('recurring from the grid', () => {
  test.use({ viewport: { width: 1400, height: 900 } })

  test('change for one month or from now on, skip a month, end a schedule', async ({ page }) => {
    await loadDemo(page)
    await page.getByRole('button', { name: 'Earlier months (2)' }).click()
    const rent = (m: string) => page.getByRole('button', { name: new RegExp(`^The flat – Rent ${m}`) })

    // amount change from November on: October keeps the old amount
    await rent('Nov 2026').click()
    await expect(page.getByText('On a schedule')).toBeVisible()
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
    await expect(page.getByRole('button', { name: /^The flat – Rent Jan 2027: empty/ })).toBeVisible()
    await expect(rent('Feb 2027')).toContainText('1,700')

    // end car insurance for good: due months empty out, nothing comes back
    await page.getByRole('button', { name: /^The car – Insurance Oct 2026/ }).click()
    await page.getByRole('button', { name: 'Remove item' }).click()
    await page.getByRole('button', { name: 'All occurrences' }).click()
    // "All occurrences" hands the schedule to the remove dialog, on top of the editor
    const remove = page.getByRole('dialog', { name: 'Schedule "Car insurance"' })
    await expect(remove.getByText(/Its posted amount in \d+ open months/)).toBeVisible()
    await remove.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(page.getByRole('dialog')).toBeHidden()
    await expect(page.getByRole('button', { name: /^The car – Insurance Oct 2026: empty/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /^The car – Insurance Jan 2027: empty/ })).toBeVisible()

    // the list under Household reflects it
    await page.getByRole('link', { name: 'Household' }).click()
    // the schedules table (the Categories card lists row names too)
    const schedules = page.getByRole('table').filter({ has: page.getByRole('columnheader', { name: 'When' }) })
    // the schedule was split: the old one ended in October, the new one runs from November
    await expect(schedules.getByText('(ended Oct 2026)')).toBeVisible()
    await expect(schedules.getByRole('cell', { name: 'Car insurance', exact: true })).toHaveCount(0)
    await expect(schedules.getByRole('cell', { name: 'Rent', exact: true })).toHaveCount(1)
    await expect(schedules.getByRole('cell', { name: 'The flat – Rent', exact: true })).toHaveCount(2)
  })
})
