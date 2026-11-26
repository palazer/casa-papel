import { expect, openMonth, saveAnyway, stepMonth, test, type Locator, type Page } from './test'

async function openStatement(page: Page) {
  await page.goto('?demo=1')
  await page.getByRole('button', { name: 'Load the demo household' }).click()
  await page.getByRole('navigation', { name: 'Screens' }).getByRole('link', { name: 'Statement' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Statement' })).toBeVisible()
}

/** Open a month of the demo household from the strip of months. */
async function goToMonth(page: Page, name: string) {
  await openMonth(page, name)
}

const total = (page: Page, side: 'in' | 'out' | 'assets' | 'claims') => page.getByTestId(`total-${side}`)

/** The "…" on an account's or a virtual account's line, and "Edit…" in it: the way into its dialog. */
async function editFrom(page: Page, side: Locator, name: string, what: 'Account' | 'Virtual account' = 'Account') {
  await side.getByRole('button', { name: `${what} menu for ${name}` }).click()
  await page.getByRole('menuitem', { name: 'Edit…' }).click()
}

/** A dialog that has finished opening: a screenshot taken before that shows it half faded in. */
const settled = (dlg: Locator) => dlg.evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)).then(() => undefined))

/** Where something starts, and where its middle is, across the page: for things that must share a column. */
const leftOf = async (l: Locator) => (await l.boundingBox())!.x
const middleOf = async (l: Locator) => { const b = (await l.boundingBox())!; return b.x + b.width / 2 }

test.describe('the Statement', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('a month that is over: both halves balance, categories open to rows and items, and it is worked like any other', async ({ page }) => {
    await openStatement(page)
    await expect(page.getByRole('navigation', { name: 'Screens' }).getByRole('link', { name: 'Statement' })).toHaveAttribute('aria-current', 'page')
    await goToMonth(page, 'September 2026')
    // the month is over and says so beside the household's name
    await expect(page.getByText('past', { exact: true })).toBeVisible()
    await expect(page.getByText('past', { exact: true })).toHaveAttribute('title', 'This month is over. It can still be changed.')

    // the month: money in equals money out
    await expect(total(page, 'in')).toHaveText('Total in€7,255.00')
    await expect(total(page, 'out')).toHaveText('Total out€7,255.00')
    const moneyOut = page.getByRole('region', { name: 'Money out' })
    // what the month costs; the pocket money (1,000) is shared out of what is left, in the block under it
    await expect(moneyOut.locator('[data-line="expenses"]')).toContainText('€3,357.00')
    await expect(moneyOut.locator('[data-line="set-aside"]')).toContainText('From what is left')
    await expect(moneyOut.locator('[data-line="rowless"]')).toHaveCount(0)

    // the position: assets equal debts and net worth, in balances and in the month's change
    const assets = (await total(page, 'assets').innerText()).replace(/^Total\s*/, '')
    const claims = (await total(page, 'claims').innerText()).replace(/^Total\s*/, '')
    expect(assets).toBe(claims)
    await expect(total(page, 'assets')).toContainText('€23,018.00')
    const position = page.getByRole('region', { name: 'Debts and net worth' })
    await expect(position.locator('[data-line="net-worth"]')).toContainText('€23,018.00')
    await expect(position.locator('[data-line="free"]')).toContainText('€21,968.00')
    // virtual accounts sit under the savings account that holds them
    const assetsSide = page.getByRole('region', { name: 'Assets' })
    await expect(assetsSide.getByText('Travel', { exact: true })).toBeVisible()
    await expect(assetsSide.getByText('Not set aside')).toBeVisible()
    // the demo has one main account: its line is named after it
    await expect(assetsSide.locator('[data-line="main"]')).toContainText('Main account')

    // a category opens to its rows, an itemized row to its items
    await expect(moneyOut.getByText('Sam – Personal')).toHaveCount(0)
    await moneyOut.getByRole('button', { name: 'Personal', exact: true }).click()
    await expect(moneyOut.getByText('Sam – Personal')).toBeVisible()
    await expect(moneyOut.getByText('Concert tickets')).toHaveCount(0)
    await moneyOut.getByRole('button', { name: 'Items of Sam – Personal' }).click()
    await expect(moneyOut.getByText('Concert tickets')).toBeVisible()
    await expect(moneyOut.getByText('Books')).toBeVisible()
    // a category opens and closes from anywhere on its line, not only from the arrow and the name
    const personal = moneyOut.locator('[data-line^="cat:expense:"]').filter({ hasText: 'Personal' })
    const box = (await personal.boundingBox())!
    await personal.click({ position: { x: box.width - 30, y: box.height / 2 } })
    await expect(moneyOut.getByText('Sam – Personal')).toHaveCount(0)
    await personal.click({ position: { x: box.width / 2, y: box.height / 2 } })
    await expect(moneyOut.getByText('Sam – Personal')).toBeVisible()
    // nothing is locked: the lines carry their ticks, set in September, and open their dialog
    await expect(moneyOut.getByRole('checkbox', { name: 'Sam – Personal done' })).toBeChecked()
    await expect(moneyOut.getByRole('button', { name: /^Alex – Personal:/ })).toBeVisible()
    await page.screenshot({ path: 'e2e/output/statement-past.png', fullPage: true })

    // "Expand all" and "Collapse all"
    await page.getByRole('button', { name: 'Expand all' }).click()
    await expect(moneyOut.getByText('The flat – Rent')).toBeVisible()
    await page.getByRole('button', { name: 'Collapse all' }).click()
    await expect(moneyOut.getByText('The flat – Rent')).toHaveCount(0)
    await expect(assetsSide.getByText('Not set aside')).toHaveCount(0)

    // every line of September is ticked, so it counts as done. Nothing closes or reopens a month; the legend sits in the toolbar
    const progress = page.getByTestId('progress')
    await expect(progress).toHaveText(/^All \d+ done$/)
    await expect(page.getByRole('button', { name: /Close month|Reopen month/ })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Balances…' })).toBeVisible()
    await page.getByRole('button', { name: 'Colours and marks' }).click()
    await expect(page.getByRole('dialog').getByText('An estimate: on the yellow shade', { exact: false })).toBeVisible()
    await expect(page.getByRole('dialog').getByText('A month that is over: grey in the Grid, "past" on the Statement. It can still be changed')).toBeVisible()
    await page.keyboard.press('Escape')
    // the month is worked like any other: a tick comes off and goes back on, and no amount moves
    // ("Collapse all" folded the headings too: the one that holds the row is opened again)
    const moved = page.getByRole('checkbox', { name: 'To savings done' })
    await expect(moved).toHaveCount(0)
    await moneyOut.getByRole('button', { name: 'From what is left', exact: true }).click()
    await expect(moved).toBeChecked()
    await moved.click()
    await expect(progress).toHaveText(/^\d+ of \d+ done · /)
    await moved.click()
    await expect(progress).toHaveText(/^All \d+ done$/)
    await expect(total(page, 'in')).toHaveText('Total in€7,255.00')
    // the current month is not over
    await goToMonth(page, 'November 2026')
    await expect(page.getByText('past', { exact: true })).toHaveCount(0)
  })

  test('the strip of months: every month is a chip with its four figures, and the pressed chip follows the month on screen', async ({ page }) => {
    await openStatement(page)
    await expect(page.getByRole('heading', { level: 2, name: 'November 2026' })).toBeVisible()
    const strip = page.getByRole('navigation', { name: 'Months' })
    const chip = (m: string) => strip.locator(`[data-month="${m}"]`)
    // every month of the demo's plan, September 2026 to December 2027
    await expect(strip.locator('[data-month]')).toHaveCount(16)

    // November is the page in small: income + from accounts, and expenses + what is left, both coming to the page's totals
    await expect(total(page, 'in')).toHaveText('Total in€8,065.00')
    await expect(total(page, 'out')).toHaveText('Total out€8,065.00')
    await expect(chip('2026-11')).toHaveAccessibleName('November 2026, now: income €7,405, from accounts €660, expenses €3,896, from what is left €4,169')
    await expect(chip('2026-11')).toContainText('7,405 + 660')
    await expect(chip('2026-11')).toContainText('3,896 + 4,169')
    // it is the current month and the one on screen: "now", and pressed
    await expect(chip('2026-11')).toContainText('now')
    await expect(chip('2026-11')).toHaveAttribute('aria-current', 'date')
    await expect(chip('2026-11')).toHaveAttribute('aria-pressed', 'true')
    await expect(strip.locator('[aria-pressed="true"]')).toHaveCount(1)
    // each figure wears the colour of its group on the page; the pressed chip gives them up for the lime's own
    await expect(chip('2026-12').locator('.text-income')).toHaveText('7,405')
    await expect(chip('2026-12').locator('.text-expense')).toHaveCount(1)
    await expect(chip('2026-12').locator('.text-transfer')).toHaveCount(1)
    await expect(chip('2026-11').locator('.text-income')).toHaveCount(0)

    // a month that is over is grey and says so; nothing came out of an account in September, so line one is the income alone
    await expect(chip('2026-09')).toHaveAccessibleName('September 2026, past: income €7,255, expenses €3,357, from what is left €3,898')
    await expect(chip('2026-09')).toHaveClass(/bg-muted\/60/)
    await expect(chip('2026-09')).not.toContainText('+ 0')
    await expect(chip('2026-12')).not.toHaveClass(/bg-muted\/60/)
    // it opens with the months before the current one in view (the demo has two), and twelve chips across
    await expect(chip('2026-09')).toBeInViewport({ ratio: 1 })
    await expect(chip('2027-08')).toBeInViewport({ ratio: 1 })
    await expect(chip('2027-12')).not.toBeInViewport()
    await page.screenshot({ path: 'e2e/output/statement-month-strip.png' })

    // pressing a chip opens its month
    await chip('2026-10').click()
    await expect(page.getByRole('heading', { level: 2, name: 'October 2026' })).toBeVisible()
    await expect(chip('2026-10')).toHaveAttribute('aria-pressed', 'true')
    await expect(chip('2026-11')).toHaveAttribute('aria-pressed', 'false')
    await expect(page.getByText('past', { exact: true })).toBeVisible()
    // the month has no arrows beside its name: the strip is where it is changed
    await expect(page.getByRole('button', { name: 'Next month' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Previous month' })).toHaveCount(0)
    await chip('2026-11').click()
    await expect(chip('2026-11')).toHaveAttribute('aria-pressed', 'true')
    // a chip that is out of view comes into it once it is the month on screen
    await chip('2027-12').evaluate((el: HTMLElement) => el.click())
    await expect(chip('2027-12')).toHaveAttribute('aria-pressed', 'true')
    await expect(chip('2027-12')).toBeInViewport({ ratio: 0.99 })
    // the last month brings what stands after it into view: the plan grows a calendar year at a time
    const add = strip.getByRole('button', { name: 'Add 2028' })
    await expect(add).toBeInViewport({ ratio: 0.99 })
    await page.screenshot({ path: 'e2e/output/statement-month-strip-end.png' })

    // one stop for the Tab key: the arrow keys move along the chips, Enter opens the month
    await chip('2027-12').focus()
    await page.keyboard.press('ArrowLeft')
    await expect(chip('2027-11')).toBeFocused()
    await page.keyboard.press('Home')
    await expect(chip('2026-09')).toBeFocused()
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('Enter')
    await expect(page.getByRole('heading', { level: 2, name: 'October 2026' })).toBeVisible()

    // the (i) says what the two lines are
    await strip.getByRole('button', { name: 'About The months of the plan' }).click()
    await expect(page.getByText('Line one is what came in: income + what came out of your accounts.', { exact: false })).toBeVisible()
    await page.keyboard.press('Escape')

    // the strip stays in view with the month's line while the page scrolls; only the name of the screen scrolls away
    await page.getByRole('button', { name: 'Expand all' }).click()
    await page.evaluate(() => window.scrollTo(0, 500))
    await expect(page.getByRole('heading', { level: 1, name: 'Statement' })).not.toBeInViewport()
    await expect(strip).toBeInViewport({ ratio: 1 })
    await expect(page.getByRole('heading', { level: 2, name: 'October 2026' })).toBeInViewport()
    // and the month is changed from there
    await chip('2026-12').click()
    await expect(page.getByRole('heading', { level: 2, name: 'December 2026' })).toBeInViewport()
    await expect(chip('2026-12')).toHaveAttribute('aria-pressed', 'true')
    await expect(strip).toBeInViewport({ ratio: 1 })
  })

  test('the line under the strip reads by subject: the month and what belongs to it, then the page\'s buttons, then Undo and Redo', async ({ page }) => {
    await openStatement(page)
    const bar = page.locator('[data-sticky-bar]')
    const x = async (l: Locator) => (await l.boundingBox())!.x
    const order = [
      page.getByRole('heading', { level: 2, name: 'November 2026' }),
      page.getByTestId('progress'),
      bar.getByRole('button', { name: 'Balances…' }),
      bar.getByRole('button', { name: 'Suggestions', exact: true }),
      bar.getByRole('button', { name: 'Expand all' }),
      bar.getByRole('button', { name: 'Collapse all' }),
      bar.getByRole('button', { name: 'Colours and marks' }),
      bar.getByRole('button', { name: 'Undo' }),
      bar.getByRole('button', { name: 'Redo' }),
    ]
    const xs = [] as number[]
    for (const l of order) xs.push(await x(l))
    expect(xs).toEqual([...xs].sort((a, b) => a - b))
    // one line on a wide window, under the strip
    const ys = await Promise.all([order[0], order[2], order[8]].map(async (l) => { const b = (await l.boundingBox())!; return b.y + b.height / 2 }))
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(6)
    expect((await page.getByRole('navigation', { name: 'Months' }).boundingBox())!.y).toBeLessThan(ys[0])
    // a month that is over says so beside its name, not up beside the household's
    await page.getByRole('navigation', { name: 'Months' }).locator('[data-month="2026-10"]').click()
    const past = bar.getByText('past', { exact: true })
    await expect(past).toBeVisible()
    expect(await x(past)).toBeGreaterThan(await x(page.getByRole('heading', { level: 2, name: 'October 2026' })))
    expect(await x(past)).toBeLessThan(await x(page.getByTestId('progress')))
  })

  test('spending from a virtual account shows on both sides', async ({ page }) => {
    await openStatement(page)
    await goToMonth(page, 'October 2026')
    const moneyIn = page.getByRole('region', { name: 'Money in' })
    // one section for everything that came out of the accounts; what the trip took out of Travel is a calculated line in it
    await expect(moneyIn.locator('[data-line="from-accounts"]')).toContainText('From accounts')
    await expect(moneyIn.locator('[data-line="from-accounts"]')).toContainText('€480.00')
    await expect(moneyIn.locator('[data-line^="src:"]')).toContainText(['Travel'])
    await expect(moneyIn.locator('[data-line^="src:"]').first()).toContainText('calculated')
    await expect(moneyIn.getByText('Taken from accounts')).toHaveCount(0)
    await expect(moneyIn.getByText('From savings and virtual accounts')).toHaveCount(0)
    const totalIn = (await total(page, 'in').innerText()).replace(/^Total in\s*/, '')
    const totalOut = (await total(page, 'out').innerText()).replace(/^Total out\s*/, '')
    expect(totalIn).toBe(totalOut)
    await page.screenshot({ path: 'e2e/output/statement.png', fullPage: true })
  })
})

test.describe('working the month in the Statement', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  const euros = (text: string) => Number(text.replace(/[^0-9.]/g, ''))

  test('an estimate is shaded until it is overwritten as certain; ticks mark rows and items done', async ({ page }) => {
    await openStatement(page)
    await goToMonth(page, 'November 2026')
    const moneyOut = page.getByRole('region', { name: 'Money out' })
    const dlg = page.getByRole('dialog')

    // an estimate sits on the yellow shade, and so does the category above it
    const housing = moneyOut.locator('[data-line^="cat:expense"]').filter({ hasText: 'Housing' })
    await expect(housing.locator('[data-estimate]')).toHaveText('€1,860.00')
    await moneyOut.getByRole('button', { name: 'Housing', exact: true }).click()
    const utilities = moneyOut.getByRole('button', { name: /^The flat – Utilities:/ })
    await expect(utilities).toHaveAccessibleName('The flat – Utilities: €210.00, an estimate')
    // the shade sits on the amount, beside the line's button
    const utilitiesLine = moneyOut.locator('[data-line]').filter({ has: page.getByRole('button', { name: /^The flat – Utilities:/ }) })
    await expect(utilitiesLine.locator('[data-estimate]')).toHaveText('€210.00')
    // a certain amount is plain
    await expect(moneyOut.getByRole('button', { name: /^The flat – Rent:/ })).toHaveAccessibleName('The flat – Rent: €1,650.00')
    const rest = moneyOut.locator('[data-line]').filter({ has: page.locator('[data-rule="rest"]') })
    const restBefore = euros(await rest.innerText())

    // overwrite it for this month and say it is certain
    await utilities.click()
    await expect(dlg.getByRole('heading', { name: /The flat – Utilities/ })).toBeVisible()
    await dlg.getByLabel('Amount in EUR').fill('199')
    await dlg.getByRole('radio', { name: 'Only this month' }).click()
    await dlg.getByRole('radio', { name: 'Certain' }).click()
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    await expect(utilities).toHaveAccessibleName('The flat – Utilities: €199.00')
    await expect(utilitiesLine.locator('[data-estimate]')).toHaveCount(0)
    await expect(housing.locator('[data-estimate]')).toHaveCount(0)
    await expect(housing).toContainText('€1,849.00')
    // the 11 saved goes to the rest, and the two sides still agree
    expect(euros(await rest.innerText())).toBe(restBefore + 11)
    expect((await total(page, 'in').innerText()).replace(/^Total in\s*/, '')).toBe((await total(page, 'out').innerText()).replace(/^Total out\s*/, ''))

    // one click on a tick marks a row done, and the progress line counts it
    const progress = page.getByTestId('progress')
    await expect(progress).toHaveText(/^0 of 21 done · €[\d,.]+ still to pay · €7,405\.00 to come in$/)
    await moneyOut.getByRole('button', { name: 'Family & pets', exact: true }).click()
    const childcare = page.getByRole('checkbox', { name: 'Robin – Childcare done' })
    await expect(childcare).not.toBeChecked()
    await childcare.click()
    await expect(childcare).toBeChecked()
    await expect(progress).toHaveText(/^1 of 21 done/)

    // an automatic row can be ticked as moved but not typed over: its dialog opens on the rule that works it out
    await expect(page.getByRole('checkbox', { name: 'To savings done' })).toBeVisible()
    await moneyOut.getByRole('button', { name: /^To savings:/ }).click()
    await expect(dlg.getByRole('heading', { name: 'To savings · November 2026' })).toBeVisible()
    await expect(dlg.getByRole('radio', { name: 'The rest' })).toBeChecked()
    await expect(dlg.getByLabel('Amount in EUR')).toHaveCount(0)
    await dlg.getByRole('button', { name: 'Cancel' }).click()
    await expect(dlg).toBeHidden()
    // pocket money is a line per adult with an amount of its own, at the top of what is shared out of the rest
    await expect(moneyOut.getByRole('button', { name: 'Pocket money', exact: true })).toHaveCount(0)
    await expect(page.getByRole('checkbox', { name: 'Sam – Pocket done' })).toBeVisible()
    await expect(moneyOut.getByRole('button', { name: 'Sam – Pocket: €500.00' })).toBeVisible()

    // an itemized row opens to its items, each with a tick of its own
    await moneyOut.getByRole('button', { name: 'Living', exact: true }).click()
    await moneyOut.getByRole('button', { name: /^Health:/ }).click()
    await dlg.getByRole('tab', { name: 'Itemized' }).click()
    await dlg.getByRole('button', { name: 'Add item' }).click()
    await dlg.getByLabel('Item label').last().fill('Physio')
    // an item amount that cannot be read is said on saving, not stored as zero
    await dlg.getByLabel('Item amount').last().fill('abc')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg.getByRole('alert')).toHaveText('"Physio" has an amount that is not a number I can read.')
    await dlg.getByLabel('Item amount').last().fill('45')
    await expect(dlg.getByRole('alert')).toHaveCount(0)
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    await expect(moneyOut.getByRole('button', { name: /^Health:/ })).toHaveAccessibleName(/^Health: €75\.00/)
    await moneyOut.getByRole('button', { name: 'Items of Health' }).click()
    const physio = page.getByRole('checkbox', { name: 'Health: Physio done' })
    await physio.click()
    await expect(physio).toBeChecked()
    await expect(page.getByRole('checkbox', { name: 'Health done' })).toHaveAttribute('aria-checked', 'mixed')
    await page.screenshot({ path: 'e2e/output/statement-working.png', fullPage: true })

    // the Grid shows the same: a done dot on the row, a half dot on the partly done one
    await page.getByRole('navigation', { name: 'Screens' }).getByRole('link', { name: 'Grid' }).click()
    await expect(page.getByRole('button', { name: /^Robin – Childcare Nov 2026/ }).getByRole('img', { name: 'Done', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: /^Health Nov 2026/ }).getByRole('img', { name: /^1 of 2 done/ })).toBeVisible()
  })

  test('rows and categories are added where they will appear', async ({ page }) => {
    await openStatement(page)
    await goToMonth(page, 'November 2026')
    const moneyIn = page.getByRole('region', { name: 'Money in' })
    const moneyOut = page.getByRole('region', { name: 'Money out' })
    const dlg = page.getByRole('dialog')
    const totalIn = euros(await total(page, 'in').innerText())

    // a category appears as a line before it has a row
    await moneyOut.getByRole('button', { name: 'Add expense category' }).click()
    await moneyOut.getByLabel('New expense category name').fill('Hobbies')
    await moneyOut.getByLabel('New expense category name').press('Enter')
    const hobbies = moneyOut.locator('[data-line^="cat:expense"]').filter({ hasText: 'Hobbies' })
    await expect(hobbies).toBeVisible()

    // its first row is added inside it, and the editor opens for the amount
    await moneyOut.getByRole('button', { name: 'Hobbies', exact: true }).click()
    await moneyOut.getByRole('button', { name: 'Add row to Hobbies' }).click()
    await expect(moneyOut.getByLabel('Category for the new expense row')).toHaveValue(/.+/)
    await moneyOut.getByLabel('New expense row name').fill('Climbing')
    await moneyOut.getByRole('button', { name: 'Add', exact: true }).click()
    await expect(dlg.getByRole('heading', { name: /Climbing/ })).toBeVisible()
    await dlg.getByLabel('Amount in EUR').fill('40')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    await expect(moneyOut.getByRole('button', { name: /^Climbing:/ })).toHaveAccessibleName('Climbing: €40.00, an estimate')
    await expect(hobbies).toContainText('€40.00')

    // a row added at the foot of Income opens the editor too; the total follows and the sides still agree
    await moneyIn.getByRole('button', { name: 'Add income row' }).click()
    await moneyIn.getByLabel('New income row name').fill('Side job')
    await moneyIn.getByLabel('New income row name').press('Enter')
    await expect(dlg.getByRole('heading', { name: /Side job/ })).toBeVisible()
    await dlg.getByLabel('Amount in EUR').fill('200')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    // waited for: the dialog closes before the page has the saved figures
    await expect.poll(async () => euros(await total(page, 'in').innerText())).toBe(totalIn + 200)
    await expect.poll(async () => euros(await total(page, 'out').innerText())).toBe(totalIn + 200)
    await page.screenshot({ path: 'e2e/output/statement-adding.png', fullPage: true })
  })

  test('a category has an estimate: what is not broken down yet shrinks as rows are added, and the rows win', async ({ page }) => {
    await openStatement(page)
    await goToMonth(page, 'November 2026')
    const moneyOut = page.getByRole('region', { name: 'Money out' })
    const dlg = page.getByRole('dialog')
    const line = (name: string) => moneyOut.locator('[data-line^="cat:expense"]').filter({ hasText: name })
    const amountOf = async (name: string) => euros((await line(name).innerText()).split('\n').pop()!)
    const expenses = async () => euros((await moneyOut.locator('[data-line="expenses"]').innerText()).split('\n').pop()!)
    const rest = async () => euros((await moneyOut.locator('[data-line]').filter({ has: page.locator('[data-rule="rest"]') }).innerText()).split('\n').pop()!)
    const sidesAgree = async () => expect((await total(page, 'in').innerText()).replace(/^Total in\s*/, '')).toBe((await total(page, 'out').innerText()).replace(/^Total out\s*/, ''))
    const expensesBefore = await expenses()
    const restBefore = await rest()

    // a new category that is only a name and a number counts at once
    await moneyOut.getByRole('button', { name: 'Add expense category' }).click()
    await moneyOut.getByLabel('New expense category name').fill('Hobbies')
    await moneyOut.getByLabel('Estimate per month for the new expense category').fill('60')
    await moneyOut.getByLabel('Estimate per month for the new expense category').press('Enter')
    await expect(line('Hobbies')).toContainText('estimate €60.00')
    await expect(line('Hobbies').locator('[data-estimate]')).toHaveText('€60.00')
    expect(await expenses()).toBe(expensesBefore + 60)
    expect(await rest()).toBe(restBefore - 60)
    await sidesAgree()

    // inside it, what is not broken down yet; a row takes its share off it and the category stays at its estimate
    await moneyOut.getByRole('button', { name: 'Hobbies', exact: true }).click()
    const left = moneyOut.getByRole('button', { name: /^Not broken down yet:/ })
    await expect(left).toHaveAccessibleName('Not broken down yet: €60.00, an estimate')
    await moneyOut.getByRole('button', { name: 'Add row to Hobbies' }).click()
    await moneyOut.getByLabel('New expense row name').fill('Climbing')
    await moneyOut.getByLabel('New expense row name').press('Enter')
    await dlg.getByLabel('Amount in EUR').fill('40')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    await expect(left).toHaveAccessibleName('Not broken down yet: €20.00, an estimate')
    expect(await amountOf('Hobbies')).toBe(60)
    expect(await expenses()).toBe(expensesBefore + 60)
    await page.screenshot({ path: 'e2e/output/statement-estimate.png', fullPage: true })

    // the line opens the estimate it comes from; below what the rows add up to, the rows win
    await left.click()
    await expect(dlg.getByRole('heading', { name: 'Estimate for Hobbies · November 2026' })).toBeVisible()
    await expect(dlg.getByLabel('Estimate per month in EUR', { exact: true })).toHaveValue('60')
    await dlg.getByLabel('Estimate per month in EUR', { exact: true }).fill('30')
    await expect(dlg.getByTestId('estimate-left')).toHaveText('€0.00')
    await expect(dlg.getByText('The rows already add up to more, so Hobbies will show their sum.')).toBeVisible()
    await expect(dlg).toHaveCSS('opacity', '1')
    await page.screenshot({ path: 'e2e/output/statement-estimate-dialog.png' })
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    await expect(moneyOut.getByRole('button', { name: /^Not broken down yet:/ })).toHaveCount(0)
    await expect(line('Hobbies')).toContainText('estimate €30.00')
    expect(await amountOf('Hobbies')).toBe(40)

    // an existing category: Housing has Rent 1,650 and Utilities 210
    await moneyOut.getByRole('button', { name: 'Housing', exact: true }).click()
    // the estimate is set from the category's "…"; its foot holds no button for it
    await expect(moneyOut.getByRole('button', { name: /^(Set|Change) estimate/ })).toHaveCount(0)
    await moneyOut.getByRole('button', { name: 'Category menu for Housing' }).click()
    await expect(page.getByRole('menuitem')).toHaveText(['Rename…', 'Set estimate…', 'Move up', 'Move down', 'Remove…'])
    await page.getByRole('menuitem', { name: 'Set estimate…' }).click()
    await dlg.getByLabel('Estimate per month in EUR', { exact: true }).fill('2000')
    await expect(dlg.getByTestId('estimate-left')).toHaveText('€140.00')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    // the dialog closes before the page has the saved estimate: the figure is waited for, not read once
    await expect.poll(() => amountOf('Housing')).toBe(2000)
    await expect(moneyOut.getByRole('button', { name: /^Not broken down yet:/ })).toHaveAccessibleName('Not broken down yet: €140.00, an estimate')
    await expect(page.getByRole('checkbox', { name: 'Not broken down yet done' })).toBeVisible()
    await sidesAgree()

    // it carries forward like any amount, and the Grid counts the same rest as an automatic row
    await stepMonth(page, 1)
    await expect(page.getByRole('heading', { level: 2, name: 'December 2026' })).toBeVisible()
    expect(await amountOf('Housing')).toBe(2000)
    await page.getByRole('navigation', { name: 'Screens' }).getByRole('link', { name: 'Grid' }).click()
    await expect(page.getByText('Housing – Not broken down yet')).toBeVisible()
    await expect(page.getByRole('button', { name: /^Housing – Not broken down yet Nov 2026/ })).toHaveCount(0)

    // taking the estimate away gives the category back to its rows
    await page.getByRole('navigation', { name: 'Screens' }).getByRole('link', { name: 'Statement' }).click()
    await goToMonth(page, 'November 2026')
    await moneyOut.getByRole('button', { name: 'Housing', exact: true }).click()
    await moneyOut.getByRole('button', { name: 'Category menu for Housing' }).click()
    await page.getByRole('menuitem', { name: 'Change estimate…' }).click()
    await dlg.getByRole('button', { name: 'Remove estimate' }).click()
    await expect(dlg).toBeHidden()
    await expect.poll(() => amountOf('Housing')).toBe(1860)
    await expect(line('Housing')).not.toContainText('estimate')
    await sidesAgree()
  })

  test('a real balance is entered from its line; what a card owes beyond the plan is said on its line, and no spending is made up for it', async ({ page }) => {
    await openStatement(page)
    await goToMonth(page, 'November 2026')
    const moneyOut = page.getByRole('region', { name: 'Money out' })
    const claims = page.getByRole('region', { name: 'Debts and net worth' })
    const assets = page.getByRole('region', { name: 'Assets' })
    const dlg = page.getByRole('dialog')
    const expensesBefore = euros(await moneyOut.locator('[data-line="expenses"]').innerText())
    const restBefore = euros(await moneyOut.locator('[data-line]').filter({ has: page.locator('[data-rule="rest"]') }).innerText())
    const amountOf = async (line: string) => euros((await claims.locator(`[data-line="${line}"]`).innerText()).split('\n').pop()!)
    const netWorthBefore = await amountOf('net-worth')

    // the card: the statement says 400 is owed, the plan had nothing
    await claims.getByRole('button', { name: /^Credit card balance:/ }).click()
    await expect(dlg.getByRole('heading', { name: 'Credit card · November 2026' })).toBeVisible()
    await dlg.getByLabel('At the end of November 2026 (EUR)').fill('400')
    // nothing offers to turn the difference into spending
    await expect(dlg.getByTestId('book-difference')).toHaveCount(0)
    await expect(dlg.getByRole('checkbox')).toHaveCount(0)
    await expect(dlg).toHaveCSS('opacity', '1')
    await page.screenshot({ path: 'e2e/output/statement-card-balance.png' })
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()

    // the debt is 400, entered, and the line says how far the plan was off; the month's spending is what it was
    await expect(claims.getByRole('button', { name: /^Credit card balance:/ })).toHaveAccessibleName('Credit card balance: €400.00, entered')
    await expect(claims.locator('[data-line^="acc:"]').filter({ hasText: 'Credit card' })).toContainText('entered, +€400.00 against the plan')
    expect(euros(await moneyOut.locator('[data-line="expenses"]').innerText())).toBe(expensesBefore)
    expect(euros(await moneyOut.locator('[data-line]').filter({ has: page.locator('[data-rule="rest"]') }).innerText())).toBe(restBefore)
    expect(await amountOf('net-worth')).toBe(netWorthBefore - 400)
    expect((await total(page, 'in').innerText()).replace(/^Total in\s*/, '')).toBe((await total(page, 'out').innerText()).replace(/^Total out\s*/, ''))
    expect((await total(page, 'assets').innerText()).replace(/^Total\s*/, '')).toBe((await total(page, 'claims').innerText()).replace(/^Total\s*/, ''))

    // any other account: the balance is pinned and the line says how far it is from the plan
    await assets.getByRole('button', { name: /^Index fund balance:/ }).click()
    await dlg.getByLabel('At the end of November 2026 (EUR)').fill('14000')
    await expect(dlg.getByTestId('book-difference')).toHaveCount(0)
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    await expect(assets.getByRole('button', { name: /^Index fund balance:/ })).toHaveAccessibleName('Index fund balance: €14,000.00, entered')
    await expect(assets.locator('[data-line^="acc:"]').filter({ hasText: 'Index fund' })).toContainText(/entered, \+€[\d.,]+ against the plan/)
    await page.screenshot({ path: 'e2e/output/statement-balances.png', fullPage: true })
  })

  test('a goal is set from the line it watches, which then carries its mark and opens to the bar', async ({ page }) => {
    await openStatement(page)
    await goToMonth(page, 'September 2026')
    const assets = page.getByRole('region', { name: 'Assets' })
    const dlg = page.getByRole('dialog')

    // a debt offers a goal to pay it down: nothing to choose, and zero unless another amount is typed
    await page.getByRole('region', { name: 'Debts and net worth' }).getByRole('button', { name: 'Set a goal for Credit card' }).click()
    await expect(dlg.getByRole('heading', { name: 'Goal for Credit card' })).toBeVisible()
    await expect(dlg.getByRole('radiogroup', { name: 'Kind' })).toHaveCount(0)
    await expect(dlg.getByLabel('Tracks')).toHaveCount(0)
    await expect(dlg.getByLabel('Bring it down to (EUR)')).toHaveValue('0')
    await dlg.getByRole('button', { name: 'Cancel' }).click()

    // a virtual account: the line says what the goal watches, so only the name, the amount and the month are asked
    await assets.getByRole('button', { name: 'Set a goal for Travel' }).click()
    await expect(dlg.getByRole('heading', { name: 'Goal for Travel' })).toBeVisible()
    await expect(dlg.getByRole('radiogroup', { name: 'Kind' })).toHaveCount(0)
    await expect(dlg.getByLabel('Tracks')).toHaveCount(0)
    await expect(dlg.getByLabel('Name')).toHaveValue('Travel')
    await expect(dlg).toHaveCSS('opacity', '1')
    await page.screenshot({ path: 'e2e/output/statement-goal-dialog.png' })
    await dlg.getByLabel('Name').fill('Travel fund')
    await dlg.getByLabel(/^Target \(EUR\)/).fill('10000')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    await expect(assets.getByRole('button', { name: 'Set a goal for Travel' })).toHaveCount(0)
    // 800 of 10,000
    await expect(assets.locator('[data-line^="pool:"]').filter({ hasText: 'Travel' })).toContainText('Goal Travel fund:8%')
    await expect(page.getByRole('progressbar', { name: 'Travel fund' })).toHaveCount(0)
    // the line opens its dialog; the arrow opens what is under it, the goal
    await assets.getByRole('button', { name: 'What is under Travel' }).click()
    await expect(page.getByRole('progressbar', { name: 'Travel fund' })).toHaveAttribute('aria-valuenow', '8')
    await expect(assets.getByText(/€800\.00 of €10,000\.00/)).toBeVisible()
    await page.screenshot({ path: 'e2e/output/statement-goal.png', fullPage: true })
    // the goal is edited from the same place
    await assets.getByRole('button', { name: 'Edit goal Travel fund' }).click()
    await expect(dlg.getByRole('heading', { name: 'Edit goal' })).toBeVisible()
    await expect(dlg.getByLabel('Name')).toHaveValue('Travel fund')
    await expect(dlg.getByLabel('Tracks')).toHaveCount(0)
    await dlg.getByRole('button', { name: 'Cancel' }).click()
  })

  test('cash is an asset with a balance of its own: it stands under "Other assets" and never joins the main account', async ({ page }) => {
    await openStatement(page)
    await goToMonth(page, 'November 2026')
    const assets = page.getByRole('region', { name: 'Assets' })
    const moneyOut = page.getByRole('region', { name: 'Money out' })
    const dlg = page.getByRole('dialog')
    await expect(assets.locator('[data-line="other-assets"]')).toHaveCount(0)
    const current = assets.getByRole('button', { name: /^Main account balance:/ })
    await expect(current).toHaveAccessibleName('Main account balance: €0.00')

    await assets.getByRole('button', { name: 'Add account' }).click()
    await dlg.getByLabel('Type').selectOption('cash')
    // the form says what the type is before anything is saved
    await expect(dlg).toContainText('It has a balance of its own under Other assets, and an expense can come out of it.')
    await dlg.getByLabel('Name', { exact: true }).fill('Wallet')
    await dlg.getByLabel('Holds at the start of September 2026 (EUR)').fill('300')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()

    // its own line, under the heading for what the household owns beside its accounts
    await expect(assets.locator('[data-line="other-assets"]')).toContainText('€300.00')
    await expect(assets.getByRole('button', { name: 'Wallet balance: €300.00' })).toBeVisible()
    // the main account is what it was: the same name, the same figure, and nothing stands under it
    await expect(current).toHaveAccessibleName('Main account balance: €0.00')
    await expect(assets.locator('[data-line^="cur:"]')).toHaveCount(0)

    // an expense can come straight out of it
    await moneyOut.getByRole('button', { name: 'Living', exact: true }).click()
    await moneyOut.getByRole('button', { name: /^Health:/ }).click()
    await dlg.getByLabel('Comes out of', { exact: true }).selectOption({ label: 'Cash: Wallet' })
    await dlg.getByRole('textbox', { name: /^Amount in EUR/ }).fill('40')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    await expect(assets.getByRole('button', { name: 'Wallet balance: €260.00' })).toBeVisible()

    // and it is counted by itself: its own start and end of the month
    await assets.getByRole('button', { name: 'Wallet balance: €260.00' }).click()
    await expect(dlg.getByRole('heading', { name: 'Wallet · November 2026' })).toBeVisible()
    await dlg.getByLabel('At the end of November 2026 (EUR)').fill('250')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    await expect(assets.getByRole('button', { name: 'Wallet balance: €250.00, entered' })).toBeVisible()
    await page.screenshot({ path: 'e2e/output/statement-cash-account.png', fullPage: true })
  })

  test('an account\'s line opens its dialog when it is pressed, as a row does, and the arrow opens what is under it', async ({ page }) => {
    await openStatement(page)
    await goToMonth(page, 'November 2026')
    const assets = page.getByRole('region', { name: 'Assets' })
    const claims = page.getByRole('region', { name: 'Debts and net worth' })
    const dlg = page.getByRole('dialog')
    const name = dlg.getByLabel('Name', { exact: true })
    const cancel = async () => {
      await dlg.getByRole('button', { name: 'Cancel' }).click()
      await expect(dlg).toBeHidden()
    }

    // the name is the line's button, and it reaches over the whole line: a press beside the name opens the same dialog
    await assets.getByRole('button', { name: 'Edit Index fund' }).click()
    await expect(dlg.getByRole('heading', { name: 'Edit account' })).toBeVisible()
    await expect(name).toHaveValue('Index fund')
    await cancel()
    const fund = assets.locator('[data-line^="acc:"]').filter({ hasText: 'Index fund' })
    const box = (await fund.boundingBox())!
    await fund.click({ position: { x: box.width / 2, y: box.height / 2 } })
    await expect(name).toHaveValue('Index fund')
    await cancel()
    // what else is on the line keeps its own work: the amount is the month's balances, the "…" its menu
    await assets.getByRole('button', { name: /^Index fund balance:/ }).click()
    await expect(dlg.getByRole('heading', { name: 'Index fund · November 2026' })).toBeVisible()
    await cancel()
    await assets.getByRole('button', { name: 'Account menu for Index fund' }).click()
    await expect(page.getByRole('menuitem', { name: 'Edit…' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('menu')).toBeHidden()
    await expect(dlg).toBeHidden()

    // an account with virtual accounts under it: the line opens the account, the arrow opens and closes what is under it
    const under = assets.getByRole('button', { name: 'What is under Savings' })
    const pools = assets.locator('[data-line^="pool:"]')
    await expect(under).toHaveAttribute('aria-expanded', 'true')
    await expect(pools).toHaveCount(2)
    await assets.getByRole('button', { name: 'Edit Savings' }).click()
    await expect(name).toHaveValue('Savings')
    await cancel()
    await expect(pools).toHaveCount(2)
    await under.click()
    await expect(under).toHaveAttribute('aria-expanded', 'false')
    await expect(pools).toHaveCount(0)
    await under.click()
    await expect(pools).toHaveCount(2)

    // a virtual account opens its own dialog, and a card under Debts its own
    await assets.getByRole('button', { name: 'Edit Travel' }).click()
    await expect(dlg.getByRole('heading', { name: 'Edit virtual account' })).toBeVisible()
    await expect(name).toHaveValue('Travel')
    await cancel()
    await claims.getByRole('button', { name: 'Edit Credit card' }).click()
    await expect(name).toHaveValue('Credit card')
    await cancel()
    await page.screenshot({ path: 'e2e/output/statement-account-press.png', fullPage: true })

    // the main account: the calculated line is that account, and opens it
    const main = assets.locator('[data-line="main"]')
    await expect(main).toContainText('Main account')
    await main.getByRole('button', { name: 'Edit Main account' }).click()
    await expect(name).toHaveValue('Main account')
    await cancel()
    // what explains its figure opens from the arrow alone
    const details = main.getByRole('button', { name: 'What is under Main account' })
    await expect(details).toHaveAttribute('aria-expanded', 'false')
    await details.click()
    await expect(details).toHaveAttribute('aria-expanded', 'true')
    await expect(assets.getByText('At the start of the month')).toBeVisible()
    await details.click()
    await expect(details).toHaveAttribute('aria-expanded', 'false')
    await expect(assets.getByText('At the start of the month')).toHaveCount(0)
  })

  test('an account can be left out of net worth: it keeps its line, marked and grey, no total counts it, and pocket money lands in it', async ({ page }) => {
    await openStatement(page)
    await goToMonth(page, 'November 2026')
    const assets = page.getByRole('region', { name: 'Assets' })
    const claims = page.getByRole('region', { name: 'Debts and net worth' })
    const moneyIn = page.getByRole('region', { name: 'Money in' })
    const moneyOut = page.getByRole('region', { name: 'Money out' })
    const dlg = page.getByRole('dialog')
    const menu = page.getByRole('menu')
    const group = assets.locator('[data-line="savings-accounts"]')
    const netWorth = claims.locator('[data-line="net-worth"]')
    await expect(group).toContainText('€14,236.00')
    await expect(total(page, 'assets')).toContainText('€27,965.16')
    await expect(netWorth).toContainText('€27,965.16')

    // the box is with the account's other options, and says what it does before and after it is ticked
    await assets.getByRole('button', { name: 'Add account' }).click()
    await dlg.getByLabel('Name', { exact: true }).fill('Pocket savings')
    await dlg.getByLabel('Type').selectOption('savings')
    await dlg.getByLabel(/^Holds at the start of/).fill('2000')
    await expect(dlg.getByRole('button', { name: /^More options/ })).toContainText('net worth')
    await dlg.getByRole('button', { name: /^More options/ }).click()
    const box = dlg.getByRole('checkbox', { name: 'Leave out of net worth' })
    await expect(box).not.toBeChecked()
    await expect(dlg.getByTestId('acc-outside')).toHaveText('For money that is a person\'s own, like saved pocket money. The account keeps its balance, and net worth does not count it.')
    await box.check()
    await expect(dlg.getByTestId('acc-outside')).toHaveText('It keeps its balance and can still pay into the month, but no total counts it, and net worth does not either. Pocket money can land in it.')
    await settled(dlg)
    await dlg.screenshot({ path: 'e2e/output/account-outside-net-worth.png' })
    // an other current account holds money with a balance of its own too; the main account, the month's own money,
    // is not offered here at all, as the household has one
    await dlg.getByLabel('Type').selectOption('joint')
    await expect(box).toBeChecked()
    await expect(dlg.getByLabel('Type').locator('option', { hasText: /^Main account$/ })).toHaveCount(0)
    await dlg.getByLabel('Type').selectOption('savings')
    await expect(box).toBeChecked()
    await dlg.getByRole('button', { name: 'Save' }).click()
    // it is a person's own, so it is not asked how much of the household's money goes to it
    await expect(dlg).toBeHidden()

    // it stands under its own heading with the mark, and the heading, the total and net worth pass it by
    const line = assets.locator('[data-line^="acc:"]').filter({ hasText: 'Pocket savings' })
    await expect(line).toContainText('€2,000.00')
    await expect(line.getByRole('img', { name: 'Not in net worth' })).toBeVisible()
    await expect(assets.locator('[data-outside]')).toHaveCount(1)
    await expect(group).toContainText('€14,236.00')
    await expect(total(page, 'assets')).toContainText('€27,965.16')
    await expect(netWorth).toContainText('€27,965.16')
    // its figure is grey, as a figure in no sum is; the account above it is not
    const grey = await line.getByRole('button', { name: 'Pocket savings balance: €2,000.00' }).evaluate((el) => getComputedStyle(el).color)
    const plain = await assets.getByRole('button', { name: /^Index fund balance:/ }).evaluate((el) => getComputedStyle(el).color)
    expect(grey).not.toBe(plain)

    // pocket money lands in it: the row menu offers the accounts left out of net worth, and nothing else
    await moneyOut.getByRole('button', { name: 'Row menu for Sam – Pocket' }).click()
    await expect(menu.getByRole('menuitem', { name: 'Paid from…' })).toHaveCount(0)
    await menu.getByRole('menuitem', { name: 'Lands in…' }).click()
    await expect(dlg.getByRole('heading', { name: 'Lands in' })).toBeVisible()
    await expect(dlg.getByLabel('Lands in').locator('option')).toHaveText(['Nowhere', 'Pocket savings'])
    await dlg.getByLabel('Lands in').selectOption({ label: 'Pocket savings' })
    await dlg.getByRole('button', { name: 'Save' }).click()
    await saveAnyway(page)
    await expect(dlg).toBeHidden()
    // September and October brought 500 each, and so does November; the month and net worth are what they were
    await expect(line).toContainText('€3,500.00')
    await expect(moneyOut.getByRole('button', { name: 'Sam – Pocket: €500.00' })).toBeVisible()
    await expect(netWorth).toContainText('€27,965.16')
    // the row and the account point at each other
    await moneyOut.getByRole('button', { name: 'Lands in Pocket savings: go there' }).click()
    await expect(line).toHaveAttribute('data-marked', 'true')
    await expect(assets.getByRole('button', { name: 'Filled by Sam – Pocket: go there' })).toBeVisible()

    // money taken from it comes into the month under "From accounts", never as income, and net worth rises by it
    await expect(moneyIn.locator('[data-line="income"]')).toContainText('€7,405.00')
    await moneyIn.getByRole('button', { name: 'Add transfer row' }).click()
    await moneyIn.getByLabel('What the new transfer row does').selectOption({ label: 'Taken from a savings account' })
    // the form says what such a row takes from, since a virtual account cannot be picked here
    await expect(moneyIn.getByText('It comes out of what is not set aside there: a virtual account\'s money is used through an expense\'s "Comes out of".')).toBeVisible()
    await moneyIn.getByLabel('Account for the new transfer row').selectOption({ label: 'Pocket savings' })
    await moneyIn.getByRole('button', { name: 'Add', exact: true }).click()
    await expect(dlg.getByRole('heading', { name: 'From Pocket savings · November 2026' })).toBeVisible()
    await expect(dlg.getByRole('radio', { name: 'Only this month' })).toBeChecked()
    await dlg.getByLabel('Amount in EUR').fill('60')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    await expect(moneyIn.getByRole('button', { name: /^From Pocket savings: €60\.00/ })).toBeVisible()
    await expect(moneyIn.locator('[data-line="income"]')).toContainText('€7,405.00')
    await expect(line).toContainText('€3,440.00')
    await expect(netWorth).toContainText('€28,025.16')
    await page.screenshot({ path: 'e2e/output/statement-outside-net-worth.png', fullPage: true })

    // the box cannot be unticked while the pocket money lands there: the form says which row, and nothing changes
    await assets.getByRole('button', { name: 'Edit Pocket savings' }).click()
    await dlg.getByRole('checkbox', { name: 'Leave out of net worth' }).uncheck()
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg.getByRole('alert')).toHaveText('"Sam – Pocket" lands in "Pocket savings", and pocket money can only land in an account that is left out of net worth. Change "Lands in…" in the row\'s menu first.')
    await dlg.getByRole('button', { name: 'Cancel' }).click()
    await expect(line.getByRole('img', { name: 'Not in net worth' })).toBeVisible()

    // the legend names the mark
    await page.getByRole('button', { name: 'Colours and marks' }).click()
    await expect(page.getByText('Not in net worth, on the Statement: an account that is a person\'s own. Its figures are grey, and no total counts it')).toBeVisible()
    await page.keyboard.press('Escape')
  })

  test('a virtual account is a part of what its savings account holds: the form says how much is free and warns beyond it', async ({ page }) => {
    await openStatement(page)
    await goToMonth(page, 'November 2026')
    const assets = page.getByRole('region', { name: 'Assets' })
    const dlg = page.getByRole('dialog')
    await assets.getByRole('button', { name: 'Add virtual account' }).click()
    await dlg.getByLabel('Name').fill('Pocket')
    // what "Already in it" means is said under the field, with what the account has free this month
    await expect(dlg.getByTestId('pool-open-note')).toHaveText('A part of what "Savings" already holds: it adds no money to the account. "Savings" has €13,726.00 that is not set aside.')
    await dlg.getByLabel('Already in it (EUR)').fill('500')
    await expect(dlg.getByTestId('pool-open-warning')).toHaveCount(0)
    // more than that is said at once, and can still be saved
    await dlg.getByLabel('Already in it (EUR)').fill('20000')
    await expect(dlg.getByTestId('pool-open-warning')).toHaveText('That is more than "Savings" has free, so its "Not set aside" will go below zero. For money that is kept somewhere else, add an account instead.')
    await settled(dlg)
    await dlg.screenshot({ path: 'e2e/output/pool-already-in-it.png' })
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    // the red figure says why it is red
    const free = assets.locator('[data-line^="free:"]')
    await expect(free).toContainText('more is set aside than the account holds')
    await expect(free).toContainText('-€6,274.00')
  })

  test('the main account takes its real balance: the difference shows, the next month continues, and it can be taken back', async ({ page }) => {
    await openStatement(page)
    await goToMonth(page, 'November 2026')
    const assets = page.getByRole('region', { name: 'Assets' })
    const line = assets.locator('[data-line="main"]')
    const dlg = page.getByRole('dialog')
    const sameTotals = async () => expect((await total(page, 'assets').innerText()).replace(/^Total\s*/, '')).toBe((await total(page, 'claims').innerText()).replace(/^Total\s*/, ''))

    // worked out until someone says what the bank says
    await expect(line).toContainText('calculated')
    await assets.getByRole('button', { name: 'Main account balance: €0.00' }).click()
    await expect(dlg.getByRole('heading', { name: 'Main account · November 2026' })).toBeVisible()
    // one account, one number: the plan's own figure stands in its field, in grey
    await expect(dlg.getByTestId('current-together')).toHaveCount(0)
    const mainEnd = dlg.getByLabel('At the end of November 2026 (EUR)')
    await expect(mainEnd).toHaveAttribute('placeholder', '€0.00')
    await mainEnd.fill('abc')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg.getByRole('alert')).toHaveText('That is not a number I can read.')
    await mainEnd.fill('1150')
    await expect(dlg).toHaveCSS('opacity', '1')
    await page.screenshot({ path: 'e2e/output/statement-current-balance-dialog.png' })
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()

    // the line reads like any other entered balance, its parts add up, and both sides still agree
    const entered = assets.getByRole('button', { name: 'Main account balance: €1,150.00, entered' })
    await expect(entered).toBeVisible()
    await expect(line).toContainText('entered, +€1,150.00 against the plan')
    await expect(line).not.toContainText('calculated')
    await line.getByRole('button', { name: 'What is under Main account' }).click()
    await expect(assets.locator('[data-line="main:adjustment"]')).toHaveText('Not in the plan€1,150.00')
    // no account stands under it
    await expect(assets.locator('[data-line^="cur:"]')).toHaveCount(0)
    await sameTotals()
    await page.screenshot({ path: 'e2e/output/statement-current-balance.png', fullPage: true })

    // December is worked out again, from the real number
    await stepMonth(page, 1)
    await expect(page.getByRole('heading', { level: 2, name: 'December 2026' })).toBeVisible()
    await expect(line).toContainText('calculated')
    await expect(assets.locator('[data-line="main:start"]')).toContainText('€1,150.00')
    await sameTotals()
    await stepMonth(page, -1)

    // back to the calculated amount, in one step that Undo takes back
    await entered.click()
    await expect(mainEnd).toHaveValue('1150')
    await mainEnd.fill('')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    await expect(assets.getByRole('button', { name: 'Main account balance: €0.00' })).toBeVisible()
    await expect(line).toContainText('calculated')
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect(entered).toBeVisible()
  })

  test('"Balances…" asks what every account held at the start and at the end, counts a month that is over as done, and the next month starts with it', async ({ page }) => {
    await openStatement(page)
    await goToMonth(page, 'November 2026')
    const assets = page.getByRole('region', { name: 'Assets' })
    const fund = assets.getByRole('button', { name: /^Index fund balance:/ })
    const closing = page.getByTestId('month-balances-dialog')
    const progress = page.getByTestId('progress')
    const calculatedLine = await fund.getAttribute('aria-label')
    const open = (await progress.textContent())!
    expect(open).toMatch(/^\d+ of \d+ done/)

    await page.getByRole('button', { name: 'Balances…' }).click()
    await expect(closing.getByRole('heading', { name: 'Balances for November 2026' })).toBeVisible()
    // every account that has a balance, under the headings of the page
    for (const heading of ['Savings accounts', 'Investment accounts', 'Debts']) await expect(closing.getByText(heading, { exact: true })).toBeVisible()
    // the main account comes first, with the plan's own figure in its fields
    await expect(closing.getByTestId('current-together')).toHaveCount(0)
    await expect(closing.getByLabel('Main account: at the end of November 2026 (EUR)')).toHaveAttribute('placeholder', '€0.00')
    const fundStart = closing.getByLabel('Index fund: at the start of November 2026 (EUR)')
    const fundEnd = closing.getByLabel('Index fund: at the end of November 2026 (EUR)')
    // nothing is typed: an empty field shows the calculated amount in grey and keeps it
    await expect(fundStart).toHaveValue('')
    await expect(fundEnd).toHaveValue('')
    const calculated = (await fundEnd.getAttribute('placeholder'))!
    expect(calculated).toMatch(/^€[\d,]+\.\d\d$/)
    expect(calculatedLine).toBe(`Index fund balance: ${calculated}`)
    // a typed start moves the calculated end at once, and an emptied one gives it back
    await fundStart.fill('13000')
    await expect(fundEnd).not.toHaveAttribute('placeholder', calculated)
    await fundStart.fill('')
    await expect(fundEnd).toHaveAttribute('placeholder', calculated)
    // a sum is worked out, and the difference to the calculated amount shows under the field
    await fundEnd.fill('13900+100')
    const endCell = closing.getByTestId('balance-end').filter({ has: page.getByLabel('Index fund: at the end of November 2026 (EUR)') })
    await expect(endCell.getByTestId('amount-hint')).toHaveText('= €14,000.00')
    await expect(endCell.getByTestId('balance-note')).toHaveText(/^Difference \+€[\d,]+\.\d\d$/)
    // November is the current month: counting all of it as done is offered, and not set
    const tick = closing.getByRole('checkbox', { name: 'Count everything in November as done' })
    await expect(tick).not.toBeChecked()
    await expect(closing.getByText('Ticks every line of the month. No amount changes.')).toBeVisible()
    await settled(closing)
    await page.screenshot({ path: 'e2e/output/month-balances-dialog.png' })
    await closing.getByRole('button', { name: 'Save' }).click()
    await expect(closing).toBeHidden()
    await expect(fund).toHaveAccessibleName('Index fund balance: €14,000.00, entered')
    // nothing was ticked, and every line can still be changed
    await expect(progress).toHaveText(open)

    // Undo takes the balance back, Redo brings it again
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect(fund).toHaveAccessibleName(calculatedLine!)
    await page.getByRole('button', { name: 'Redo' }).click()
    await expect(fund).toHaveAccessibleName('Index fund balance: €14,000.00, entered')

    // December starts with what November ended on
    await stepMonth(page, 1)
    await expect(page.getByRole('heading', { level: 2, name: 'December 2026' })).toBeVisible()
    await fund.click()
    const dlg = page.getByRole('dialog')
    await expect(dlg.getByRole('heading', { name: 'Index fund · December 2026' })).toBeVisible()
    const start = dlg.getByLabel('At the start of December 2026 (EUR)')
    await expect(start).toHaveValue('14000')
    await expect(dlg.getByLabel('At the end of December 2026 (EUR)')).toHaveValue('')
    // and the start can be corrected from here: it is November's end
    await start.fill('14250')
    await settled(dlg)
    await page.screenshot({ path: 'e2e/output/balance-start-end-dialog.png' })
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    await stepMonth(page, -1)
    await expect(page.getByRole('heading', { level: 2, name: 'November 2026' })).toBeVisible()
    await expect(fund).toHaveAccessibleName('Index fund balance: €14,250.00, entered')

    // October is over: the tick is set, and one Save keeps the balance and counts the whole month as done
    await stepMonth(page, -1)
    await expect(page.getByRole('heading', { level: 2, name: 'October 2026' })).toBeVisible()
    const october = (await progress.textContent())!
    expect(october).toMatch(/^\d+ of \d+ done/)
    await page.getByRole('button', { name: 'Balances…' }).click()
    await expect(closing.getByRole('heading', { name: 'Balances for October 2026' })).toBeVisible()
    await expect(closing.getByRole('checkbox', { name: 'Count everything in October as done' })).toBeChecked()
    await closing.getByLabel('Savings: at the end of October 2026 (EUR)').fill('9000')
    await closing.getByRole('button', { name: 'Save' }).click()
    await expect(closing).toBeHidden()
    await expect(progress).toHaveText(/^All \d+ done$/)
    const savings = assets.getByRole('button', { name: /^Savings balance:/ })
    await expect(savings).toHaveAccessibleName('Savings balance: €9,000.00, entered')
    // with everything ticked there is nothing left to offer
    await page.getByRole('button', { name: 'Balances…' }).click()
    await expect(closing.getByRole('checkbox')).toHaveCount(0)
    await closing.getByRole('button', { name: 'Cancel' }).click()
    // one step: Undo takes the balance and every tick back
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect(progress).toHaveText(october)
    await expect(savings).not.toHaveAccessibleName(/entered/)
  })

  test('a rule per account: a percentage from the transfer line, another from the account, and the rest follows', async ({ page }) => {
    await openStatement(page)
    await goToMonth(page, 'November 2026')
    const moneyOut = page.getByRole('region', { name: 'Money out' })
    const assets = page.getByRole('region', { name: 'Assets' })
    const dlg = page.getByRole('dialog')
    const rest = async () => euros(await moneyOut.locator('[data-line]').filter({ has: page.locator('[data-rule="rest"]') }).innerText())
    const balanced = async () => expect((await total(page, 'in').innerText()).replace(/^Total in\s*/, '')).toBe((await total(page, 'out').innerText()).replace(/^Total out\s*/, ''))

    // every transfer to an account, and the account it feeds, carries its rule as a symbol with a name
    await expect(moneyOut.getByRole('button', { name: 'Rule for To savings: the rest' })).toBeVisible()
    await expect(assets.getByRole('button', { name: 'Rule for Savings: the rest' })).toBeVisible()
    await expect(assets.getByRole('button', { name: 'Rule for Index fund: a fixed amount' })).toBeVisible()
    await expect(assets.getByRole('button', { name: 'Rule for Clothing: a fixed amount' })).toBeVisible()
    await expect(moneyOut.getByText('the rest', { exact: true })).toHaveCount(0)
    expect(await rest()).toBe(2369)

    // one dialog per row: the name, the amount and the rule symbol all open it, with how the amount is set on top
    await moneyOut.getByRole('button', { name: /^To investments: €500\.00/ }).click()
    await expect(dlg.getByRole('heading', { name: 'To investments · November 2026' })).toBeVisible()
    await expect(dlg.getByRole('radiogroup', { name: 'How the amount is set' }).getByRole('radio')).toHaveText(['A fixed amount', 'A percentage of income', 'A percentage of one income', 'A percentage of what is left', 'The rest'])
    await expect(dlg.getByRole('radiogroup', { name: 'Repeats' }).getByRole('radio')).toHaveText(['This and following months', 'Only this month'])
    await dlg.getByRole('button', { name: 'Cancel' }).click()
    await expect(dlg).toBeHidden()
    const investments = moneyOut.locator('[data-line]').filter({ has: page.getByRole('button', { name: /^To investments:/ }) })
    const box = (await investments.boundingBox())!
    await investments.click({ position: { x: box.width - 20, y: box.height / 2 } })
    await expect(dlg.getByRole('heading', { name: 'To investments · November 2026' })).toBeVisible()
    await dlg.getByRole('button', { name: 'Cancel' }).click()
    await expect(dlg).toBeHidden()

    // 10 % of income for the investments, from this month on
    await moneyOut.getByRole('button', { name: 'Rule for To investments: a fixed amount' }).click()
    await expect(dlg.getByRole('heading', { name: 'To investments · November 2026' })).toBeVisible()
    await expect(dlg.getByRole('radio', { name: 'A fixed amount' })).toBeChecked()
    await expect(dlg.getByLabel('Amount in EUR')).toHaveValue('500')
    // every account a rule can feed may take the rest
    await expect(dlg.getByRole('radio', { name: 'The rest' })).toBeVisible()
    await dlg.getByRole('radio', { name: 'A percentage of income' }).click()
    // the fields of the amount make way for the rule's
    await expect(dlg.getByLabel('Amount in EUR')).toHaveCount(0)
    await expect(dlg.getByRole('radiogroup', { name: 'Repeats' })).toHaveCount(0)
    await expect(dlg.getByRole('button', { name: 'Save' })).toBeDisabled()
    await dlg.getByLabel('Percentage of income').fill('120')
    await expect(dlg.getByRole('alert')).toContainText('above 0 and at most 100')
    await dlg.getByLabel('Percentage of income').fill('10')
    await expect(dlg.getByRole('alert')).toHaveCount(0)
    await expect(dlg.getByLabel('Counts from: month')).toHaveValue('11')
    await expect(dlg.getByTestId('rule-preview')).toContainText('10% of €7,405.00 take-home income')
    await expect(dlg.getByTestId('rule-amount')).toHaveText('€740.50')
    await expect(dlg.getByTestId('rule-rest')).toHaveText('€2,128.50')
    await expect(dlg).toHaveCSS('opacity', '1')
    await page.screenshot({ path: 'e2e/output/statement-rule-dialog.png' })
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    await expect(moneyOut.getByRole('button', { name: 'To investments: €740.50' })).toBeVisible()
    await expect(moneyOut.getByRole('button', { name: 'Rule for To investments: 10% of income' })).toBeVisible()
    await expect(assets.getByRole('button', { name: 'Rule for Index fund: 10% of income' })).toBeVisible()
    // what the investments get more, the rest gets less
    expect(await rest()).toBe(2128.5)
    await balanced()

    // a worked-out line opens the same dialog on its rule
    await moneyOut.getByRole('button', { name: 'To investments: €740.50' }).click()
    await expect(dlg.getByRole('heading', { name: 'To investments · November 2026' })).toBeVisible()
    await expect(dlg).toContainText('Worked out by the app · currently €740.50')
    await expect(dlg.getByRole('radio', { name: 'A percentage of income' })).toBeChecked()
    await expect(dlg.getByLabel('Percentage of income')).toHaveValue('10')
    await dlg.getByRole('button', { name: 'Cancel' }).click()

    // from the account: its symbol opens the dialog of the row that fills it; the Travel virtual account takes a fifth of what is left
    await assets.getByRole('button', { name: 'Rule for Travel: a fixed amount' }).click()
    await expect(dlg.getByRole('heading', { name: 'To Travel · November 2026' })).toBeVisible()
    await dlg.getByRole('radio', { name: 'A percentage of what is left' }).click()
    await dlg.getByLabel('Percentage of what is left').fill('20')
    // its own €200 goes back into what is left first: 2,128.50 + 200
    await expect(dlg.getByTestId('rule-preview')).toContainText('20% of €2,328.50 left')
    await expect(dlg.getByTestId('rule-amount')).toHaveText('€465.70')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    await expect(moneyOut.getByRole('button', { name: 'To Travel: €465.70' })).toBeVisible()
    await expect(moneyOut.getByRole('button', { name: 'Rule for To Travel: 20% of what is left' })).toBeVisible()
    expect(await rest()).toBe(1862.8)
    await balanced()
    await page.screenshot({ path: 'e2e/output/statement-rules.png', fullPage: true })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({ path: 'e2e/output/statement-rules-phone.png', fullPage: true })
    await page.setViewportSize({ width: 1440, height: 900 })

    // the month before keeps what it showed, and December follows the rules
    await goToMonth(page, 'October 2026')
    await expect(moneyOut.getByRole('button', { name: /^To investments: €500\.00/ })).toBeVisible()
    await expect(moneyOut.getByRole('button', { name: /^To Travel: €200\.00/ })).toBeVisible()
    expect(await rest()).toBe(2009)
    // its typed amount is for that month alone, so the dialog does not ask which months it applies to
    await moneyOut.getByRole('button', { name: /^To investments: €500\.00/ }).click()
    await expect(dlg.getByLabel('Amount in EUR')).toHaveValue('500')
    await expect(dlg.getByTestId('rule-runs')).toContainText('for October 2026 alone')
    await expect(dlg.getByRole('radiogroup', { name: 'Repeats' })).toHaveCount(0)
    await dlg.getByRole('button', { name: 'Cancel' }).click()
    await goToMonth(page, 'December 2026')
    await expect(moneyOut.getByRole('button', { name: 'To investments: €740.50' })).toBeVisible()
    await balanced()

    // a month that is over shows its rules and offers the same dialog
    await goToMonth(page, 'September 2026')
    await expect(moneyOut.locator('[data-rule="rest"]')).toBeVisible()
    await expect(page.getByRole('button', { name: /^Rule for / })).not.toHaveCount(0)

    // the Grid says the same and offers the same dialog
    await page.getByRole('navigation', { name: 'Screens' }).getByRole('link', { name: 'Grid' }).click()
    await expect(page.getByText('= 10% of income')).toBeVisible()
    await expect(page.getByText('= 20% of what is left')).toBeVisible()
    await page.getByRole('button', { name: 'Row menu for To investments' }).click()
    await page.getByRole('menuitem', { name: 'Rule…' }).click()
    await expect(dlg.getByRole('heading', { name: 'To investments · November 2026' })).toBeVisible()
    await expect(dlg.getByLabel('Percentage of income')).toHaveValue('10')
    await dlg.getByRole('button', { name: 'Cancel' }).click()
  })

  test('a percentage of one income: all of the child benefit goes to the investments, and follows that line', async ({ page }) => {
    await openStatement(page)
    await goToMonth(page, 'November 2026')
    const moneyIn = page.getByRole('region', { name: 'Money in' })
    const moneyOut = page.getByRole('region', { name: 'Money out' })
    const assets = page.getByRole('region', { name: 'Assets' })
    const dlg = page.getByRole('dialog')
    const rest = async () => euros(await moneyOut.locator('[data-line]').filter({ has: page.locator('[data-rule="rest"]') }).innerText())
    expect(await rest()).toBe(2369)

    await moneyOut.getByRole('button', { name: /^To investments: €500\.00/ }).click()
    await dlg.getByRole('radio', { name: 'A percentage of one income' }).click()
    await expect(dlg).toContainText('A share of one income line: what it brings in, minus what is deducted from it.')
    // the list holds the income lines, and nothing that only takes money out of an account
    await expect(dlg.getByLabel('Which income').locator('option')).toHaveText(['Sam – Salary', 'Alex – Salary', 'Robin – Child benefit', 'Other income'])
    await dlg.getByLabel('Which income').selectOption({ label: 'Robin – Child benefit' })
    await expect(dlg.getByRole('button', { name: 'Save' })).toBeDisabled()
    await dlg.getByLabel('Percentage of that income').fill('100')
    await expect(dlg.getByTestId('rule-preview')).toContainText('100% of €255.00, Robin – Child benefit')
    await expect(dlg.getByTestId('rule-amount')).toHaveText('€255.00')
    // what the investments get less than their €500, the rest gets more
    await expect(dlg.getByTestId('rule-rest')).toHaveText('€2,614.00')
    await expect(dlg).toHaveCSS('opacity', '1')
    await page.screenshot({ path: 'e2e/output/statement-income-rule-dialog.png' })
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()

    // the line and the account it fills say the rule by the income's name
    await expect(moneyOut.getByRole('button', { name: 'To investments: €255.00' })).toBeVisible()
    await expect(moneyOut.getByRole('button', { name: 'Rule for To investments: 100% of Robin – Child benefit' })).toBeVisible()
    await expect(assets.getByRole('button', { name: 'Rule for Index fund: 100% of Robin – Child benefit' })).toBeVisible()
    expect(await rest()).toBe(2614)
    await page.screenshot({ path: 'e2e/output/statement-income-rule.png', fullPage: true })

    // the transfer follows its income: a raise of the benefit is a raise of the transfer, and the rest stays as it was
    await moneyIn.getByRole('button', { name: /^Robin – Child benefit: €255\.00/ }).click()
    await dlg.getByLabel('Amount in EUR').fill('300')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    await expect(moneyOut.getByRole('button', { name: 'To investments: €300.00' })).toBeVisible()
    expect(await rest()).toBe(2614)
    expect((await total(page, 'in').innerText()).replace(/^Total in\s*/, '')).toBe((await total(page, 'out').innerText()).replace(/^Total out\s*/, ''))

    // the dialog opens on the rule with its income, on a phone too
    await page.setViewportSize({ width: 390, height: 844 })
    await moneyOut.getByRole('button', { name: 'To investments: €300.00' }).click()
    await expect(dlg.getByRole('radio', { name: 'A percentage of one income' })).toBeChecked()
    await expect(dlg.getByLabel('Which income')).toHaveValue(/.+/)
    await expect(dlg.getByLabel('Which income').locator('option:checked')).toHaveText('Robin – Child benefit')
    await expect(dlg.getByLabel('Percentage of that income')).toHaveValue('100')
    await expect(dlg).toHaveCSS('opacity', '1')
    await page.screenshot({ path: 'e2e/output/statement-income-rule-dialog-phone.png' })
    await dlg.getByRole('button', { name: 'Cancel' }).click()
    await page.setViewportSize({ width: 1440, height: 900 })

    // the month before keeps its €500, and the Grid names the rule the same way
    await goToMonth(page, 'October 2026')
    await expect(moneyOut.getByRole('button', { name: /^To investments: €500\.00/ })).toBeVisible()
    await page.getByRole('navigation', { name: 'Screens' }).getByRole('link', { name: 'Grid' }).click()
    await expect(page.getByText('= 100% of Robin – Child benefit')).toBeVisible()
  })

  test('pocket money by rule: a percentage of the adult\'s own income from the pocket line, never the rest', async ({ page }) => {
    await openStatement(page)
    await goToMonth(page, 'November 2026')
    const moneyOut = page.getByRole('region', { name: 'Money out' })
    const dlg = page.getByRole('dialog')
    await expect(moneyOut.getByRole('button', { name: 'To savings: €2,369.00' })).toBeVisible()

    // a pocket line carries the rule symbol, like a transfer to an account
    await moneyOut.getByRole('button', { name: 'Rule for Sam – Pocket: a fixed amount' }).click()
    await expect(dlg.getByRole('heading', { name: 'Sam – Pocket · November 2026' })).toBeVisible()
    await expect(dlg.getByRole('radiogroup', { name: 'How the amount is set' }).getByRole('radio')).toHaveText(['A fixed amount', 'A percentage of income', 'A percentage of Sam\'s income', 'A percentage of one income', 'A percentage of what is left'])
    await expect(dlg.getByRole('radio', { name: 'A fixed amount' })).toBeChecked()
    await expect(dlg.getByLabel('Amount in EUR')).toHaveValue('500')
    await expect(dlg).toHaveCSS('opacity', '1')
    await page.screenshot({ path: 'e2e/output/statement-row-dialog.png' })
    await dlg.getByRole('radio', { name: 'A percentage of Sam\'s income' }).click()
    await expect(dlg).toContainText('the income lines that belong to them')
    await dlg.getByLabel('Percentage of Sam\'s income').fill('10')
    await expect(dlg.getByTestId('rule-preview')).toContainText('10% of €4,200.00, Sam\'s take-home income')
    await expect(dlg.getByTestId('rule-amount')).toHaveText('€420.00')
    await expect(dlg.getByTestId('rule-rest')).toHaveText('€2,449.00')
    await expect(dlg).toHaveCSS('opacity', '1')
    await page.screenshot({ path: 'e2e/output/statement-pocket-rule-dialog.png' })
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()

    // the line shows the rule and its amount, and the rest follows
    await expect(moneyOut.getByRole('button', { name: 'Rule for Sam – Pocket: 10% of their own income' })).toBeVisible()
    await expect(moneyOut.getByRole('button', { name: 'Sam – Pocket: €420.00' })).toBeVisible()
    await expect(moneyOut.getByRole('button', { name: 'Alex – Pocket: €500.00' })).toBeVisible()
    await expect(moneyOut.getByRole('button', { name: 'To savings: €2,449.00' })).toBeVisible()
    await page.screenshot({ path: 'e2e/output/statement-pocket-rule.png' })
    // a line a rule works out opens the same dialog on its rule
    await moneyOut.getByRole('button', { name: 'Sam – Pocket: €420.00' }).click()
    await expect(dlg.getByRole('heading', { name: 'Sam – Pocket · November 2026' })).toBeVisible()
    await expect(dlg.getByRole('radio', { name: 'A percentage of Sam\'s income' })).toBeChecked()
    await expect(dlg.getByLabel('Percentage of Sam\'s income')).toHaveValue('10')
    await dlg.getByRole('button', { name: 'Cancel' }).click()
    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({ path: 'e2e/output/statement-pocket-rule-phone.png', fullPage: true })
    // the one dialog on a phone, with the amount's fields
    await moneyOut.getByRole('button', { name: 'Alex – Pocket: €500.00' }).click()
    await expect(dlg.getByRole('heading', { name: 'Alex – Pocket · November 2026' })).toBeVisible()
    await expect(dlg.getByLabel('Amount in EUR')).toHaveValue('500')
    await expect(dlg).toHaveCSS('opacity', '1')
    await page.screenshot({ path: 'e2e/output/statement-row-dialog-phone.png' })
    await dlg.getByRole('button', { name: 'Cancel' }).click()
    await expect(dlg).toBeHidden()
    await page.setViewportSize({ width: 1400, height: 900 })

    // the month before keeps what it showed
    await stepMonth(page, -1)
    await expect(page.getByRole('heading', { level: 2, name: 'October 2026' })).toBeVisible()
    await expect(moneyOut.getByRole('button', { name: 'Sam – Pocket: €500.00' })).toBeVisible()
  })

  test('accounts, virtual accounts, cards and loans are added in the lower half; a new savings account is asked how much goes to it', async ({ page }) => {
    await openStatement(page)
    await goToMonth(page, 'November 2026')
    const moneyOut = page.getByRole('region', { name: 'Money out' })
    const assets = page.getByRole('region', { name: 'Assets' })
    const claims = page.getByRole('region', { name: 'Debts and net worth' })
    const dlg = page.getByRole('dialog')

    // under Assets: what the household has. The short form asks the name, the type and what it holds
    await assets.getByRole('button', { name: 'Add account' }).click()
    await expect(dlg.getByRole('heading', { name: 'New account' })).toBeVisible()
    // the household has its main account: a second one is not offered (rule B9)
    await expect(dlg.getByLabel('Type').locator('option')).toHaveText(['Other current account', 'Savings', 'Investments', 'Other asset', 'Cash'])
    await dlg.getByLabel('Name', { exact: true }).fill('Rainy day')
    await dlg.getByLabel('Type').selectOption('savings')
    await dlg.getByLabel('Holds at the start of September 2026 (EUR)').fill('1000')
    await expect(dlg.getByLabel('Currency')).toHaveCount(0)
    await dlg.getByRole('button', { name: /^More options/ }).click()
    await expect(dlg.getByLabel('Currency')).toHaveValue('EUR')
    await expect(dlg).toHaveCSS('opacity', '1')
    await page.screenshot({ path: 'e2e/output/statement-account-dialog.png' })
    await dlg.getByRole('button', { name: 'Save' }).click()

    // a savings account is asked straight away how much goes to it; the rest is already taken, so it starts on an amount
    await expect(dlg.getByRole('heading', { name: 'How much goes to Rainy day?' })).toBeVisible()
    await expect(dlg.getByRole('radio', { name: 'A fixed amount' })).toBeChecked()
    await dlg.getByLabel('Amount per month in EUR').fill('50')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    // 1,000 when September began, and 50 a month from November on
    await expect(assets.locator('[data-line^="acc:"]').filter({ hasText: 'Rainy day' })).toContainText('€1,050.00')
    await expect(moneyOut.getByRole('button', { name: 'To Rainy day: €50.00' })).toBeVisible()
    await expect(assets.getByRole('button', { name: 'Rule for Rainy day: a fixed amount' })).toBeVisible()

    // a virtual account inside it, set aside from the month on screen
    await assets.getByRole('button', { name: 'Add virtual account' }).click()
    await expect(dlg.getByRole('heading', { name: 'New virtual account' })).toBeVisible()
    await dlg.getByLabel('Name').fill('Gifts')
    await dlg.getByLabel('Held in').selectOption({ label: 'Rainy day' })
    await expect(dlg.getByLabel('Set aside each month (EUR)')).toHaveAttribute('placeholder', 'optional, from Nov 2026 on')
    await dlg.getByLabel('Set aside each month (EUR)').fill('20')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    await expect(assets.locator('[data-line^="pool:"]').filter({ hasText: 'Gifts' })).toContainText('€20.00')
    await expect(moneyOut.getByRole('button', { name: 'To Gifts: €20.00' })).toBeVisible()

    // under Debts: a card or a loan, and nothing else
    await claims.getByRole('button', { name: 'Add a card or loan' }).click()
    await expect(dlg.getByLabel('Type').locator('option')).toHaveText(['Credit card', 'Loan'])
    // a card is asked nothing about what is recorded for it: it is a debt, and its type says when it needs no account
    await expect(dlg.getByRole('radiogroup')).toHaveCount(0)
    await expect(dlg.getByTestId('acc-type-help')).toContainText('A card you pay off in full every month needs no account')
    await dlg.getByLabel('Name', { exact: true }).fill('Car loan')
    await dlg.getByLabel('Type').selectOption('loan')
    await dlg.getByLabel('Owed at the start of September 2026 (EUR)').fill('5000')
    // a loan comes with the row that pays it off, unless the box is unticked
    await expect(dlg.getByRole('checkbox', { name: 'Add the row that pays it off' })).toBeChecked()
    await expect(dlg.getByTestId('acc-row')).toHaveText('"Car loan – Payment". Each payment brings down what is owed.')
    await dlg.getByRole('button', { name: 'Save' }).click()
    // one Save made both, and the row asks for its amount
    await expect(dlg.getByRole('heading', { name: 'Car loan – Payment · November 2026' })).toBeVisible()
    // the payment is part of what the month costs, so it has a category like any expense: none yet, and one can be picked here
    const loanCategory = dlg.getByLabel('Category of Car loan – Payment')
    await expect(loanCategory.locator('option:checked')).toHaveText('No category')
    await dlg.getByLabel('Amount in EUR').fill('250')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    const payment = moneyOut.getByRole('button', { name: /^Car loan – Payment: €250\.00/ })
    await expect(payment).toBeVisible()
    await expect(moneyOut.getByRole('button', { name: 'No category', exact: true })).toHaveAttribute('aria-expanded', 'true')
    const carLoan = claims.locator('[data-line^="acc:"]').filter({ hasText: 'Car loan' })
    await expect(carLoan).toContainText('€4,750.00')
    // it moves under "Transport", beside what the car costs
    await payment.click()
    await loanCategory.selectOption({ label: 'Transport' })
    await expect(dlg.getByTestId('category-note')).toHaveText('Once saved, this row is under Transport, in every month.')
    await settled(dlg)
    await dlg.screenshot({ path: 'e2e/output/cell-category-loan.png' })
    await dlg.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(dlg).toBeHidden()
    await expect(moneyOut.getByRole('button', { name: 'Transport', exact: true })).toHaveAttribute('aria-expanded', 'true')
    await expect(payment).toBeVisible()
    await expect(moneyOut.locator('[data-line^="cat:expense:"]').filter({ hasText: 'Transport' })).toContainText('€348.00')
    // it folds away with "Transport" and with nothing else
    await moneyOut.getByRole('button', { name: 'Transport', exact: true }).click()
    await expect(payment).toHaveCount(0)
    await moneyOut.getByRole('button', { name: 'Transport', exact: true }).click()
    await expect(payment).toBeVisible()
    await expect(carLoan).toContainText('€4,750.00')
    // its form names the row that pays it off
    await editFrom(page, claims, 'Car loan')
    await expect(dlg.getByTestId('acc-paid-by')).toHaveText('Paid off by "Car loan – Payment".')
    await dlg.getByRole('button', { name: 'Cancel' }).click()

    // not mandatory: a card added without its row gets one later from its form
    await claims.getByRole('button', { name: 'Add a card or loan' }).click()
    await dlg.getByLabel('Name', { exact: true }).fill('Visa')
    await dlg.getByRole('checkbox', { name: 'Add the row that pays it off' }).uncheck()
    await expect(dlg.getByTestId('acc-row')).toHaveText('No row yet. One can be added later from this form.')
    // a card says what is owed on it, as a loan does: a payment stops at that amount
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg.getByRole('alert')).toContainText('Type what is still owed on the card')
    await dlg.getByLabel('Owed at the start of September 2026 (EUR)').fill('300')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    await expect(moneyOut.getByRole('button', { name: /^Visa – Payment/ })).toHaveCount(0)
    await editFrom(page, claims, 'Visa')
    await expect(dlg.getByTestId('acc-paid-by')).toContainText('No row pays this off yet.')
    await dlg.getByRole('button', { name: 'Add the row that pays it off' }).click()
    // the payment stands with the expenses and brings the card down, as the loan's does
    await expect(dlg.getByRole('heading', { name: 'Visa – Payment · November 2026' })).toBeVisible()
    await dlg.getByLabel('Amount in EUR').fill('100')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    await expect(moneyOut.getByRole('button', { name: /^Visa – Payment: €100\.00/ })).toBeVisible()
    await expect(claims.locator('[data-line^="acc:"]').filter({ hasText: 'Visa' })).toContainText('€200.00')
    const assetsTotal = (await total(page, 'assets').innerText()).replace(/^Total\s*/, '')
    expect(assetsTotal).toBe((await total(page, 'claims').innerText()).replace(/^Total\s*/, ''))

    // accounts move among those under the same heading: the two savings accounts, and the two debts
    const under = (side: Locator, heading: string) => side.locator(`li:has(> [data-line="${heading}"]) > div > ul > li > [data-line^="acc:"]`)
    await expect(under(assets, 'savings-accounts')).toHaveText([/^Savings/, /^Rainy day/])
    await assets.getByRole('button', { name: 'Account menu for Rainy day' }).click()
    // each menu by its name: a menu that is closing stays in the page for a moment, with the same items
    const rainyMenu = page.getByRole('menu', { name: 'Account menu for Rainy day' })
    await expect(rainyMenu.getByRole('menuitem', { name: 'Move down' })).toBeDisabled()
    await rainyMenu.getByRole('menuitem', { name: 'Move up' }).click()
    await expect(under(assets, 'savings-accounts')).toHaveText([/^Rainy day/, /^Savings/])
    await expect(under(claims, 'debts')).toHaveText([/^Credit card/, /^Car loan/, /^Visa/])
    await claims.getByRole('button', { name: 'Account menu for Car loan' }).click()
    await page.getByRole('menu', { name: 'Account menu for Car loan' }).getByRole('menuitem', { name: 'Move down' }).click()
    await expect(under(claims, 'debts')).toHaveText([/^Credit card/, /^Visa/, /^Car loan/])
    // the order is the household's: it is the same after the page is loaded again, and the totals did not move
    await page.reload()
    await expect(under(assets, 'savings-accounts')).toHaveText([/^Rainy day/, /^Savings/])
    await expect(under(claims, 'debts')).toHaveText([/^Credit card/, /^Visa/, /^Car loan/])
    expect((await total(page, 'assets').innerText()).replace(/^Total\s*/, '')).toBe(assetsTotal)
    await page.screenshot({ path: 'e2e/output/statement-account-order.png', fullPage: true })
    await page.screenshot({ path: 'e2e/output/statement-accounts.png', fullPage: true })
  })

  test('a card that is really a loan is made one from its form, and the row that pays it off follows; a type that would leave a row behind is refused', async ({ page }) => {
    await openStatement(page)
    await goToMonth(page, 'November 2026')
    const moneyOut = page.getByRole('region', { name: 'Money out' })
    const assets = page.getByRole('region', { name: 'Assets' })
    const claims = page.getByRole('region', { name: 'Debts and net worth' })
    const dlg = page.getByRole('dialog')

    // a card that carries a debt: the payment is the spending, and brings down what is owed
    await claims.getByRole('button', { name: 'Add a card or loan' }).click()
    await dlg.getByLabel('Name', { exact: true }).fill('Store card')
    await dlg.getByLabel('Owed at the start of September 2026 (EUR)').fill('940')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg.getByRole('heading', { name: 'Store card – Payment · November 2026' })).toBeVisible()
    await dlg.getByLabel('Amount in EUR').fill('50')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    const card = claims.locator('[data-line^="acc:"]').filter({ hasText: 'Store card' })
    await expect(card).toContainText('€890.00')
    const payment = moneyOut.getByRole('button', { name: /^Store card – Payment: €50\.00/ })
    await expect(payment).toBeVisible()

    // as a loan: the row does what it did, so the form has nothing to say about it and nothing to refuse
    await editFrom(page, claims, 'Store card')
    await dlg.getByLabel('Type').selectOption('loan')
    await expect(dlg.getByTestId('acc-paid-by')).toHaveText('Paid off by "Store card – Payment".')
    await expect(dlg.getByTestId('acc-type-refusal')).toHaveCount(0)
    await settled(dlg)
    await dlg.screenshot({ path: 'e2e/output/account-becomes-loan.png' })
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    // the payment brings it down as before, and is still an expense of the month
    await expect(card).toContainText('€890.00')
    await expect(payment).toBeVisible()

    // the row takes a category of the expenses
    await moneyOut.getByRole('button', { name: 'Row menu for Store card – Payment' }).click()
    await page.getByRole('menuitem', { name: 'Category…' }).click()
    await dlg.getByLabel('Category', { exact: true }).selectOption({ label: 'Transport' })
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    await expect(moneyOut.locator('[data-line^="cat:expense:"]').filter({ hasText: 'Transport' })).toContainText('€148.00')

    // back to a card: the same rule again, so no figure moves and the row keeps its category
    await editFrom(page, claims, 'Store card')
    await dlg.getByLabel('Type').selectOption('credit-card')
    await expect(dlg.getByTestId('acc-type-refusal')).toHaveCount(0)
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    await expect(card).toContainText('€890.00')
    await expect(moneyOut.locator('[data-line^="cat:expense:"]').filter({ hasText: 'Transport' })).toContainText('€148.00')

    // a savings account that rows and virtual accounts are tied to cannot become an investment account
    await editFrom(page, assets, 'Savings')
    await expect(dlg.getByTestId('acc-type-refusal')).toHaveCount(0)
    await dlg.getByLabel('Type').selectOption('investment')
    const refusal = dlg.getByTestId('acc-type-refusal')
    await expect(refusal).toContainText('"Savings" cannot become an account of type Investments: "To savings" sends money to it')
    await expect(refusal).toContainText('the virtual account "Travel" is held in it')
    await expect(dlg.getByLabel('Type')).toHaveAttribute('aria-invalid', 'true')
    await expect(dlg.getByRole('button', { name: 'Save' })).toBeDisabled()
    await settled(dlg)
    await dlg.screenshot({ path: 'e2e/output/account-type-refused.png' })
    await dlg.getByLabel('Type').selectOption('savings')
    await expect(refusal).toHaveCount(0)
    await expect(dlg.getByRole('button', { name: 'Save' })).toBeEnabled()
    await dlg.getByRole('button', { name: 'Cancel' }).click()
  })

  test('a card that carries a debt: its line says what the month did, asks for the statement in the current month, and takes the figure where a statement gives it', async ({ page }) => {
    await openStatement(page)
    await goToMonth(page, 'November 2026')
    const claims = page.getByRole('region', { name: 'Debts and net worth' })
    const dlg = page.getByRole('dialog')

    // a card owing 9,400 since September, paid down by 500 a month from November on
    await claims.getByRole('button', { name: 'Add a card or loan' }).click()
    await dlg.getByLabel('Name', { exact: true }).fill('Store card')
    await dlg.getByLabel('Owed at the start of September 2026 (EUR)').fill('9400')
    await expect(dlg.getByTestId('acc-row')).toContainText('It holds what you pay beyond what you buy with the card that month')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg.getByRole('heading', { name: 'Store card – Payment · November 2026' })).toBeVisible()
    await dlg.getByLabel('Amount in EUR').fill('500')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()

    // the current month: what the plan works out, and the reminder that no statement has confirmed it
    const card = claims.locator('[data-line^="acc:"]').filter({ hasText: 'Store card' })
    await expect(card).toContainText('€8,900.00')
    await expect(card).toContainText('not checked against the statement')
    // under the line: the parts that add up to it
    const details = card.getByRole('button', { name: 'What is under Store card' })
    await details.click()
    const part = (label: string) => claims.locator('[data-line^="owed:"]').filter({ hasText: label })
    await expect(part('At the start of the month')).toContainText('€9,400.00')
    await expect(part('Paid')).toContainText('-€500.00')
    await expect(part('Not in the plan')).toHaveCount(0)
    await page.screenshot({ path: 'e2e/output/statement-card-debt.png', fullPage: true })

    // the statement came: what it says is owed goes into the start, where the cursor waits
    await claims.getByRole('button', { name: /^Store card balance:/ }).click()
    await expect(dlg.getByRole('heading', { name: 'Store card · November 2026' })).toBeVisible()
    await expect(dlg).toContainText('What the statement says is owed')
    await expect(dlg.getByTestId('balance-when')).toHaveText(['before this month\'s payment', 'after it'])
    const start = dlg.getByLabel('At the start of November 2026 (EUR)')
    await expect(start).toBeFocused()
    await start.fill('9630')
    await settled(dlg)
    await dlg.screenshot({ path: 'e2e/output/card-statement-dialog.png' })
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()

    // November continues from the real figure, and no longer asks
    await expect(card).toContainText('€9,130.00')
    await expect(card).not.toContainText('not checked against the statement')
    await expect(part('At the start of the month')).toContainText('€9,630.00')
    await expect(part('Paid')).toContainText('-€500.00')

    // what the plan did not have stands on the month whose end the figure is
    await goToMonth(page, 'October 2026')
    await expect(card).toContainText('€9,630.00')
    await expect(card).toContainText('entered, +€230.00 against the plan')
    await expect(card).not.toContainText('not checked against the statement')
    await expect(part('At the start of the month')).toContainText('€9,400.00')
    await expect(part('Not in the plan')).toContainText('€230.00')
    await expect(part('Paid')).toHaveCount(0)
    // in a month that is over the cursor waits in the end, as for every account
    await claims.getByRole('button', { name: /^Store card balance:/ }).click()
    await expect(dlg.getByLabel('At the end of October 2026 (EUR)')).toBeFocused()
    await dlg.getByRole('button', { name: 'Cancel' }).click()
    await expect(dlg).toBeHidden()

    // a month that is still to come says nothing: there is no statement to check it against yet
    await goToMonth(page, 'December 2026')
    await expect(card).toContainText('€8,630.00')
    await expect(card).not.toContainText('not checked against the statement')
  })

  test('suggested rows are offered where they will appear: one is added with its amount, one is dismissed and leaves the page', async ({ page }) => {
    await openStatement(page)
    await goToMonth(page, 'November 2026')
    const moneyIn = page.getByRole('region', { name: 'Money in' })
    const moneyOut = page.getByRole('region', { name: 'Money out' })
    const toggle = page.getByRole('button', { name: 'Suggestions', exact: true })
    const group = (name: string) => page.getByRole('group', { name: `Suggestions for ${name}` })

    // a household that is set up sees none until it asks for them
    await expect(toggle).toHaveAttribute('aria-pressed', 'false')
    await expect(page.getByTestId('suggestions')).toHaveCount(0)
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-pressed', 'true')

    // a category with something usual to offer opens by itself and lists everything it has, the usual rows first
    const transport = group('Transport')
    // a loan's payment is one of the car's costs: it is offered in the same category, after the usual rows
    await expect(transport.locator('[data-suggestion]')).toHaveText([/^The car – Fuel & parking/, /^Transport/, /^The car – Loan or lease/, /^The car – Tax & inspection/, /^The car – Maintenance/])
    await expect(page.getByRole('button', { name: /suggestions \(/ })).toHaveCount(0)
    // a line is its name, the amount and the buttons; what the row is for is behind its (i)
    await expect(transport).not.toContainText('Fuel or charging, parking, tolls.')
    await transport.getByRole('button', { name: 'About The car – Fuel & parking' }).hover()
    await expect(page.getByText('Fuel or charging, parking, tolls.')).toBeVisible()
    await page.keyboard.press('Escape')
    await page.mouse.move(0, 0)
    // the demo already has its salaries, so Income only has the rarer ones to offer
    await expect(group('Income').locator('[data-suggestion]')).toHaveCount(2)
    await expect(moneyIn.getByRole('button', { name: /^Dismiss / })).toHaveCount(2)
    // the accounts every household has are there already
    await expect(page.getByTestId('account-suggestions')).toHaveCount(0)
    await page.screenshot({ path: 'e2e/output/statement-suggestions.png', fullPage: true })

    // add controls stand on the rows' own columns: the "+" where a row's tick is, the words where its name is
    const tick = moneyOut.getByRole('checkbox', { name: 'Public transport done' })
    const name = moneyOut.getByRole('button', { name: /^Public transport:/ })
    const suggested = transport.locator('[data-suggestion]').first()
    const addRow = moneyOut.getByRole('button', { name: 'Add row to Transport' })
    expect(await middleOf(suggested.locator('[data-lead="plus"]'))).toBeCloseTo(await middleOf(tick), 0)
    expect(await leftOf(suggested.locator('[data-lead="text"]'))).toBeCloseTo(await leftOf(name), 0)
    expect(await middleOf(addRow.locator('[data-lead="plus"]'))).toBeCloseTo(await middleOf(tick), 0)
    expect(await leftOf(addRow.locator('[data-lead="text"]'))).toBeCloseTo(await leftOf(name), 0)
    // the open form starts on the names' column too
    await addRow.click()
    expect(await leftOf(moneyOut.getByLabel('New expense row name'))).toBeCloseTo(await leftOf(name), 0)
    await moneyOut.getByLabel('New expense row name').press('Escape')
    // a group's own rows and its controls: Income
    const salaryTick = moneyIn.getByRole('checkbox', { name: 'Sam – Salary done' })
    const salary = moneyIn.getByRole('button', { name: /^Sam – Salary:/ })
    const addIncome = moneyIn.getByRole('button', { name: 'Add income row' })
    expect(await middleOf(addIncome.locator('[data-lead="plus"]'))).toBeCloseTo(await middleOf(salaryTick), 0)
    expect(await leftOf(addIncome.locator('[data-lead="text"]'))).toBeCloseTo(await leftOf(salary), 0)
    expect(await leftOf(group('Income').locator('[data-lead="text"]').first())).toBeCloseTo(await leftOf(salary), 0)
    // under Expenses the lines are categories, which have an arrow and no tick: its controls keep to those columns
    const housing = moneyOut.getByRole('button', { name: 'Housing', exact: true })
    const addExpense = moneyOut.getByRole('button', { name: 'Add expense row' })
    expect(await middleOf(addExpense.locator('[data-lead="plus"]'))).toBeCloseTo(await middleOf(housing.locator('svg')), 0)
    expect(await leftOf(addExpense.locator('[data-lead="text"]'))).toBeCloseTo(await leftOf(housing.getByText('Housing', { exact: true })), 0)
    expect(await leftOf(group('Expenses').locator('[data-lead="text"]').first())).toBeCloseTo(await leftOf(housing.getByText('Housing', { exact: true })), 0)
    // the lower half has no ticks: the "+" stands in the arrow's column and the words under the account names
    const assetsSide = page.getByRole('region', { name: 'Assets' })
    const fundName = assetsSide.locator('[data-line^="acc:"]').filter({ hasText: 'Index fund' }).getByText('Index fund', { exact: true })
    const addAccount = assetsSide.getByRole('button', { name: 'Add account' })
    expect(await leftOf(addAccount.locator('[data-lead="text"]'))).toBeCloseTo(await leftOf(fundName), 0)
    const cardName = page.getByRole('region', { name: 'Debts and net worth' }).locator('[data-line^="acc:"]').filter({ hasText: 'Credit card' }).getByText('Credit card', { exact: true })
    expect(await leftOf(page.getByRole('button', { name: 'Add a card or loan' }).locator('[data-lead="text"]'))).toBeCloseTo(await leftOf(cardName), 0)

    // an amount that cannot be read stays on its line
    await transport.getByLabel('Amount per month for The car – Fuel & parking').fill('abc')
    await expect(transport.getByRole('alert')).toHaveText('That is not an amount I can read.')
    await expect(transport.getByRole('button', { name: 'Add The car – Fuel & parking' })).toBeDisabled()

    // the amount and Enter: the row is there, from this month on, and its suggestion is gone
    await transport.getByLabel('Amount per month for The car – Fuel & parking').fill('90')
    await transport.getByLabel('Amount per month for The car – Fuel & parking').press('Enter')
    await expect(moneyOut.getByRole('button', { name: /^The car – Fuel & parking: €90\.00/ })).toBeVisible()
    await expect(transport.locator('[data-suggestion]')).toHaveText([/^Transport/, /^The car – Loan or lease/, /^The car – Tax & inspection/, /^The car – Maintenance/])
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await stepMonth(page, 1)
    await expect(moneyOut.getByRole('button', { name: /^The car – Fuel & parking: €90\.00/ })).toBeVisible()
    await stepMonth(page, -1)

    // "×": not for us. The line is gone from the page; the undo arrow brings it back
    await expect(transport.getByRole('button', { name: /^Dismiss / })).toHaveCount(4)
    await transport.getByRole('button', { name: 'Dismiss Transport' }).click()
    await expect(transport.locator('[data-suggestion]')).toHaveText([/^The car – Loan or lease/, /^The car – Tax & inspection/, /^The car – Maintenance/])
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect(transport.locator('[data-suggestion]')).toHaveText([/^Transport/, /^The car – Loan or lease/, /^The car – Tax & inspection/, /^The car – Maintenance/])
    await transport.getByRole('button', { name: 'Add Transport', exact: true }).click()
    await expect(moneyOut.getByRole('button', { name: /^Transport: / })).toBeVisible()

    // one that needs an account the household does not have offers that account first
    const loan = transport.locator('[data-suggestion$=":v.loan"]')
    await expect(loan.getByLabel(/^Amount per month/)).toHaveCount(0)
    await expect(loan.getByRole('button', { name: 'Add a loan for The car – Loan or lease' })).toHaveText('Add a loan…')

    // one undo takes the last added row back, and its suggestion returns
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect(moneyOut.getByRole('button', { name: /^Transport: / })).toHaveCount(0)

    // a month that is over takes new rows like any other, so it offers them too
    await goToMonth(page, 'September 2026')
    await expect(toggle).toBeEnabled()
    await expect(page.getByTestId('suggestions')).not.toHaveCount(0)
    await goToMonth(page, 'November 2026')
    await toggle.click()
    await expect(page.getByTestId('suggestions')).toHaveCount(0)

    // the loan is made from the suggestion that needs it: the suggestion is the row, so the loan's form offers none
    await toggle.click()
    await loan.getByRole('button', { name: 'Add a loan for The car – Loan or lease' }).click()
    const dlg = page.getByRole('dialog')
    await expect(dlg.getByLabel('Type').locator('option')).toHaveText(['Loan'])
    await expect(dlg.getByRole('checkbox', { name: 'Add the row that pays it off' })).toHaveCount(0)
    await dlg.getByLabel('Name', { exact: true }).fill('Car loan')
    await dlg.getByLabel('Owed at the start of September 2026 (EUR)').fill('3000')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    // now the suggestion takes its amount like the others, and the row it makes brings the loan down
    await loan.getByLabel('Amount per month for The car – Loan or lease').fill('300')
    await loan.getByLabel('Amount per month for The car – Loan or lease').press('Enter')
    await expect(moneyOut.getByRole('button', { name: /^The car – Loan or lease: €300\.00/ })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Debts and net worth' }).locator('[data-line^="acc:"]').filter({ hasText: 'Car loan' })).toContainText('€2,700.00')
  })

  test('rows, categories, accounts and virtual accounts are changed and removed from their line', async ({ page }) => {
    await openStatement(page)
    await goToMonth(page, 'November 2026')
    const moneyOut = page.getByRole('region', { name: 'Money out' })
    const assets = page.getByRole('region', { name: 'Assets' })
    const dlg = page.getByRole('dialog')
    const menu = page.getByRole('menu')

    // a row: the Grid's own menu, behind the "…" after its name
    await moneyOut.getByRole('button', { name: 'Living', exact: true }).click()
    await moneyOut.getByRole('button', { name: 'Row menu for Groceries' }).click()
    await expect(menu.getByRole('menuitem')).toContainText(['Rename…', 'Move up', 'Move down', 'Category…', 'Belongs to…'])
    await expect(menu).toHaveCSS('opacity', '1')
    await page.screenshot({ path: 'e2e/output/statement-row-menu.png' })
    await menu.getByRole('menuitem', { name: 'Rename…' }).click()
    await dlg.getByRole('textbox').fill('Food')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    await expect(moneyOut.getByRole('button', { name: /^Food: €700\.00/ })).toBeVisible()
    // the line itself still opens the editor, and the menu does not
    await moneyOut.getByRole('button', { name: /^Food: €700\.00/ }).click()
    await expect(dlg.getByLabel('Amount in EUR')).toHaveValue('700')
    await dlg.getByRole('button', { name: 'Cancel' }).click()
    // a household that is set up removes through the dialog: archive from a month, or delete
    await moneyOut.getByRole('button', { name: 'Row menu for Food' }).click()
    await menu.getByRole('menuitem', { name: 'Archive or delete…' }).click()
    await expect(dlg.getByRole('heading', { name: 'Row "Food"' })).toBeVisible()
    await expect(dlg.getByRole('button', { name: /^Archive from / })).toBeVisible()
    await dlg.getByRole('button', { name: 'Cancel' }).click()
    await expect(moneyOut.getByRole('button', { name: /^Food: €700\.00/ })).toBeVisible()

    // a category: rename, move, remove. Its rows are kept
    await moneyOut.getByRole('button', { name: 'Category menu for Housing' }).click()
    await expect(menu.getByRole('menuitem')).toHaveText(['Rename…', 'Set estimate…', 'Move up', 'Move down', 'Remove…'])
    await expect(menu.getByRole('menuitem', { name: 'Move up' })).toBeDisabled()
    await menu.getByRole('menuitem', { name: 'Rename…' }).click()
    await dlg.getByLabel('Category name').fill('Living')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg.getByRole('alert')).toBeVisible()
    await dlg.getByLabel('Category name').fill('Home')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    await expect(moneyOut.getByRole('button', { name: 'Home', exact: true })).toBeVisible()
    await moneyOut.getByRole('button', { name: 'Category menu for Home' }).click()
    await menu.getByRole('menuitem', { name: 'Remove…' }).click()
    await expect(dlg.getByRole('heading', { name: 'Category "Home"' })).toBeVisible()
    await dlg.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(dlg).toBeHidden()
    await expect(moneyOut.getByRole('button', { name: 'Home', exact: true })).toHaveCount(0)
    await moneyOut.getByRole('button', { name: 'No category', exact: true }).click()
    await expect(moneyOut.getByRole('button', { name: /^The flat – Rent: €1,650\.00/ })).toBeVisible()
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect(moneyOut.getByRole('button', { name: 'Home', exact: true })).toBeVisible()

    // an account's "…" is a menu like a row's and a category's: its dialog, its place, its removal
    await assets.getByRole('button', { name: 'Account menu for Index fund' }).click()
    await expect(menu.getByRole('menuitem')).toHaveText(['Edit…', 'Move up', 'Move down', 'Archive or delete…'])
    // alone under its heading it has nowhere to move
    await expect(menu.getByRole('menuitem', { name: 'Move up' })).toBeDisabled()
    await expect(menu.getByRole('menuitem', { name: 'Move down' })).toBeDisabled()
    await menu.getByRole('menuitem', { name: 'Edit…' }).click()
    await expect(dlg.getByRole('heading', { name: 'Edit account' })).toBeVisible()
    await expect(dlg.getByLabel('Name', { exact: true })).toHaveValue('Index fund')
    // the dialog still removes at its foot, and the menu does the same without opening it
    await dlg.getByRole('button', { name: 'Archive or delete…' }).click()
    await expect(dlg.getByRole('heading', { name: 'Account "Index fund"' })).toBeVisible()
    await dlg.getByRole('button', { name: 'Cancel' }).click()
    await assets.getByRole('button', { name: 'Account menu for Index fund' }).click()
    await menu.getByRole('menuitem', { name: 'Archive or delete…' }).click()
    await expect(dlg.getByRole('heading', { name: 'Account "Index fund"' })).toBeVisible()
    await dlg.getByRole('button', { name: 'Cancel' }).click()
    await expect(dlg).toBeHidden()
    // a virtual account moves among those of its savings account, and stays where it was put
    const pools = assets.locator('[data-line^="pool:"]')
    await expect(pools).toHaveText([/^Travel/, /^Clothing/])
    await assets.getByRole('button', { name: 'Virtual account menu for Clothing' }).click()
    await expect(menu.getByRole('menuitem', { name: 'Move down' })).toBeDisabled()
    await menu.getByRole('menuitem', { name: 'Move up' }).click()
    await expect(pools).toHaveText([/^Clothing/, /^Travel/])
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect(pools).toHaveText([/^Travel/, /^Clothing/])
    await page.getByRole('button', { name: 'Redo' }).click()
    await expect(pools).toHaveText([/^Clothing/, /^Travel/])
    await editFrom(page, assets, 'Travel', 'Virtual account')
    await expect(dlg.getByRole('heading', { name: 'Edit virtual account' })).toBeVisible()
    await dlg.getByRole('button', { name: 'Cancel' }).click()
    // the calculated line is the main account itself (rule B9): nothing stands under it as an account
    await expect(assets.locator('[data-line="main"]')).toContainText('Main account')
    await expect(assets.locator('[data-line^="cur:"]')).toHaveCount(0)

    // a month that is over is changed the same way: it offers the same menus
    await goToMonth(page, 'September 2026')
    // (Living is still open from before)
    await expect(moneyOut.getByText('Food', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: /^Row menu for / })).not.toHaveCount(0)
    await expect(page.getByRole('button', { name: /^Category menu for / })).not.toHaveCount(0)
    await expect(page.getByRole('button', { name: /^(Account|Virtual account) menu for / })).not.toHaveCount(0)
  })

  test('one section for money from the accounts: what an expense took is marked calculated, what is taken by hand is a row with no tag', async ({ page }) => {
    await openStatement(page)
    await goToMonth(page, 'November 2026')
    const moneyIn = page.getByRole('region', { name: 'Money in' })
    const moneyOut = page.getByRole('region', { name: 'Money out' })
    const dlg = page.getByRole('dialog')
    const rest = async () => euros(await moneyOut.locator('[data-line]').filter({ has: page.locator('[data-rule="rest"]') }).innerText())

    // worked out from the expenses: each such line is tagged and names what it paid for
    const taken = moneyIn.locator('[data-line="from-accounts"]')
    await expect(taken).toContainText('From accounts')
    await expect(taken).not.toContainText('calculated')
    const clothing = moneyIn.locator('[data-line^="src:"]').filter({ hasText: 'Clothing' })
    await expect(clothing).toContainText('calculated')
    await expect(clothing).toContainText('for Clothing')
    // every line of the section leads with the account the money came out of; a virtual account says that it is one
    await expect(clothing).toContainText('From Clothing')
    await expect(clothing).toContainText('virtual account')
    const before = euros(await taken.innerText())

    // typed by hand: a row in the same section, added at its foot
    await moneyIn.getByRole('button', { name: 'Add transfer row' }).click()
    await expect(moneyIn.getByLabel('What the new transfer row does').locator('option')).toHaveText(['Taken from a savings account', 'Taken from an investment account'])
    await moneyIn.getByLabel('New transfer row name').fill('Car repair')
    await moneyIn.getByRole('button', { name: 'Add', exact: true }).click()
    await expect(dlg.getByRole('heading', { name: 'Car repair · November 2026' })).toBeVisible()
    // the editor opens for the first amount, and for these rows it starts on this month only
    await expect(dlg.getByRole('radio', { name: 'Only this month' })).toBeChecked()
    await dlg.getByLabel('Amount in EUR').fill('400')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    // the row is shown under the account it takes from, with its own name after it
    const own = moneyIn.locator('[data-line]').filter({ has: page.getByRole('button', { name: 'From Savings, Car repair: €400.00' }) })
    await expect(own).toContainText('From Savings')
    // an account's own name says enough: the kind of account is not repeated after it
    await expect(own).not.toContainText('savings account')
    await expect(own).toContainText('Car repair')
    await expect(page.getByRole('checkbox', { name: 'From Savings, Car repair done' })).toBeVisible()
    // a row of your own has no tag, and the section's amount counts both kinds
    await expect(own).not.toContainText('calculated')
    expect(euros(await taken.innerText())).toBe(before + 400)
    // the month has 400 more, so the rest grows by it, and the two sides still agree
    expect(await rest()).toBe(2769)
    expect((await total(page, 'in').innerText()).replace(/^Total in\s*/, '')).toBe((await total(page, 'out').innerText()).replace(/^Total out\s*/, ''))
    await page.screenshot({ path: 'e2e/output/statement-taken.png', fullPage: true })
    // nothing is taken the month after, and nothing was written into it: the line has no amount there
    await goToMonth(page, 'December 2026')
    await expect(moneyIn.getByRole('button', { name: /^From Savings, Car repair:/ })).toHaveAccessibleName('From Savings, Car repair: empty')
    expect(await rest()).toBe(2369)
    // the right side does not offer what has its own place on the left
    await moneyOut.getByRole('button', { name: 'Add transfer row' }).click()
    await expect(moneyOut.getByLabel('What is it for?').locator('option[value="to-investment"]')).toHaveCount(1)
    await expect(moneyOut.getByLabel('What is it for?').locator('option[value="from-savings"]')).toHaveCount(0)
  })

  test('a row under "From what is left" says what it is for, and the place it goes to can be made with it; a loan is paid off from under Expenses', async ({ page }) => {
    await openStatement(page)
    await goToMonth(page, 'November 2026')
    const moneyIn = page.getByRole('region', { name: 'Money in' })
    const moneyOut = page.getByRole('region', { name: 'Money out' })
    const assets = page.getByRole('region', { name: 'Assets' })
    const claims = page.getByRole('region', { name: 'Debts and net worth' })
    const dlg = page.getByRole('dialog')
    const what = moneyOut.getByLabel('What is it for?')
    const which = moneyOut.getByLabel('Which one')
    const text = moneyOut.getByTestId('add-row-text')

    // the question comes first: the places the rest of the month is shared out to, then the plain move between accounts.
    // A payment to a loan or a card is not among them: it has to be made, so it is added with the expenses
    await moneyOut.getByRole('button', { name: 'Add transfer row' }).click()
    await expect(what.locator('option')).toHaveText([
      'Goes into a savings account', 'Deposits into an investment account', 'Fills a virtual account', 'Pocket money for an adult', 'Moves money between your accounts',
    ])
    await expect(what).toHaveValue('to-savings')
    // what the household has, then the way to make another
    await expect(which.locator('option')).toHaveText(['Savings', 'New savings account…'])
    await expect(moneyOut.getByLabel('New transfer row name')).toHaveAttribute('placeholder', 'To Savings')
    await moneyOut.getByRole('button', { name: 'Cancel' }).click()

    // a loan the household does not have yet, from under Expenses: the row and the loan are made together
    const does = moneyOut.getByLabel('What the new expense row does')
    const paid = moneyOut.getByLabel('Account for the new expense row')
    await moneyOut.getByRole('button', { name: 'Add expense row' }).click()
    await does.selectOption('pay-off')
    await expect(paid.locator('option')).toHaveText(['Credit card · Credit card', 'New loan…', 'New credit card…'])
    await paid.selectOption({ label: 'New loan…' })
    await expect(text).toHaveText('Add opens the form of the new loan. Saving it makes the loan and this row together.')
    await expect(moneyOut.getByLabel('New expense row name')).toHaveAttribute('placeholder', 'Named after the loan')
    await page.screenshot({ path: 'e2e/output/statement-row-first.png', fullPage: true })
    await moneyOut.getByRole('button', { name: 'Add', exact: true }).click()
    await expect(dlg.getByRole('heading', { name: 'New account' })).toBeVisible()
    await expect(dlg.getByLabel('Type').locator('option')).toHaveText(['Loan'])
    await expect(dlg.getByRole('checkbox', { name: 'Add the row that pays it off' })).toHaveCount(0)
    await expect(dlg.getByTestId('acc-row')).toHaveText('Saving also adds the row named after the account, linked to this account.')
    await dlg.getByLabel('Name', { exact: true }).fill('Car loan')
    await expect(dlg.getByTestId('acc-row')).toHaveText('Saving also adds the row "Car loan – Payment", linked to this account.')
    await dlg.getByLabel('Owed at the start of September 2026 (EUR)').fill('5000')
    await page.screenshot({ path: 'e2e/output/statement-row-first-account.png' })
    await dlg.getByRole('button', { name: 'Save' }).click()
    // the row asks for its amount next; the loan is under Debts and comes down with the payment
    await expect(dlg.getByRole('heading', { name: 'Car loan – Payment · November 2026' })).toBeVisible()
    await dlg.getByLabel('Amount in EUR').fill('250')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    // the payment stands with the expenses, under "No category" until it is given one, and brings the loan down
    const part = (id: string) => moneyOut.locator(`li:has(> [data-line="${id}"])`)
    await expect(part('expenses').getByRole('button', { name: /^Car loan – Payment: €250\.00/ })).toBeVisible()
    await expect(part('set-aside').getByRole('button', { name: /^Car loan – Payment:/ })).toHaveCount(0)
    await expect(claims.locator('[data-line^="acc:"]').filter({ hasText: 'Car loan' })).toContainText('€4,750.00')
    // the form is closed again
    await expect(does).toHaveCount(0)

    // the card the household has is paid off from there too. Nothing is owed on it, so the payment counts as nothing
    // and says so: "paid off", with what was planned beside it
    await moneyOut.getByRole('button', { name: 'Add expense row' }).click()
    await does.selectOption('pay-off')
    await expect(paid.locator('option')).toHaveText(['Car loan · Loan', 'Credit card · Credit card', 'New loan…', 'New credit card…'])
    await expect(text).toHaveText('A payment brings down what is owed on a loan or a card, and counts as an expense of its month. It stops at what is owed.')
    await paid.selectOption({ label: 'Credit card · Credit card' })
    await expect(text).toHaveText('A payment brings down what is owed on a loan or a card, and counts as an expense of its month. It stops at what is owed.')
    await expect(moneyOut.getByLabel('New expense row name')).toHaveAttribute('placeholder', 'Credit card – Payment')
    await moneyOut.getByRole('button', { name: 'Add', exact: true }).click()
    await expect(dlg.getByRole('heading', { name: 'Credit card – Payment · November 2026' })).toBeVisible()
    await dlg.getByLabel('Amount in EUR').fill('60')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    const cardPayment = part('expenses').locator('[data-line^="row:"], [data-line]').filter({ hasText: 'Credit card – Payment' }).last()
    await expect(cardPayment).toContainText('paid off')
    await expect(cardPayment).toContainText('€60.00 planned')
    await expect(cardPayment).toBeInViewport()
    // no payment only "moves money" any more
    await expect(moneyOut.locator('[data-line="moved"]')).toHaveCount(0)

    // a new investment account with its own name for the row; the row's dialog opens with how the amount is set
    await moneyOut.getByRole('button', { name: 'Add transfer row' }).click()
    await what.selectOption('to-investment')
    await which.selectOption({ label: 'New investment account…' })
    await moneyOut.getByLabel('New transfer row name').fill('Pension top-up')
    await moneyOut.getByLabel('New transfer row name').press('Enter')
    await expect(dlg.getByTestId('acc-row')).toHaveText('Saving also adds the row "Pension top-up", linked to this account.')
    await dlg.getByLabel('Name', { exact: true }).fill('Pension')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg.getByRole('heading', { name: 'Pension top-up · November 2026' })).toBeVisible()
    await expect(dlg.getByRole('radiogroup', { name: 'How the amount is set' })).toBeVisible()
    await dlg.getByRole('button', { name: 'Cancel' }).click()
    await expect(assets.locator('[data-line^="acc:"]').filter({ hasText: 'Pension' })).toBeVisible()

    // a virtual account is made from here with its own form, which names its row
    await moneyOut.getByRole('button', { name: 'Add transfer row' }).click()
    await what.selectOption('pool-allocation')
    await expect(which.locator('option')).toHaveText(['New virtual account…'])
    await expect(moneyOut.getByLabel('New transfer row name')).toHaveCount(0)
    await moneyOut.getByRole('button', { name: 'Add', exact: true }).click()
    await expect(dlg.getByRole('heading', { name: 'New virtual account' })).toBeVisible()
    await dlg.getByLabel('Name').fill('Gifts')
    await dlg.getByLabel('Set aside each month (EUR)').fill('20')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    await expect(moneyOut.getByRole('button', { name: 'To Gifts: €20.00' })).toBeVisible()
    await expect(what).toHaveCount(0)

    // a loan payment is one of a category's costs (the car loan under Transport): added there, it stays there
    await moneyOut.getByRole('button', { name: 'Transport', exact: true }).click()
    await moneyOut.getByRole('button', { name: 'Add row to Transport' }).click()
    await does.selectOption('pay-off')
    await expect(paid.locator('option')).toHaveText(['Car loan · Loan', 'Credit card · Credit card', 'New loan…', 'New credit card…'])
    await paid.selectOption({ label: 'New loan…' })
    await expect(text).toHaveText('Add opens the form of the new loan. Saving it makes the loan and this row together.')
    await page.screenshot({ path: 'e2e/output/statement-loan-from-category.png', fullPage: true })
    await moneyOut.getByLabel('New expense row name').fill('Bike loan')
    await moneyOut.getByLabel('New expense row name').press('Enter')
    await dlg.getByLabel('Name', { exact: true }).fill('Bike')
    await dlg.getByLabel('Owed at the start of September 2026 (EUR)').fill('900')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg.getByRole('heading', { name: 'Bike loan · November 2026' })).toBeVisible()
    await dlg.getByLabel('Amount in EUR').fill('75')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    // the row is in Transport, beside the category's other costs: the page marks it for a moment
    const transportPart = moneyOut.locator('li:has(> [data-line^="cat:expense:"])').filter({ has: page.getByRole('button', { name: 'Transport', exact: true }) })
    const landed = transportPart.locator('[data-line]').filter({ hasText: 'Bike loan' })
    await expect(landed).toHaveAttribute('data-marked', 'true')
    await expect(landed).toBeInViewport()
    await expect(landed).toContainText('€75.00')
    await expect(moneyOut.getByRole('button', { name: 'Pays off Bike: go there' })).toBeVisible()
    await page.screenshot({ path: 'e2e/output/statement-loan-landed.png', fullPage: true })
    await expect(landed).not.toHaveAttribute('data-marked', 'true', { timeout: 4000 })
    await expect(claims.locator('[data-line^="acc:"]').filter({ hasText: 'Bike' })).toContainText('€825.00')

    // money taken out of an account can make that account too
    await moneyIn.getByRole('button', { name: 'Add transfer row' }).click()
    await expect(moneyIn.getByLabel('Account for the new transfer row').locator('option')).toHaveText(['Savings', 'New savings account…'])
  })

  test('a row on a schedule carries the repeat symbol in every month; where nothing lands it says when it lands next', async ({ page }) => {
    await openStatement(page)
    const moneyOut = page.getByRole('region', { name: 'Money out' })
    const line = (name: string) => moneyOut.locator('[data-line]').filter({ hasText: name }).first()
    await goToMonth(page, 'November 2026')
    await page.getByRole('button', { name: 'Expand all' }).click()

    // rent lands every month: the row carries the symbol, and the symbol says how it repeats
    await expect(line('The flat – Rent').getByRole('img', { name: 'Repeats: Every month' })).toBeVisible()
    await expect(line('The flat – Rent')).not.toContainText('next')
    // the car insurance lands every three months, not in November: the empty line says it is on a schedule, and when it lands
    const insurance = line('The car – Insurance')
    await expect(insurance.getByRole('img', { name: 'Repeats: Every 3 months (Jan, Apr, Jul, Oct)' })).toBeVisible()
    await expect(insurance).toContainText('next Jan 2027')
    // the line is grey and shows what it brings when it lands; that amount is in no sum
    const colourOf = (l: Locator) => l.evaluate((el) => getComputedStyle(el).color)
    await expect(insurance).toHaveAttribute('data-resting', 'true')
    await expect(insurance).toContainText('€210.00')
    const insuranceName = moneyOut.getByRole('button', { name: 'The car – Insurance: empty, €210.00 next in Jan 2027' })
    expect(await colourOf(insuranceName)).toBe(await colourOf(insurance.getByText('next Jan 2027')))
    expect(await colourOf(insuranceName)).not.toBe(await colourOf(moneyOut.getByRole('button', { name: /^Public transport:/ })))
    await expect(line('Transport')).toContainText('€98.00')
    // a row whose amount simply carries on from month to month has no symbol
    await expect(line('Groceries').locator('[data-repeats]')).toHaveCount(0)

    // one item of a row that lands in another month is listed under its row all the same, in every month
    const dlg = page.getByRole('dialog')
    await moneyOut.getByRole('button', { name: /^Subscriptions:/ }).click()
    await dlg.getByRole('button', { name: 'Add item' }).click()
    await dlg.getByLabel('Item label').last().fill('Annual pass')
    await dlg.getByLabel('Item amount').last().fill('60')
    await dlg.getByLabel('Repeats, Annual pass').selectOption({ label: 'Every year' })
    await dlg.getByLabel('In which month, Annual pass').selectOption({ label: 'March' })
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    // the row's amount is what lands this month; it opens to the streaming it has and the pass that comes in March
    await expect(moneyOut.getByRole('button', { name: /^Subscriptions:/ })).toHaveAccessibleName(/^Subscriptions: €18\.00/)
    await moneyOut.getByRole('button', { name: 'Items of Subscriptions' }).click()
    const pass = line('Annual pass')
    await expect(pass).toHaveAttribute('data-resting', 'true')
    await expect(pass.getByRole('img', { name: 'Repeats: Every year (Mar)' })).toBeVisible()
    await expect(pass).toContainText('next Mar 2027')
    await expect(pass).toContainText('€60.00')
    // it is no item of this month: nothing to tick, grey like the "next" beside it, unlike the item that landed
    await expect(pass.getByRole('checkbox')).toHaveCount(0)
    const passName = moneyOut.getByRole('button', { name: 'Subscriptions: Annual pass: empty, €60.00 next in Mar 2027' })
    expect(await colourOf(passName)).toBe(await colourOf(pass.getByText('next Mar 2027')))
    expect(await colourOf(passName)).not.toBe(await colourOf(moneyOut.getByRole('button', { name: /^Subscriptions: Streaming:/ })))
    await expect(line('Streaming')).not.toHaveAttribute('data-resting', 'true')
    await page.screenshot({ path: 'e2e/output/statement-repeats.png', fullPage: true })
    // pressing it opens the row's dialog, where it is listed too
    await passName.click()
    await expect(dlg.getByTestId('elsewhere').getByLabel('Name of Annual pass')).toHaveValue('Annual pass')
    await dlg.getByRole('button', { name: 'Cancel' }).click()
    await expect(dlg).toBeHidden()

    // in the month it lands the same row shows its amount and the symbol, and no "next"
    await goToMonth(page, 'January 2027')
    await page.getByRole('button', { name: 'Expand all' }).click()
    await expect(insurance.getByRole('img', { name: /^Repeats: Every 3 months/ })).toBeVisible()
    await expect(insurance).toContainText('€210.00')
    await expect(insurance).not.toContainText('next')

    // the Grid shows the same symbol beside the row's name, and the legend says what it means
    await page.getByRole('navigation', { name: 'Screens' }).getByRole('link', { name: 'Grid' }).click()
    await expect(page.getByRole('rowheader', { name: /^The car – Insurance/ }).getByRole('img', { name: /^Repeats: Every 3 months/ })).toBeVisible()
    await expect(page.getByRole('rowheader', { name: /^Groceries/ }).locator('[data-repeats]')).toHaveCount(0)
    await page.getByRole('button', { name: 'Colours and marks' }).click()
    await expect(page.getByText('On a schedule: it lands in its months by itself.')).toBeVisible()
  })

  test('what repeats is set in the row\'s dialog: one item of a row, and a yearly row from a month it does not land in', async ({ page }) => {
    await openStatement(page)
    const moneyOut = page.getByRole('region', { name: 'Money out' })
    const dlg = page.getByRole('dialog')
    const line = (name: string) => moneyOut.locator('[data-line]').filter({ hasText: name }).first()
    const open = async (month: string) => {
      await goToMonth(page, month)
      await page.getByRole('button', { name: 'Expand all' }).click()
    }
    await open('November 2026')

    // one item of a row: every item says how it repeats, and a new one starts on "Only this month"
    await moneyOut.getByRole('button', { name: /^Health:/ }).click()
    await dlg.getByRole('tab', { name: 'Itemized' }).click()
    await dlg.getByRole('button', { name: 'Add item' }).click()
    await dlg.getByLabel('Item label').last().fill('Physio')
    await dlg.getByLabel('Item amount').last().fill('45')
    const repeats = dlg.getByLabel('Repeats, Physio')
    await expect(repeats).toHaveValue('none')
    await expect(repeats.locator('option')).toHaveText(['Only this month', 'Every month', 'Every 2 months', 'Every 3 months', 'Every 6 months', 'Every year', 'In chosen months'])
    // while nothing repeats by itself, the line under the list asks about the total
    await expect(dlg.getByRole('radiogroup', { name: 'The total' }).getByRole('radio')).toHaveText(['This and following months', 'Only this month'])
    await expect(dlg.getByTestId('repeat-next')).toHaveCount(0)
    await repeats.selectOption({ label: 'Every year' })
    await expect(dlg.getByLabel('In which month, Physio')).toHaveValue('11')
    await expect(dlg.getByTestId('repeat-lands')).toHaveText('Lands in November each year.')
    // once something repeats, the row shows only that from the next month on, and says so before it is saved
    await expect(dlg.getByRole('radiogroup', { name: 'The total' })).toHaveCount(0)
    await expect(dlg.getByTestId('repeat-next')).toHaveText('From December 2026 this row shows only what repeats. Nothing lands in December 2026.')
    // asked another way it keeps its month; a month more is one box
    await repeats.selectOption({ label: 'In chosen months' })
    await dlg.getByRole('group', { name: 'Months, Physio' }).getByLabel('Dec').check()
    await expect(dlg.getByTestId('repeat-lands')).toHaveText('Lands in Nov and Dec.')
    await repeats.selectOption({ label: 'Every month' })
    await expect(dlg.getByTestId('repeat-lands')).toHaveText('Lands in every month.')
    await expect(dlg.getByTestId('repeat-next')).toHaveText('From December 2026 this row shows only what repeats: Physio €45.00.')
    await page.screenshot({ path: 'e2e/output/repeats-items.png' })
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    // the row carries the symbol now; this month keeps both its items
    await expect(line('Health').getByRole('img', { name: 'Repeats: Every month' })).toBeVisible()
    await expect(moneyOut.getByRole('button', { name: /^Health:/ })).toHaveAccessibleName(/^Health: €75\.00/)
    // the next month shows what repeats and nothing else; the month before keeps what it carried
    await open('December 2026')
    await expect(moneyOut.getByRole('button', { name: /^Health:/ })).toHaveAccessibleName(/^Health: €45\.00/)
    await open('October 2026')
    await expect(moneyOut.getByRole('button', { name: /^Health:/ })).toHaveAccessibleName(/^Health: €30\.00/)
    // reopened, the item shows how it repeats; "Only this month" ends it after this month
    await open('December 2026')
    await moneyOut.getByRole('button', { name: /^Health:/ }).click()
    await expect(dlg).toContainText('On a schedule')
    await expect(dlg.getByLabel('Repeats, Physio')).toHaveValue('1')
    await dlg.getByLabel('Repeats, Physio').selectOption({ label: 'Only this month' })
    await expect(dlg).toContainText('Ends after December 2026.')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    await open('January 2027')
    await expect(moneyOut.getByRole('button', { name: 'Health: empty' })).toBeVisible()
    await expect(line('Health').locator('[data-repeats]')).toHaveCount(0)

    // a yearly row seen from a month it does not land in: the dialog lists what repeats there all the same
    await open('November 2026')
    await moneyOut.getByRole('button', { name: 'Biscuit – Costs: empty' }).click()
    await expect(dlg).toContainText('Nothing lands this month')
    const dogTax = dlg.getByTestId('elsewhere')
    await expect(dogTax.getByLabel('Name of Dog tax')).toHaveValue('Dog tax')
    await expect(dlg.getByLabel('Amount of Dog tax')).toHaveValue('120')
    await expect(dlg.getByLabel('Repeats, Dog tax')).toHaveValue('12')
    await expect(dlg.getByLabel('In which month, Dog tax')).toHaveValue('3')
    await expect(dogTax.getByTestId('repeat-lands')).toHaveText('Lands in March each year. Not in November 2026; next: March 2027.')
    await settled(dlg)
    await page.screenshot({ path: 'e2e/output/repeats-elsewhere.png' })
    // its amount is changed from here on
    await dlg.getByLabel('Amount of Dog tax').fill('130')
    await expect(dogTax).toContainText('Counts from November 2026; earlier months keep what they show.')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    await expect(line('Biscuit – Costs')).toContainText('next Mar 2027')
    await open('March 2027')
    await expect(moneyOut.getByRole('button', { name: /^Biscuit – Costs:/ })).toHaveAccessibleName(/^Biscuit – Costs: €130\.00/)
    // and it is stopped from any month too
    await open('November 2026')
    await moneyOut.getByRole('button', { name: 'Biscuit – Costs: empty' }).click()
    await dlg.getByRole('button', { name: 'Stop Dog tax' }).click()
    await dlg.getByRole('button', { name: 'From November 2026 on' }).click()
    // stopped at once; the dialog stays open and says so, and the box of what lands elsewhere is gone
    await expect(dlg.getByRole('status')).toHaveText('"Dog tax" is stopped from November 2026 on. What you typed here is still unsaved.')
    await expect(dlg.getByTestId('elsewhere')).toHaveCount(0)
    await dlg.getByRole('button', { name: 'Cancel' }).click()
    await expect(dlg).toBeHidden()
    await expect(line('Biscuit – Costs').locator('[data-repeats]')).toHaveCount(0)
    await expect(line('Biscuit – Costs')).not.toContainText('next')
  })

  test('a row\'s category is shown in its dialog and changed there: the row moves, and the page shows where it went', async ({ page }) => {
    await openStatement(page)
    await goToMonth(page, 'November 2026')
    const moneyOut = page.getByRole('region', { name: 'Money out' })
    const dlg = page.getByRole('dialog')
    const row = moneyOut.getByRole('button', { name: /^Sam – Personal:/ })
    const heading = (name: string) => moneyOut.getByRole('button', { name, exact: true })

    // the dialog says which category the row is under, at the right end of the line of the two tabs
    await heading('Personal').click()
    await row.click()
    const select = dlg.getByLabel('Category of Sam – Personal')
    await expect(select.locator('option:checked')).toHaveText('Personal')
    await expect(select.locator('option')).toHaveText(['Housing', 'Living', 'Transport', 'Family & pets', 'Fun', 'Personal', 'No category'])
    const tabs = (await dlg.getByRole('tablist').boundingBox())!
    const box = (await select.boundingBox())!
    const whole = (await dlg.boundingBox())!
    expect(Math.abs(tabs.y + tabs.height / 2 - (box.y + box.height / 2))).toBeLessThan(6)
    expect(box.x).toBeGreaterThan(tabs.x + tabs.width)
    expect(whole.x + whole.width - (box.x + box.width)).toBeLessThan(24)
    await expect(dlg.getByTestId('category-note')).toHaveCount(0)

    // another one is picked: the dialog says what Save will do, and nothing has moved yet
    await select.selectOption({ label: 'Fun' })
    await expect(dlg.getByTestId('category-note')).toHaveText('Once saved, this row is under Fun, in every month.')
    await settled(dlg)
    await dlg.screenshot({ path: 'e2e/output/cell-category.png' })
    // on a phone the choice goes under the tabs and stays inside the dialog
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(async () => {
      const b = (await select.boundingBox())!
      expect(b.x).toBeGreaterThanOrEqual(0)
      expect(b.x + b.width).toBeLessThanOrEqual(390)
    }).toPass({ timeout: 3000 })
    await page.setViewportSize({ width: 1440, height: 900 })
    await dlg.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(dlg).toBeHidden()

    // saved: "Fun" was closed and opens, the row is in it and marked for a moment
    await expect(row).toBeVisible()
    await expect(moneyOut.locator('[data-line]').filter({ hasText: 'Sam – Personal' }).first()).toHaveAttribute('data-marked', 'true')
    await expect(heading('Fun')).toHaveAttribute('aria-expanded', 'true')
    // it is under "Fun" and no longer under "Personal", which is still open
    await heading('Fun').click()
    await expect(row).toHaveCount(0)
    await expect(heading('Personal')).toHaveAttribute('aria-expanded', 'true')
    await heading('Fun').click()
    await expect(row).toBeVisible()

    // one step: undo takes the row back to "Personal"
    await page.getByRole('button', { name: 'Undo' }).click()
    await heading('Fun').click()
    await expect(row).toBeVisible()
    await row.click()
    await expect(dlg.getByLabel('Category of Sam – Personal').locator('option:checked')).toHaveText('Personal')

    // "No category" takes it out of all of them
    await dlg.getByLabel('Category of Sam – Personal').selectOption({ label: 'No category' })
    await expect(dlg.getByTestId('category-note')).toHaveText('Once saved, this row is in no category, in every month.')
    await dlg.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(dlg).toBeHidden()
    await expect(heading('No category')).toHaveAttribute('aria-expanded', 'true')
    await heading('Personal').click()
    await expect(row).toBeVisible()

    // a transfer has no category, and its dialog offers none
    await moneyOut.getByRole('button', { name: /^To Travel:/ }).click()
    await expect(dlg).toBeVisible()
    await expect(dlg.getByLabel(/^Category of/)).toHaveCount(0)
  })

  test('a saved item that repeats is renamed by typing over its name, and the name has room', async ({ page }) => {
    await openStatement(page)
    await goToMonth(page, 'November 2026')
    const moneyOut = page.getByRole('region', { name: 'Money out' })
    const dlg = page.getByRole('dialog')
    const health = moneyOut.getByRole('button', { name: /^Health:/ })
    await moneyOut.getByRole('button', { name: 'Living', exact: true }).click()

    // something that repeats every month, saved
    await health.click()
    await dlg.getByRole('tab', { name: 'Itemized' }).click()
    await dlg.getByRole('button', { name: 'Add item' }).click()
    await dlg.getByLabel('Item label').last().fill('Gym')
    await dlg.getByLabel('Item amount').last().fill('30')
    await dlg.getByLabel('Repeats, Gym').selectOption({ label: 'Every month' })
    await dlg.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(dlg).toBeHidden()

    // opened again, its name is a field like a plain item's, wide enough for a real name
    await health.click()
    const name = dlg.locator('input[value="Gym"]')
    await expect(name).toHaveAccessibleName('Item label')
    expect((await name.boundingBox())!.width).toBeGreaterThan(170)
    await expect(dlg.getByTestId('rename-note')).toHaveCount(0)
    await name.fill('Sports club membership')
    await expect(dlg.getByTestId('rename-note')).toHaveText('Renamed from "Gym" in every month.')
    await expect(dlg.getByLabel('Repeats, Sports club membership')).toHaveValue('1')
    await settled(dlg)
    await dlg.screenshot({ path: 'e2e/output/cell-rename.png' })
    await dlg.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(dlg).toBeHidden()

    // the item carries the new name in this month and in the ones after it
    await moneyOut.getByRole('button', { name: 'Items of Health' }).click()
    await expect(moneyOut.getByRole('button', { name: /^Health: Sports club membership: €30\.00/ })).toBeVisible()
    await expect(moneyOut.getByRole('button', { name: /^Health: Gym:/ })).toHaveCount(0)
    await stepMonth(page, 1)
    await expect(page.getByRole('heading', { level: 2, name: 'December 2026' })).toBeVisible()
    await expect(moneyOut.getByRole('button', { name: /^Health:/ }).first()).toBeVisible()
    await health.first().click()
    await expect(dlg.locator('input[value="Sports club membership"]')).toHaveCount(1)
    await dlg.getByRole('button', { name: 'Cancel' }).click()

    // one step: undo gives the old name back
    await page.getByRole('button', { name: 'Undo' }).click()
    await health.first().click()
    await expect(dlg.locator('input[value="Gym"]')).toHaveCount(1)
    await expect(dlg.locator('input[value="Sports club membership"]')).toHaveCount(0)
  })

  test('a long list of items scrolls inside the row\'s dialog, and removing one that repeats keeps what was typed', async ({ page }) => {
    await openStatement(page)
    await goToMonth(page, 'November 2026')
    const moneyOut = page.getByRole('region', { name: 'Money out' })
    const dlg = page.getByRole('dialog')
    // once the window has its size: the whole dialog is inside it
    const inside = (l: Locator, height: number) => expect(async () => {
      const box = (await l.boundingBox())!
      expect(box.y).toBeGreaterThanOrEqual(0)
      expect(box.y + box.height).toBeLessThanOrEqual(height)
    }).toPass({ timeout: 3000 })
    await moneyOut.getByRole('button', { name: 'Living', exact: true }).click()

    // two subscriptions that repeat, saved
    await moneyOut.getByRole('button', { name: /^Health:/ }).click()
    await dlg.getByRole('tab', { name: 'Itemized' }).click()
    for (const [i, name] of ['Music', 'Films'].entries()) {
      if (i > 0 || (await dlg.getByLabel('Item label').count()) === 0) await dlg.getByRole('button', { name: 'Add item' }).click()
      await dlg.getByLabel('Item label').last().fill(name)
      await dlg.getByLabel('Item amount').last().fill('10')
      await dlg.getByLabel(`Repeats, ${name}`).selectOption({ label: 'Every month' })
    }
    await dlg.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(dlg).toBeHidden()
    const health = moneyOut.getByRole('button', { name: /^Health:/ })
    const before = euros((await health.getAttribute('aria-label'))!)

    // many more are typed: the dialog stays on the screen, its list scrolls, and "Save" stays in reach
    await moneyOut.getByRole('button', { name: /^Health:/ }).click()
    for (let i = 1; i <= 14; i++) {
      await dlg.getByRole('button', { name: 'Add item' }).click()
      await dlg.getByLabel('Item label').last().fill(`Service ${i}`)
      await dlg.getByLabel('Item amount').last().fill(String(i))
    }
    await inside(dlg, 900)
    const save = dlg.getByRole('button', { name: 'Save', exact: true })
    await expect(save).toBeInViewport({ ratio: 1 })
    await dlg.getByText('Health · November 2026').scrollIntoViewIfNeeded()
    await expect(dlg.getByText('Health · November 2026')).toBeInViewport({ ratio: 1 })
    await expect(save).toBeInViewport({ ratio: 1 })
    await settled(dlg)
    await page.screenshot({ path: 'e2e/output/cell-long-list.png' })
    await dlg.getByLabel('Item label').last().scrollIntoViewIfNeeded()
    await expect(dlg.getByLabel('Item label').last()).toBeInViewport({ ratio: 1 })
    await expect(save).toBeInViewport({ ratio: 1 })
    // the same on a phone
    await page.setViewportSize({ width: 390, height: 844 })
    await inside(dlg, 844)
    await expect(save).toBeInViewport({ ratio: 1 })
    await dlg.getByLabel('Item label').first().scrollIntoViewIfNeeded()
    await expect(dlg.getByLabel('Item label').first()).toBeInViewport({ ratio: 1 })
    await page.setViewportSize({ width: 1440, height: 900 })

    // one that repeats is removed from this month on: that is done at once, and the dialog keeps everything else
    // a saved item's name is a field like any other: it is found by what the field holds
    const box = (name: string) => dlg.locator('div.rounded-md.border').filter({ has: page.locator(`input[value="${name}"]`) }).first()
    const films = box('Films')
    await films.getByRole('button', { name: 'Remove item' }).click()
    await films.getByRole('button', { name: 'This and following months' }).click()
    await expect(dlg).toBeVisible()
    await expect(dlg.getByRole('status')).toHaveText('"Films" is removed from November 2026 on. What you typed here is still unsaved.')
    await expect(dlg.locator('input[value="Films"]')).toHaveCount(0)
    await expect(dlg.getByLabel('Item label')).toHaveCount(15)
    await expect(dlg.getByLabel('Item label').last()).toHaveValue('Service 14')
    // and one with all its occurrences: the remove dialog asks, and the list is still there afterwards
    const music = box('Music')
    await music.getByRole('button', { name: 'Remove item' }).click()
    await music.getByRole('button', { name: 'All occurrences' }).click()
    await page.getByRole('dialog').last().getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(dlg).toHaveCount(1)
    await expect(dlg.getByRole('status')).toHaveText('"Music" is removed. What you typed here is still unsaved.')
    // nothing repeats in the row any more, so it is an ordinary row again: what the month carried is an item of its
    // own now, first in the list, and the fourteen follow
    await expect(dlg.getByLabel('Item label')).toHaveCount(15)
    await expect(dlg.getByLabel('Item label').first()).toHaveValue('')
    await expect(dlg.getByLabel('Item label').nth(1)).toHaveValue('Service 1')
    // the choice for the total is back, and says what the later months will show; the months the schedules had
    // posted to hold nothing, so nothing of yours is replaced there
    await expect(dlg.getByRole('radiogroup', { name: 'The total' }).getByRole('radio', { name: 'This and following months' })).toBeChecked()
    await expect(dlg.getByTestId('scope-says')).toHaveText(/^Nothing here repeats by itself: later months show the total, €\d+\.00, as one amount\.$/)

    // saved: the fourteen are in the month (1 + 2 + … + 14 = 105), the two that were removed are not (10 each)
    await dlg.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(dlg).toBeHidden()
    await expect.poll(async () => euros((await health.getAttribute('aria-label'))!)).toBe(before - 20 + 105)
    await moneyOut.getByRole('button', { name: 'Items of Health' }).click()
    await expect(moneyOut.getByRole('button', { name: /^Health: Service 14: €14\.00/ })).toBeVisible()
    await expect(moneyOut.getByRole('button', { name: /^Health: (Music|Films):/ })).toHaveCount(0)
  })

  test('the link symbol joins a row and its account: pressing it goes to the other end, and an open one adds the missing row', async ({ page }) => {
    await openStatement(page)
    const moneyIn = page.getByRole('region', { name: 'Money in' })
    const moneyOut = page.getByRole('region', { name: 'Money out' })
    const assets = page.getByRole('region', { name: 'Assets' })
    const claims = page.getByRole('region', { name: 'Debts and net worth' })
    const dlg = page.getByRole('dialog')
    const line = (side: typeof assets, name: string) => side.locator('[data-line]').filter({ hasText: name }).first()

    // a month that is over shows what is linked, and the link that is still open, as any month does
    await goToMonth(page, 'September 2026')
    await expect(moneyOut.getByRole('button', { name: 'Goes into Index fund: go there' })).toBeVisible()
    await expect(page.locator('[data-link="open"]')).toHaveCount(1)

    await goToMonth(page, 'November 2026')
    // income and plain expenses move no account of the lower half: no symbol
    await expect(moneyIn.locator('[data-link]')).toHaveCount(0)
    await expect(moneyOut.locator('[data-link]')).toHaveCount(4)

    // from the row to its account: the line is marked for a moment
    await moneyOut.getByRole('button', { name: 'Goes into Index fund: go there' }).click()
    const fund = assets.locator('[data-line^="acc:"]').filter({ hasText: 'Index fund' })
    await expect(fund).toHaveAttribute('data-marked', 'true')
    await expect(fund).toBeInViewport()
    await page.screenshot({ path: 'e2e/output/statement-links.png', fullPage: true })
    await expect(fund).not.toHaveAttribute('data-marked', 'true', { timeout: 4000 })

    // and back, from the account to the row that fills it
    await assets.getByRole('button', { name: 'Filled by To investments: go there' }).click()
    await expect(line(moneyOut, 'To investments')).toHaveAttribute('data-marked', 'true')

    // the other end is opened when something hides it: a virtual account inside a folded savings account
    await assets.getByRole('button', { name: 'What is under Savings' }).click()
    await expect(assets.locator('[data-line^="pool:"]')).toHaveCount(0)
    await moneyOut.getByRole('button', { name: 'Fills Travel: go there' }).click()
    const travel = assets.locator('[data-line^="pool:"]').filter({ hasText: 'Travel' })
    await expect(travel).toHaveAttribute('data-marked', 'true')
    await expect(assets.getByRole('button', { name: 'Filled by To Travel: go there' })).toBeVisible()
    // the savings account names the row that fills it
    await expect(assets.getByRole('button', { name: 'Filled by To savings: go there' })).toBeVisible()

    // the card has no row that pays it off: its link is open, and pressing it adds the row
    const card = claims.locator('[data-line^="acc:"]').filter({ hasText: 'Credit card' })
    await expect(card.locator('[data-link="open"]')).toHaveCount(1)
    await claims.getByRole('button', { name: 'No row pays off Credit card yet: add the row that pays it off' }).click()
    await expect(dlg.getByRole('heading', { name: 'Credit card – Payment · November 2026' })).toBeVisible()
    await dlg.getByLabel('Amount in EUR').fill('60')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    // now both ends carry the closed link, and they find each other
    await expect(card.locator('[data-link="open"]')).toHaveCount(0)
    await claims.getByRole('button', { name: 'Paid off by Credit card – Payment: go there' }).click()
    await expect(line(moneyOut, 'Credit card – Payment')).toHaveAttribute('data-marked', 'true')
    await moneyOut.getByRole('button', { name: 'Pays off Credit card: go there' }).click()
    await expect(card).toHaveAttribute('data-marked', 'true')

    // the legend says what the symbol means
    await page.getByRole('button', { name: 'Colours and marks' }).click()
    await expect(page.getByText('Linked, on the Statement: a row and the account it fills, takes from or pays off.')).toBeVisible()
  })

  test('a heading folds with everything under it: its total stays, it stays folded, and what is looked for opens it', async ({ page }) => {
    await openStatement(page)
    // the demo posts its schedules just after it loads: the walk to the month gives the amounts time to settle
    await goToMonth(page, 'November 2026')
    const moneyIn = page.getByRole('region', { name: 'Money in' })
    const moneyOut = page.getByRole('region', { name: 'Money out' })
    const assets = page.getByRole('region', { name: 'Assets' })
    const claims = page.getByRole('region', { name: 'Debts and net worth' })
    const heading = (side: Locator, name: string) => side.getByRole('button', { name, exact: true })
    const setAside = heading(moneyOut, 'From what is left')
    const saved = moneyOut.getByRole('checkbox', { name: 'To savings done' })

    // every heading is open at first, and is a button that says so
    const all = [
      heading(moneyIn, 'Income'), heading(moneyIn, 'From accounts'), heading(moneyOut, 'Expenses'), setAside,
      heading(assets, 'Savings accounts'), heading(assets, 'Investment accounts'), heading(claims, 'Debts'), heading(claims, 'Net worth'),
    ]
    for (const h of all) await expect(h).toHaveAttribute('aria-expanded', 'true')
    // what the household has stands under a heading per kind, each with the sum of its accounts; a kind it has none of has no heading
    const amountOn = async (l: Locator) => (await l.innerText()).match(/€[\d,]+\.\d\d/g)!.at(-1)
    // two amounts read one after the other: asked again until they are from the same state of the page
    await expect(async () => {
      expect(await amountOn(assets.locator('[data-line="savings-accounts"]'))).toBe(await amountOn(assets.locator('[data-line^="acc:"]').filter({ hasText: 'Savings' }).first()))
      expect(await amountOn(assets.locator('[data-line="investment-accounts"]'))).toBe(await amountOn(assets.locator('[data-line^="acc:"]').filter({ hasText: 'Index fund' })))
    }).toPass()
    await expect(assets.locator('[data-line="other-assets"]')).toHaveCount(0)
    await expect(assets.locator('[data-line]').first()).toHaveAttribute('data-line', 'main')
    await expect(saved).toBeVisible()
    const totalOut = await total(page, 'out').textContent()

    // folded: its lines and its "Add row" are gone, the heading keeps its total and the side its own
    await setAside.click()
    await expect(setAside).toHaveAttribute('aria-expanded', 'false')
    await expect(saved).toHaveCount(0)
    await expect(moneyOut.getByRole('button', { name: 'Add transfer row' })).toHaveCount(0)
    await expect(moneyOut.locator('[data-line="set-aside"]')).toContainText(/€[\d,]+\.\d\d/)
    await expect(total(page, 'out')).toHaveText(totalOut!)
    // the heading is pressed anywhere on its line
    const band = moneyOut.locator('[data-line="expenses"]')
    const box = (await band.boundingBox())!
    await band.click({ position: { x: box.width / 2, y: box.height / 2 } })
    await expect(moneyOut.getByRole('button', { name: 'Housing', exact: true })).toHaveCount(0)
    await page.screenshot({ path: 'e2e/output/statement-folded.png', fullPage: true })
    await band.click({ position: { x: box.width / 2, y: box.height / 2 } })
    await expect(moneyOut.getByRole('button', { name: 'Housing', exact: true })).toBeVisible()

    // it stays folded: in another month, after another screen, and when the page is loaded again
    await stepMonth(page, 1)
    await expect(setAside).toHaveAttribute('aria-expanded', 'false')
    await stepMonth(page, -1)
    await page.getByRole('navigation', { name: 'Screens' }).getByRole('link', { name: 'Grid' }).click()
    await page.getByRole('navigation', { name: 'Screens' }).getByRole('link', { name: 'Statement' }).click()
    await expect(setAside).toHaveAttribute('aria-expanded', 'false')
    await page.reload()
    await expect(setAside).toHaveAttribute('aria-expanded', 'false')
    await expect(heading(moneyOut, 'Expenses')).toHaveAttribute('aria-expanded', 'true')
    await expect(saved).toHaveCount(0)

    // the link symbol on an account goes to its row: the heading that hides the row opens
    await assets.getByRole('button', { name: /^Filled by To investments: go there/ }).click()
    const row = moneyOut.locator('[data-line]').filter({ hasText: 'To investments' }).first()
    await expect(row).toHaveAttribute('data-marked', 'true')
    await expect(setAside).toHaveAttribute('aria-expanded', 'true')

    // "Collapse all" folds the headings too, "Expand all" opens everything
    await page.getByRole('button', { name: 'Collapse all' }).click()
    for (const h of all) await expect(h).toHaveAttribute('aria-expanded', 'false')
    await expect(assets.locator('[data-line^="acc:"]')).toHaveCount(0)
    await expect(moneyIn.getByRole('checkbox')).toHaveCount(0)
    await expect(moneyOut.getByRole('button', { name: 'Housing', exact: true })).toHaveCount(0)
    await expect(claims.getByText('Free', { exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: 'Expand all' }).click()
    await expect(saved).toBeVisible()
    await expect(moneyOut.getByText('The flat – Rent')).toBeVisible()
    await expect(claims.getByText('Free', { exact: true })).toBeVisible()
    // a heading of the lower half stays folded too, and the side's total does not change with it
    const totalAssets = await total(page, 'assets').textContent()
    await heading(assets, 'Investment accounts').click()
    await expect(assets.locator('[data-line^="acc:"]').filter({ hasText: 'Index fund' })).toHaveCount(0)
    await expect(total(page, 'assets')).toHaveText(totalAssets!)
    await page.reload()
    await expect(heading(assets, 'Investment accounts')).toHaveAttribute('aria-expanded', 'false')
    await expect(heading(assets, 'Savings accounts')).toHaveAttribute('aria-expanded', 'true')
    await heading(assets, 'Investment accounts').click()
    await page.screenshot({ path: 'e2e/output/statement-asset-kinds.png', fullPage: true })
  })

  test('a top-up on a virtual account whose amount a rule works out says that the month then keeps a typed amount', async ({ page }) => {
    await openStatement(page)
    await goToMonth(page, 'November 2026')
    const moneyOut = page.getByRole('region', { name: 'Money out' })
    const assets = page.getByRole('region', { name: 'Assets' })
    const dlg = page.getByRole('dialog')
    // Clothing gets 1% of income from November on
    await assets.getByRole('button', { name: 'Rule for Clothing: a fixed amount' }).click()
    await dlg.getByRole('radio', { name: 'A percentage of income' }).click()
    await dlg.getByLabel('Percentage of income').fill('1')
    await expect(dlg.getByTestId('rule-amount')).toHaveText('€74.05')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    // a coat that takes more than the virtual account then holds: the top-up is offered, and says what it does to the rule
    await page.getByRole('button', { name: 'Expand all' }).click()
    await moneyOut.getByRole('button', { name: /^Clothing: €180\.00/ }).click()
    await dlg.getByLabel('Item amount').fill('3000')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg.getByRole('heading', { name: 'Clothing is short in November 2026' })).toBeVisible()
    await expect(dlg.getByTestId('top-up-rule')).toHaveText('What Clothing gets is worked out by its rule (1% of income). A top-up fixes it for November 2026 at what it is now, €74.05, plus the top-up; the rule goes on the month after.')
    await expect(dlg).toHaveCSS('opacity', '1')
    await page.screenshot({ path: 'e2e/output/statement-top-up-rule.png' })
    await dlg.getByRole('button', { name: 'Top up' }).click()
    await expect(dlg).toBeHidden()
    // November holds what the rule gave plus the top-up; December follows the rule again
    await expect(moneyOut.getByRole('button', { name: 'To Clothing: €2,650.00' })).toBeVisible()
    await goToMonth(page, 'December 2026')
    await expect(moneyOut.getByRole('button', { name: 'Rule for To Clothing: 1% of income' })).toBeVisible()
    await expect(moneyOut.getByRole('button', { name: /^To Clothing: €2,650\.00/ })).toHaveCount(0)
  })

  test('a virtual account that runs short stops at zero and offers a top-up that leaves a record', async ({ page }) => {
    await openStatement(page)
    await goToMonth(page, 'November 2026')
    const moneyIn = page.getByRole('region', { name: 'Money in' })
    const moneyOut = page.getByRole('region', { name: 'Money out' })
    const assets = page.getByRole('region', { name: 'Assets' })
    const dlg = page.getByRole('dialog')
    const rest = async () => euros(await moneyOut.locator('[data-line]').filter({ has: page.locator('[data-rule="rest"]') }).innerText())
    const balanced = async () => expect((await total(page, 'in').innerText()).replace(/^Total in\s*/, '')).toBe((await total(page, 'out').innerText()).replace(/^Total out\s*/, ''))
    const poolLine = assets.locator('[data-line^="pool:"]').filter({ hasText: 'Clothing' })
    await expect(poolLine).toContainText('€270.00')

    // €3,000 of clothing out of a virtual account that holds €450 this month
    await page.getByRole('button', { name: 'Expand all' }).click()
    await moneyOut.getByRole('button', { name: /^Clothing: €180\.00/ }).click()
    // the row holds one item this month, the winter coat
    await dlg.getByLabel('Item amount').fill('3000')
    await dlg.getByRole('button', { name: 'Save' }).click()

    // the top-up is offered straight away; "Not now" keeps the expense and leaves the virtual account short
    await expect(dlg.getByRole('heading', { name: 'Clothing is short in November 2026' })).toBeVisible()
    await expect(dlg).toContainText('€3,000.00 comes out of Clothing this month and it holds €450.00: €2,550.00 is missing.')
    await dlg.getByRole('button', { name: 'Not now' }).click()
    await expect(dlg).toBeHidden()
    await expect(poolLine).toContainText('short €2,550.00')
    await expect(poolLine).toContainText('€0.00')
    await expect(moneyIn.locator('[data-line^="src:"]').filter({ hasText: 'Clothing' }).first()).toContainText('€2,550.00 more than it held, taken from Savings')
    expect(await rest()).toBe(2369)
    await balanced()
    await page.screenshot({ path: 'e2e/output/statement-short.png', fullPage: true })

    // from the tag: top it up from the savings it sits in
    await assets.getByRole('button', { name: 'Top up Clothing' }).click()
    await expect(dlg.getByRole('radio', { name: /^Savings, not set aside · €/ })).toBeChecked()
    await expect(dlg.getByLabel('Amount in EUR')).toHaveValue('2550')
    const preview = dlg.getByTestId('top-up-preview')
    await expect(preview).toContainText('Money in · From Savings€2,550.00')
    await expect(preview).toContainText('Money out · To Clothing, this month€2,650.00')
    await expect(dlg.getByTestId('top-up-balance')).toHaveText('€0.00')
    // a set-aside with a fixed amount has nothing to warn about
    await expect(dlg.getByTestId('top-up-rule')).toHaveCount(0)
    await expect(dlg).toHaveCSS('opacity', '1')
    await page.screenshot({ path: 'e2e/output/statement-top-up-dialog.png' })
    // Enter twice in a row tops up once: the second press finds a save already on its way
    await dlg.getByLabel('Amount in EUR').focus()
    await page.evaluate(() => {
      const field = document.activeElement as HTMLElement
      for (let i = 0; i < 2; i++) field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    await expect(dlg).toBeHidden()

    // both lines are there, the tag is gone, and the rest of the month did not move
    const fromSavings = moneyIn.getByRole('button', { name: 'From Savings: €2,550.00' })
    await expect(fromSavings).toBeVisible()
    await expect(moneyIn.locator('[data-line]').filter({ has: page.getByRole('button', { name: 'From Savings: €2,550.00' }) })).toContainText('Top-up for Clothing')
    await expect(moneyIn.locator('[data-line]').filter({ has: page.getByRole('button', { name: 'From Savings: €2,550.00' }) })).not.toContainText('savings account')
    await expect(moneyOut.getByRole('button', { name: /^To Clothing: €2,650\.00/ })).toBeVisible()
    await expect(poolLine).not.toContainText('short')
    await expect(assets.getByRole('button', { name: 'Top up Clothing' })).toHaveCount(0)
    expect(await rest()).toBe(2369)
    await balanced()
    await page.screenshot({ path: 'e2e/output/statement-topped-up.png', fullPage: true })
    // December is back to the usual €100, with nothing taken from savings
    await goToMonth(page, 'December 2026')
    await expect(moneyOut.getByRole('button', { name: /^To Clothing: €100\.00/ })).toBeVisible()
    await expect(moneyIn.getByRole('button', { name: /^From Savings:/ })).toHaveAccessibleName('From Savings: empty')
  })

  test('the rest moves to a new savings account from its line in the lower half', async ({ page }) => {
    await page.goto('?demo=1')
    await page.getByRole('button', { name: 'Load the demo household' }).click()
    await page.getByRole('link', { name: 'Household' }).click()
    await page.getByRole('button', { name: 'Add account' }).click()
    const dlg = page.getByRole('dialog')
    await dlg.getByLabel('Name', { exact: true }).fill('Rainy day')
    await dlg.getByLabel('Type').selectOption('savings')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    await page.getByRole('navigation', { name: 'Screens' }).getByRole('link', { name: 'Statement' }).click()
    await goToMonth(page, 'November 2026')
    const moneyOut = page.getByRole('region', { name: 'Money out' })
    const assets = page.getByRole('region', { name: 'Assets' })

    // an account no row feeds yet says so, and its symbol sets the rule up
    await assets.getByRole('button', { name: 'Set a rule for Rainy day' }).click()
    await expect(dlg.getByRole('heading', { name: 'How much goes to Rainy day?' })).toBeVisible()
    await expect(dlg).toContainText('Saving adds the row "To Rainy day" under Transfers.')
    await dlg.getByRole('radio', { name: 'The rest' }).click()
    await expect(dlg).toContainText('"To savings" takes the rest now. From November 2026 on it comes here instead')
    await expect(dlg.getByTestId('rule-amount')).toHaveText('€2,369.00')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()

    // the rest is on the new account and its new row; the account that had it gets nothing more
    await expect(assets.getByRole('button', { name: 'Rule for Rainy day: the rest' })).toBeVisible()
    await expect(moneyOut.getByRole('button', { name: 'To Rainy day: €2,369.00' })).toBeVisible()
    await expect(assets.getByRole('button', { name: 'Rule for Savings: a fixed amount' })).toBeVisible()
    await expect(moneyOut.getByRole('button', { name: 'To savings: €0.00' })).toBeVisible()
    expect((await total(page, 'in').innerText()).replace(/^Total in\s*/, '')).toBe((await total(page, 'out').innerText()).replace(/^Total out\s*/, ''))
    // October went to Savings and still does
    await goToMonth(page, 'October 2026')
    await expect(moneyOut.getByRole('button', { name: /^To savings: €2,009\.00/ })).toBeVisible()
    await expect(moneyOut.getByRole('button', { name: /^To Rainy day: / })).toHaveAccessibleName('To Rainy day: €0.00')
    // one undo takes the whole change back, the new row with it
    await page.getByRole('button', { name: 'Undo' }).click()
    await goToMonth(page, 'November 2026')
    await expect(moneyOut.getByRole('button', { name: 'Rule for To savings: the rest' })).toBeVisible()
    await expect(assets.getByRole('button', { name: 'Set a rule for Rainy day' })).toBeVisible()

    // an investment account can take the rest too: its own €500 goes back into what is left first
    await assets.getByRole('button', { name: 'Rule for Index fund: a fixed amount' }).click()
    await dlg.getByRole('radio', { name: 'The rest' }).click()
    await expect(dlg).toContainText('A month that overruns takes the difference back out of Index fund: it shows as money taken out of the investments.')
    await expect(dlg.getByTestId('rule-amount')).toHaveText('€2,869.00')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    await expect(moneyOut.getByRole('button', { name: 'To investments: €2,869.00' })).toBeVisible()
    await expect(assets.getByRole('button', { name: 'Rule for Index fund: the rest' })).toBeVisible()
    await expect(moneyOut.getByRole('button', { name: 'To savings: €0.00' })).toBeVisible()
    expect((await total(page, 'in').innerText()).replace(/^Total in\s*/, '')).toBe((await total(page, 'out').innerText()).replace(/^Total out\s*/, ''))
  })

  test('an expense comes out of any account: the list names them, the account falls and "From accounts" says which paid', async ({ page }) => {
    await openStatement(page)
    await goToMonth(page, 'November 2026')
    const dlg = page.getByRole('dialog')
    const moneyIn = page.getByRole('region', { name: 'Money in' })
    const moneyOut = page.getByRole('region', { name: 'Money out' })
    const assets = page.getByRole('region', { name: 'Assets' })
    const balanced = async () => expect((await total(page, 'in').innerText()).replace(/^Total in\s*/, '')).toBe((await total(page, 'out').innerText()).replace(/^Total out\s*/, ''))
    const account = (name: string) => assets.locator('[data-line^="acc:"]').filter({ hasText: name })
    const paidFrom = (name: string) => moneyIn.locator('[data-line^="src:acc:"]').filter({ hasText: `From ${name}` }).first()

    // a second savings account: 1,000 when September began, and 50 a month from November on
    await assets.getByRole('button', { name: 'Add account' }).click()
    await dlg.getByLabel('Name', { exact: true }).fill('Rainy day')
    await dlg.getByLabel('Type').selectOption('savings')
    await dlg.getByLabel(/^Holds at the start of/).fill('1000')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg.getByRole('heading', { name: 'How much goes to Rainy day?' })).toBeVisible()
    await dlg.getByLabel('Amount per month in EUR').fill('50')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    await expect(account('Rainy day')).toContainText('€1,050.00')

    // the row's dialog lists this month's income, then every account that can pay under its kind, then the virtual accounts
    await moneyOut.getByRole('button', { name: 'Living', exact: true }).click()
    await moneyOut.getByRole('button', { name: /^Health:/ }).click()
    const source = dlg.getByLabel('Comes out of', { exact: true })
    await expect(source.locator('option')).toHaveText([
      "This month's income (row default)", 'Savings account: Savings', 'Savings account: Rainy day', 'Investment account: Index fund', 'Virtual account: Travel', 'Virtual account: Clothing',
    ])
    await source.selectOption({ label: 'Savings account: Rainy day' })
    await dlg.getByRole('textbox', { name: /^Amount in EUR/ }).fill('300')
    await settled(dlg)
    await page.screenshot({ path: 'e2e/output/statement-comes-out-of.png' })
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()

    // the expense is there in full, the account that paid is 300 lower, and "From accounts" names it and what it paid for
    await expect(moneyOut.getByRole('button', { name: /^Health:/ })).toHaveAccessibleName(/^Health: €300\.00/)
    await expect(account('Rainy day')).toContainText('€750.00')
    await expect(paidFrom('Rainy day')).not.toContainText('savings account')
    await expect(paidFrom('Rainy day')).toContainText('calculated')
    await expect(paidFrom('Rainy day')).toContainText('for Health')
    await expect(paidFrom('Rainy day')).toContainText('€300.00')
    await balanced()
    await page.screenshot({ path: 'e2e/output/statement-pay-from-account.png', fullPage: true })

    // the row menu sets it for the row from this month on: December comes out of the fund, November keeps what was picked for it
    await moneyOut.getByRole('button', { name: 'Row menu for Health' }).click()
    await page.getByRole('menuitem', { name: 'Comes out of…' }).click()
    const rowSource = dlg.getByLabel('Single amounts in this row come out of')
    await expect(rowSource.locator('option')).toHaveText([
      "This month's income", 'Savings account: Savings', 'Savings account: Rainy day', 'Investment account: Index fund', 'Virtual account: Travel', 'Virtual account: Clothing',
    ])
    await rowSource.selectOption({ label: 'Investment account: Index fund' })
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    await expect(paidFrom('Rainy day')).toContainText('€300.00')
    await expect(paidFrom('Index fund')).toHaveCount(0)
    await goToMonth(page, 'December 2026')
    await expect(paidFrom('Index fund')).not.toContainText('investment account')
    await expect(paidFrom('Index fund')).toContainText('for Health')
    await expect(paidFrom('Rainy day')).toHaveCount(0)
    await balanced()

    // which account pays is "Comes out of…". An expense names no account: the one this row still names, for the
    // overview, can only be taken off, and nothing puts it on a card
    await moneyOut.getByRole('button', { name: 'Row menu for Health' }).click()
    await expect(page.getByRole('menuitem', { name: 'Paid by card…' })).toHaveCount(0)
    await page.getByRole('menuitem', { name: 'Paid from…' }).click()
    await expect(dlg.getByLabel('Paid from', { exact: true }).locator('option')).toHaveText(['No account', 'Main account'])
    await expect(dlg).toContainText('Where the money comes out of is "Comes out of…"')
    await dlg.getByRole('button', { name: 'Cancel' }).click()
    await expect(dlg).toBeHidden()
  })

  test('an amount field takes a sum: the result shows under it, saving stores it, and * or / is refused in words', async ({ page }) => {
    await openStatement(page)
    await goToMonth(page, 'November 2026')
    const dlg = page.getByRole('dialog')
    const hint = dlg.getByTestId('amount-hint')
    const moneyOut = page.getByRole('region', { name: 'Money out' })
    const assets = page.getByRole('region', { name: 'Assets' })

    // what an account holds, typed as a sum: the line under the field says what it comes to
    await assets.getByRole('button', { name: 'Add account' }).click()
    await dlg.getByLabel('Name', { exact: true }).fill('Buffer')
    await dlg.getByLabel('Type').selectOption('savings')
    const holds = dlg.getByLabel(/^Holds at the start of/)
    await holds.fill('7352.21')
    await expect(hint).toHaveCount(0)
    await holds.fill('7352.21+7.96')
    await expect(hint).toHaveText('= €7,360.17')
    await settled(dlg)
    await page.screenshot({ path: 'e2e/output/amount-sum-account.png' })
    await dlg.getByRole('button', { name: 'Save' }).click()
    // the amount that goes to it each month is an amount field too
    await expect(dlg.getByRole('heading', { name: 'How much goes to Buffer?' })).toBeVisible()
    await dlg.getByLabel('Amount per month in EUR').fill('40 + 10')
    await expect(hint).toHaveText('= €50.00')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    await expect(assets.locator('[data-line^="acc:"]').filter({ hasText: 'Buffer' })).toContainText('€7,410.17')
    // the result is what is kept: the field shows it when it is opened again
    await editFrom(page, assets, 'Buffer')
    await expect(dlg.getByLabel(/^Holds at the start of/)).toHaveValue('7360.17')
    await dlg.getByRole('button', { name: 'Cancel' }).click()
    await expect(dlg).toBeHidden()

    // the row's dialog: a single amount as a sum
    await moneyOut.getByRole('button', { name: 'Living', exact: true }).click()
    await moneyOut.getByRole('button', { name: /^Health:/ }).click()
    await dlg.getByLabel('Amount in EUR').fill('30+12.50-0.5')
    await expect(hint).toHaveText('= €42.00')
    await settled(dlg)
    await page.screenshot({ path: 'e2e/output/amount-sum-row.png' })
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    await expect(moneyOut.getByRole('button', { name: /^Health:/ })).toHaveAccessibleName(/^Health: €42\.00/)

    // an item as a sum: its own line says the result and the items' total follows
    await moneyOut.getByRole('button', { name: /^Health:/ }).click()
    await dlg.getByRole('tab', { name: 'Itemized' }).click()
    await dlg.getByRole('button', { name: 'Add item' }).click()
    await dlg.getByLabel('Item label').last().fill('Physio')
    await dlg.getByLabel('Item amount').last().fill('20+5.5')
    await expect(hint).toHaveText('= €25.50')
    await expect(dlg.getByText('Total €67.50')).toBeVisible()
    await settled(dlg)
    await page.screenshot({ path: 'e2e/output/amount-sum-item.png' })
    // multiplying and dividing are not worked out: the field says so, and nothing is saved
    await dlg.getByLabel('Item amount').last().fill('1200/12')
    await expect(hint).toHaveCount(0)
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg.getByRole('alert')).toHaveText('Only + and - can be used in an amount.')
    await dlg.getByLabel('Item amount').last().fill('20+5.5')
    await expect(dlg.getByRole('alert')).toHaveCount(0)
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    await expect(moneyOut.getByRole('button', { name: /^Health:/ })).toHaveAccessibleName(/^Health: €67\.50/)

    // the same on a single amount: 700*2 is not read as 7002
    await moneyOut.getByRole('button', { name: /^Groceries:/ }).click()
    await dlg.getByLabel('Amount in EUR').fill('700*2')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg.getByRole('alert')).toHaveText('Only + and - can be used in an amount.')
    await dlg.getByRole('button', { name: 'Cancel' }).click()
    await expect(dlg).toBeHidden()
    await expect(moneyOut.getByRole('button', { name: /^Groceries:/ })).toHaveAccessibleName(/^Groceries: €700\.00/)
  })
})

test.describe('the Statement on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

  test('the strip of months fits a phone: it scrolls sideways, and the page does not', async ({ page }) => {
    await openStatement(page)
    await expect(page.getByRole('heading', { level: 2, name: 'November 2026' })).toBeVisible()
    const strip = page.getByRole('navigation', { name: 'Months' })
    const chip = (m: string) => strip.locator(`[data-month="${m}"]`)
    // a few chips fit: the months before the current one and the current one are in view, the rest is a swipe away
    await expect(chip('2026-09')).toBeInViewport({ ratio: 1 })
    await expect(chip('2026-11')).toBeInViewport({ ratio: 1 })
    await expect(chip('2026-11')).toContainText('7,405 + 660')
    await expect(chip('2027-03')).not.toBeInViewport()
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
    await page.screenshot({ path: 'e2e/output/statement-month-strip-phone.png' })
    // a chip opens its month, and the strip keeps the pressed chip in view
    await chip('2026-12').tap()
    await expect(page.getByRole('heading', { level: 2, name: 'December 2026' })).toBeVisible()
    await stepMonth(page, 1)
    await stepMonth(page, 1)
    await expect(chip('2027-02')).toHaveAttribute('aria-pressed', 'true')
    await expect(chip('2027-02')).toBeInViewport({ ratio: 1 })
    // the line under the strip wraps and the page still does not scroll sideways
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  })

  test('the row\'s dialog with its "Repeats" lines fits the screen', async ({ page }) => {
    await openStatement(page)
    await goToMonth(page, 'November 2026')
    const moneyOut = page.getByRole('region', { name: 'Money out' })
    const dlg = page.getByRole('dialog')
    const fits = async (l: Locator) => {
      const box = (await l.boundingBox())!
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width).toBeLessThanOrEqual(390)
    }
    await moneyOut.getByRole('button', { name: 'Living', exact: true }).tap()
    await moneyOut.getByRole('button', { name: /^Health:/ }).tap()
    // a single amount on a schedule in chosen months: the twelve boxes stay inside the dialog
    await dlg.getByRole('radio', { name: 'On a schedule' }).tap()
    await dlg.getByLabel('How often, Health').selectOption({ label: 'In chosen months' })
    await fits(dlg)
    await fits(dlg.getByRole('group', { name: 'Months, Health' }))
    await settled(dlg)
    await page.screenshot({ path: 'e2e/output/repeats-single-phone.png' })
    // an item with its own line under it
    await dlg.getByRole('tab', { name: 'Itemized' }).tap()
    await dlg.getByRole('button', { name: 'Add item' }).tap()
    await dlg.getByLabel('Item label').last().fill('Physio')
    await dlg.getByLabel('Item amount').last().fill('45')
    await dlg.getByLabel('Repeats, Physio').selectOption({ label: 'Every 3 months' })
    await fits(dlg.getByLabel('Repeats, Physio'))
    await fits(dlg.getByLabel('From which month, Physio'))
    await expect(dlg.getByTestId('repeat-lands')).toHaveText('Lands in Feb, May, Aug and Nov.')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.screenshot({ path: 'e2e/output/repeats-items-phone.png' })
  })

  test('the two sides stack, each with its own total', async ({ page }) => {
    await openStatement(page)
    await goToMonth(page, 'September 2026')
    const inBox = await total(page, 'in').boundingBox()
    const outBox = await total(page, 'out').boundingBox()
    expect(inBox && outBox && outBox.y > inBox.y + inBox.height).toBeTruthy()
    await expect(total(page, 'in')).toContainText('€7,255.00')
    await expect(total(page, 'out')).toContainText('€7,255.00')
    await page.screenshot({ path: 'e2e/output/statement-phone.png', fullPage: true })

    // an open month: a row keeps its 44 px tick and opens the editor on a tap
    await goToMonth(page, 'November 2026')
    await page.getByRole('region', { name: 'Money out' }).getByRole('button', { name: 'Housing', exact: true }).tap()
    const tick = page.getByRole('checkbox', { name: 'The flat – Utilities done' })
    const box = await tick.boundingBox()
    expect(box && box.width >= 44 && box.height >= 44).toBeTruthy()
    await tick.tap()
    await expect(tick).toBeChecked()
    await page.getByRole('button', { name: /^The flat – Utilities:/ }).tap()
    await expect(page.getByRole('dialog').getByLabel('Amount in EUR')).toHaveValue('210')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toBeHidden()
    await page.screenshot({ path: 'e2e/output/statement-phone-working.png', fullPage: true })

    // the main account's real balance on a phone: its two fields side by side
    await page.getByRole('region', { name: 'Assets' }).getByRole('button', { name: /^Main account balance:/ }).tap()
    const dlg = page.getByRole('dialog')
    await expect(dlg.getByRole('heading', { name: 'Main account · November 2026' })).toBeVisible()
    await dlg.getByLabel('At the end of November 2026 (EUR)').fill('1150')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await expect(dlg).toHaveCSS('opacity', '1')
    await page.screenshot({ path: 'e2e/output/statement-current-balance-phone.png' })
    await dlg.getByRole('button', { name: 'Cancel' }).tap()
    await expect(dlg).toBeHidden()
  })

  test('the row forms fit the screen: under "From what is left", and under Expenses where a loan is made with its row', async ({ page }) => {
    await openStatement(page)
    await goToMonth(page, 'November 2026')
    const moneyOut = page.getByRole('region', { name: 'Money out' })
    const dlg = page.getByRole('dialog')
    /** Nothing of a form reaches past the edge of the screen. */
    const fits = async (parts: Locator[]) => {
      for (const part of parts) {
        const box = await part.boundingBox()
        expect(box && box.x >= 0 && box.x + box.width <= 390).toBeTruthy()
      }
    }
    // how the rest is shared out: the question first, then the place, then the name
    await moneyOut.getByRole('button', { name: 'Add transfer row' }).tap()
    await moneyOut.getByLabel('What is it for?').selectOption('to-investment')
    await moneyOut.getByLabel('Which one').selectOption({ label: 'New investment account…' })
    await fits([moneyOut.getByLabel('What is it for?'), moneyOut.getByLabel('Which one'), moneyOut.getByLabel('New transfer row name'), moneyOut.getByRole('button', { name: 'Cancel' }), moneyOut.getByTestId('add-row-text')])
    await moneyOut.getByLabel('What is it for?').scrollIntoViewIfNeeded()
    await page.screenshot({ path: 'e2e/output/statement-row-first-phone.png' })
    await moneyOut.getByRole('button', { name: 'Cancel' }).tap()
    // a loan is paid off from under Expenses
    await moneyOut.getByRole('button', { name: 'Add expense row' }).tap()
    await moneyOut.getByLabel('What the new expense row does').selectOption('pay-off')
    await moneyOut.getByLabel('Account for the new expense row').selectOption({ label: 'New loan…' })
    await fits([moneyOut.getByLabel('What the new expense row does'), moneyOut.getByLabel('Account for the new expense row'), moneyOut.getByLabel('New expense row name'), moneyOut.getByRole('button', { name: 'Cancel' }), moneyOut.getByTestId('add-row-text')])
    await moneyOut.getByLabel('What the new expense row does').scrollIntoViewIfNeeded()
    await page.screenshot({ path: 'e2e/output/statement-loan-row-phone.png' })
    await moneyOut.getByRole('button', { name: 'Add', exact: true }).tap()
    await dlg.getByLabel('Name', { exact: true }).fill('Car loan')
    await expect(dlg.getByTestId('acc-row')).toHaveText('Saving also adds the row "Car loan – Payment", linked to this account.')
    await dlg.getByLabel(/^Owed at the start of/).fill('5000')
    await expect(dlg).toHaveCSS('opacity', '1')
    await page.screenshot({ path: 'e2e/output/statement-row-first-account-phone.png' })
    await dlg.getByRole('button', { name: 'Save' }).tap()
    await expect(dlg.getByRole('heading', { name: 'Car loan – Payment · November 2026' })).toBeVisible()
    await dlg.getByRole('button', { name: 'Cancel' }).tap()
    const payment = moneyOut.locator('[data-line]').filter({ hasText: 'Car loan – Payment' })
    await expect(payment).toBeVisible()

    // on a phone the tick is finger-sized, and the add controls keep to its column and to the names'
    const tick = moneyOut.getByRole('checkbox', { name: 'To investments done' })
    const name = moneyOut.getByRole('button', { name: /^To investments:/ })
    const addRow = moneyOut.getByRole('button', { name: 'Add transfer row' })
    expect(await middleOf(addRow.locator('[data-lead="plus"]'))).toBeCloseTo(await middleOf(tick), 0)
    expect(await leftOf(addRow.locator('[data-lead="text"]'))).toBeCloseTo(await leftOf(name), 0)

    // the link symbol is finger-sized, and a tap takes the page to the loan
    const link = moneyOut.getByRole('button', { name: 'Pays off Car loan: go there' })
    const box = await link.boundingBox()
    expect(box && box.width >= 32 && box.height >= 32).toBeTruthy()
    await link.tap()
    const loan = page.getByRole('region', { name: 'Debts and net worth' }).locator('[data-line^="acc:"]').filter({ hasText: 'Car loan' })
    await expect(loan).toHaveAttribute('data-marked', 'true')
    await expect(loan).toBeInViewport()
    await page.screenshot({ path: 'e2e/output/statement-links-phone.png' })
  })

  test('what does not fit beside a line\'s name goes to a second line that starts under the name', async ({ page }) => {
    await openStatement(page)
    await goToMonth(page, 'November 2026')
    const moneyIn = page.getByRole('region', { name: 'Money in' })
    // a calculated line: its arrow and the tick's place stand before the name, its notes after it
    const line = moneyIn.locator('[data-line^="src:"]').filter({ hasText: 'From Clothing' }).first()
    const name = (await line.getByText('From Clothing', { exact: true }).boundingBox())!
    const notes = await Promise.all(['virtual account', 'calculated', 'for Clothing'].map(async (text) => (await line.getByText(text, { exact: true }).boundingBox())!))
    const below = notes.filter((b) => b.y > name.y + name.height / 2)
    // on a phone they do not all fit beside the name
    expect(below.length).toBeGreaterThan(0)
    // the second line starts where the name starts, not under the arrow
    expect(Math.min(...below.map((b) => b.x))).toBeCloseTo(name.x, 0)
    for (const b of notes) expect(b.x).toBeGreaterThanOrEqual(name.x - 0.5)
    await line.scrollIntoViewIfNeeded()
    await page.screenshot({ path: 'e2e/output/statement-wrapped-notes-phone.png' })
  })

  test('a sum in an amount field shows its result on a phone too', async ({ page }) => {
    await openStatement(page)
    await goToMonth(page, 'November 2026')
    const dlg = page.getByRole('dialog')
    const moneyOut = page.getByRole('region', { name: 'Money out' })
    await moneyOut.getByRole('button', { name: 'Living', exact: true }).click()
    await moneyOut.getByRole('button', { name: /^Health:/ }).click()
    await dlg.getByLabel('Amount in EUR').fill('30+12.50')
    const hint = dlg.getByTestId('amount-hint')
    await expect(hint).toHaveText('= €42.50')
    const box = (await hint.boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(390)
    await settled(dlg)
    await page.screenshot({ path: 'e2e/output/amount-sum-phone.png' })
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
    await expect(moneyOut.getByRole('button', { name: /^Health:/ })).toHaveAccessibleName(/^Health: €42\.50/)
  })
})
