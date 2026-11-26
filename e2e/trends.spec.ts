import { expect, openMonth, test, type Locator, type Page } from './test'

/** The last amount a line of the Statement shows (its figure; a change stands before it), as the tiles say it: without cents. */
async function figure(line: Locator): Promise<string> {
  const amounts = (await line.innerText()).match(/-?€[\d,]+\.\d\d/g) ?? []
  const last = amounts[amounts.length - 1] ?? ''
  return `€${Math.round(Number(last.replace(/[€,]/g, ''))).toLocaleString('en-IE')}`
}
/** The same with its cents, as the list beside the pointer says it. */
async function exact(line: Locator): Promise<string> {
  const amounts = (await line.innerText()).match(/-?€[\d,]+\.\d\d/g) ?? []
  return amounts[amounts.length - 1] ?? ''
}

async function loadDemo(page: Page) {
  await page.goto('?demo=1')
  await page.getByRole('button', { name: 'Load the demo household' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Statement' })).toBeVisible()
}
async function openTrends(page: Page) {
  await page.getByRole('navigation', { name: 'Screens' }).getByRole('link', { name: 'Trends' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Trends' })).toBeVisible()
}
const tile = (page: Page, name: string) => page.getByTestId('trend-tiles').getByRole('button', { name: new RegExp(`^${name}:`) })
const chart = (page: Page) => page.locator('[data-chart="lines"]')

test.describe('Trends', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('the tiles say what the Statement says for the current month, and how it moved from the month before', async ({ page }) => {
    await loadDemo(page)
    // what the Statement says for November
    await page.getByRole('button', { name: 'Expand all' }).click()
    const statement = {
      netWorth: await figure(page.locator('[data-line="net-worth"]').first()),
      income: await figure(page.locator('[data-line="income"]').first()),
      expenses: await figure(page.locator('[data-line="expenses"]').first()),
      accounts: await figure(page.getByTestId('total-assets')),
      debts: await figure(page.locator('[data-line="debts"]').first()),
    }
    expect(statement.income).toBe('€7,405')
    await openMonth(page, 'October 2026')
    const before = await figure(page.locator('[data-line="net-worth"]').first())

    await openTrends(page)
    await expect(page.getByRole('navigation', { name: 'Screens' }).getByRole('link', { name: 'Trends' })).toHaveAttribute('aria-current', 'page')
    expect(new URL(page.url()).searchParams.get('screen')).toBe('trends')
    const tiles = page.getByTestId('trend-tiles')
    await expect(tiles.getByRole('heading', { name: 'November 2026' })).toBeVisible()
    await expect(tiles.getByRole('button')).toHaveCount(6) // the five tiles and the (i)
    await expect(tile(page, 'Net worth')).toContainText(statement.netWorth)
    await expect(tile(page, 'Income')).toContainText(statement.income)
    await expect(tile(page, 'Expenses')).toContainText(statement.expenses)
    await expect(tile(page, 'Accounts')).toContainText(statement.accounts)
    await expect(tile(page, 'Debts')).toContainText(statement.debts)
    // the change is against October
    const num = (s: string) => Number(s.replace(/[€,]/g, ''))
    const up = `€${(num(statement.netWorth) - num(before)).toLocaleString('en-IE')}`
    await expect(tile(page, 'Net worth')).toHaveAccessibleName(`Net worth: ${statement.netWorth}, up ${up} from October 2026`)
    await page.screenshot({ path: 'e2e/output/trends.png', fullPage: true })
  })

  test('a tile is a switch: its subject is a line on the chart, any number at once, and the device remembers them', async ({ page }) => {
    await loadDemo(page)
    await openTrends(page)
    // net worth is on at first
    await expect(tile(page, 'Net worth')).toHaveAttribute('aria-pressed', 'true')
    await expect(tile(page, 'Income')).toHaveAttribute('aria-pressed', 'false')
    await expect(chart(page).locator('[data-line]')).toHaveCount(1)
    await expect(chart(page).locator('[data-line="netWorth"]')).toHaveCount(1)
    // what is over is one part of the line, the plan another, and the current month is marked
    await expect(chart(page).locator('[data-line="netWorth"] [data-part="past"]')).toHaveCount(1)
    await expect(chart(page).locator('[data-line="netWorth"] [data-part="plan"]')).toHaveAttribute('stroke-dasharray', /\d/)
    await expect(chart(page).locator('[data-now]')).toContainText('now')

    await tile(page, 'Income').click()
    await tile(page, 'Expenses').click()
    await expect(chart(page).locator('[data-line]')).toHaveCount(3)
    // every line is named at its end
    await expect(chart(page).locator('[data-end]')).toHaveText(['Net worth', 'Income', 'Expenses'])
    await page.reload()
    await expect(page.getByRole('heading', { level: 1, name: 'Trends' })).toBeVisible()
    await expect(tile(page, 'Expenses')).toHaveAttribute('aria-pressed', 'true')
    await expect(chart(page).locator('[data-line]')).toHaveCount(3)

    // all off: the chart says what to do
    for (const name of ['Net worth', 'Income', 'Expenses']) await tile(page, name).click()
    await expect(page.getByTestId('trend-amounts')).toContainText('Press a tile above to put it on the chart.')
    await expect(chart(page)).toHaveCount(0)
  })

  test('pointing at a month lists what its Statement says, with the mouse and with the arrow keys', async ({ page }) => {
    await loadDemo(page)
    await page.getByRole('button', { name: 'Expand all' }).click()
    const november = { netWorth: await exact(page.locator('[data-line="net-worth"]').first()), expenses: await exact(page.locator('[data-line="expenses"]').first()) }
    await openMonth(page, 'December 2026')
    const december = await exact(page.locator('[data-line="net-worth"]').first())

    await openTrends(page)
    await tile(page, 'Expenses').click()
    const tip = page.getByTestId('chart-tip')
    await expect(tip).toHaveCount(0)
    // the keyboard: the chart is one stop, the arrows move along the months
    await chart(page).focus()
    await page.keyboard.press('Home')
    await expect(tip).toContainText('September 2026')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowRight')
    await expect(tip).toContainText('November 2026 · now')
    await expect(tip).toContainText(`${november.netWorth} Net worth`)
    await expect(tip).toContainText(`${november.expenses} Expenses`)
    await expect(tip).toContainText('from Oct 2026')
    await page.keyboard.press('ArrowRight')
    await expect(tip).toContainText('December 2026 · plan')
    await expect(tip).toContainText(`${december} Net worth`)
    await page.keyboard.press('Escape')
    await expect(tip).toHaveCount(0)

    // the mouse finds a month anywhere over the plot, not only on a line
    const box = (await chart(page).boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + 40)
    await expect(tip).toBeVisible()
    await expect(chart(page).locator('[data-pointer] circle')).toHaveCount(2)
    await page.screenshot({ path: 'e2e/output/trends-pointer.png' })
    await page.mouse.move(box.x + box.width / 2, box.y - 60)
    await expect(tip).toHaveCount(0)
  })

  test('"10 years" lets the lines run past the plan, and the plan stays as long as it was', async ({ page }) => {
    await loadDemo(page)
    await openTrends(page)
    await expect(page.getByText('Demo household · Sept 2026 – Dec 2027')).toBeVisible()
    const ahead = page.getByRole('radiogroup', { name: 'How far ahead' })
    await expect(ahead.getByRole('radio')).toHaveText(['Plan', '3 years', '5 years', '10 years'])
    await expect(ahead.getByRole('radio', { name: 'Plan' })).toHaveAttribute('aria-checked', 'true')
    await ahead.getByRole('radio', { name: '10 years' }).click()
    await expect(page.getByText('Demo household · Sept 2026 – Dec 2036')).toBeVisible()
    // the rent goes on after the plan's last December: December 2036 still has expenses
    await tile(page, 'Expenses').click()
    await chart(page).focus()
    await page.keyboard.press('End')
    const tip = page.getByTestId('chart-tip')
    await expect(tip).toContainText('December 2036 · plan')
    await expect(tip).toContainText(/€[3-9],\d{3}\.\d\d Expenses/)
    await page.screenshot({ path: 'e2e/output/trends-10-years.png', fullPage: true })
    // remembered on this device
    await page.reload()
    await expect(ahead.getByRole('radio', { name: '10 years' })).toHaveAttribute('aria-checked', 'true')

    // the Statement's plan is as long as it was
    await page.getByRole('navigation', { name: 'Screens' }).getByRole('link', { name: 'Statement' }).click()
    const strip = page.getByRole('navigation', { name: 'Months' })
    await expect(strip.locator('[data-month]')).toHaveCount(16)
    await expect(strip.getByRole('button', { name: 'Add 2028' })).toHaveCount(1)
    await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled()
  })
})

test.describe('Trends: the change from the month before', () => {
  test.use({ viewport: { width: 1440, height: 900 } })
  const changes = (page: Page) => page.locator('[data-chart="changes"]')

  test('a row of bars per subject on the charts, on the same months, and one pointer through both charts', async ({ page }) => {
    await loadDemo(page)
    await page.getByRole('button', { name: 'Expand all' }).click()
    // the Statement's own change column for net worth in November, and the amount beside it
    const line = (await page.locator('[data-line="net-worth"]').first().innerText()).match(/[+-]?€[\d,]+\.\d\d/g)!
    const [change, amount] = [line[0], line[line.length - 1]]
    expect(change).toMatch(/^\+€/)

    await openTrends(page)
    await expect(page.getByTestId('trend-changes').getByRole('heading', { name: 'Change from the month before' })).toBeVisible()
    await expect(changes(page).locator('[data-row]')).toHaveCount(1)
    // sixteen months: fifteen have a month before them
    const bars = changes(page).locator('[data-row="netWorth"] [data-bar]')
    await expect(bars).toHaveCount(15)
    // October is over; November and later are the plan, paler
    await expect(changes(page).locator('[data-row="netWorth"] [data-bar]:not([data-plan])')).toHaveCount(1)
    await tile(page, 'Expenses').click()
    await expect(changes(page).locator('[data-row]')).toHaveCount(2)
    await expect(changes(page).locator('[data-row]').locator('text').first()).toContainText('Net worth')

    // a month stands at the same place in both charts
    const upper = (await chart(page).locator('[data-now] line').boundingBox())!
    const lower = (await changes(page).locator('[data-now]').boundingBox())!
    expect(Math.abs(upper.x - lower.x)).toBeLessThan(1)

    // the bars say the change the Statement says
    await changes(page).focus()
    await page.keyboard.press('Home')
    const tip = page.getByTestId('chart-tip')
    await expect(tip).toContainText('September 2026')
    await expect(tip).toContainText('nothing before it to compare with')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowRight')
    await expect(tip).toContainText('November 2026 · now')
    await expect(tip).toContainText(`${change} Net worth`)
    await expect(tip).toContainText(`${amount} at its end`)
    await expect(tip).toContainText('in the month')
    // one pointer, in both charts; only the chart that has the focus speaks
    await expect(tip).toHaveCount(1)
    await expect(chart(page).locator('[data-pointer]')).toHaveCount(1)
    await expect(changes(page).locator('[data-pointer]')).toHaveCount(1)
    const a = (await chart(page).locator('[data-pointer] line').boundingBox())!
    const b = (await changes(page).locator('[data-pointer]').boundingBox())!
    expect(Math.abs(a.x - b.x)).toBeLessThan(1)
    await page.screenshot({ path: 'e2e/output/trends-changes.png', fullPage: true })

    // no subject on: no bars
    await page.keyboard.press('Escape')
    await tile(page, 'Net worth').click()
    await tile(page, 'Expenses').click()
    await expect(page.getByTestId('trend-changes')).toHaveCount(0)
  })

  test('on a long range the bars are per year, and a first year that is only partly in view is not compared', async ({ page }) => {
    await loadDemo(page)
    await openTrends(page)
    await tile(page, 'Income').click()
    await page.getByRole('radio', { name: '10 years' }).click()
    await expect(page.getByTestId('trend-changes').getByRole('heading', { name: 'Change from the year before' })).toBeVisible()
    // 2026 has nothing before it; 2027 to 2036 each have a bar for net worth
    await expect(changes(page).locator('[data-row="netWorth"] [data-bar]')).toHaveCount(10)
    await changes(page).focus()
    await page.keyboard.press('Home')
    const tip = page.getByTestId('chart-tip')
    await expect(tip).toContainText('2026 · 4 months')
    // the income of 2027 is a whole year's, that of 2026 four months': not compared
    for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight')
    await expect(tip).toContainText('2027 · plan')
    await expect(tip).toContainText('a year that is only partly in view is not compared')
    await expect(tip).toContainText('at the end of the year')
    await page.keyboard.press('End')
    await expect(tip).toContainText('2036 · plan')
    await expect(tip).toContainText('no change Income')
    // the income did not move from 2028 on: its row says so instead of a scale
    await expect(changes(page).locator('[data-row="income"]')).toContainText('Income · no change')
    await page.screenshot({ path: 'e2e/output/trends-changes-years.png', fullPage: true })
    // back to three years: months again
    await page.getByRole('radio', { name: '3 years' }).click()
    await expect(page.getByTestId('trend-changes').getByRole('heading', { name: 'Change from the month before' })).toBeVisible()
    await expect(changes(page).locator('[data-row="netWorth"] [data-bar]')).toHaveCount(39)
  })
})

test.describe('Trends: one subject as its parts', () => {
  test.use({ viewport: { width: 1440, height: 900 } })
  const parts = (page: Page) => page.locator('[data-chart="parts"]')
  const legend = (page: Page) => page.getByTestId('chart-legend').getByRole('listitem')
  const only = async (page: Page, name: string) => {
    // every tile off, then the one wanted
    const pressed = page.locator('[data-subject-tile][aria-pressed="true"]')
    while ((await pressed.count()) > 0) await pressed.first().click()
    await tile(page, name).click()
  }

  test('"Breakdown" turns one subject\'s line into columns stacked from its parts, named under the chart', async ({ page }) => {
    await loadDemo(page)
    await openTrends(page)
    const amounts = page.getByTestId('trend-amounts')
    // one subject on: it can be read as its total or as its parts
    const as = amounts.getByRole('radiogroup', { name: 'Net worth as' })
    await expect(as.getByRole('radio')).toHaveText(['Total', 'Breakdown'])
    await expect(as.getByRole('radio', { name: 'Total' })).toHaveAttribute('aria-checked', 'true')
    // two on: nothing to break down
    await tile(page, 'Expenses').click()
    await expect(amounts.getByRole('radiogroup')).toHaveCount(0)

    await only(page, 'Expenses')
    await amounts.getByRole('radio', { name: 'Breakdown' }).click()
    await expect(chart(page)).toHaveCount(0)
    await expect(parts(page).locator('[data-column]')).toHaveCount(16)
    // the Statement's categories, in its order; six of them, so there is no "Other"
    await expect(legend(page)).toHaveText(['Housing', 'Living', 'Transport', 'Family & pets', 'Fun', 'Personal'])
    // September and October are over; the plan's columns are paler
    await expect(parts(page).locator('[data-column]:not([data-plan])')).toHaveCount(2)
    // a column says its total and every part, as the Statement has them for November
    await parts(page).focus()
    await page.keyboard.press('ArrowRight')
    const tip = page.getByTestId('chart-tip')
    await expect(tip).toContainText('November 2026 · now')
    await expect(tip).toContainText('€3,896.00 Expenses')
    for (const part of ['€1,860.00 Housing', '€730.00 Living', '€98.00 Transport', '€380.00 Family & pets', '€678.00 Fun', '€150.00 Personal']) await expect(tip).toContainText(part)
    await page.screenshot({ path: 'e2e/output/trends-breakdown.png', fullPage: true })
    await page.keyboard.press('Escape')
    // the change bars stay under it
    await expect(page.locator('[data-chart="changes"] [data-row]')).toHaveCount(1)

    // remembered; and a second subject brings the lines back
    await page.reload()
    await expect(parts(page).locator('[data-column]')).toHaveCount(16)
    await tile(page, 'Income').click()
    await expect(parts(page)).toHaveCount(0)
    await expect(chart(page).locator('[data-line]')).toHaveCount(2)
    await tile(page, 'Income').click()
    await expect(parts(page)).toHaveCount(1)
    await amounts.getByRole('radio', { name: 'Total' }).click()
    await expect(chart(page).locator('[data-line="expenses"]')).toHaveCount(1)
    // the (i) beside the switch says what the parts are
    await amounts.getByRole('button', { name: 'About Breakdown' }).click()
    await expect(page.getByText('The six largest parts have a colour of their own', { exact: false })).toBeVisible()
  })

  test('net worth is what you have above the line and what you owe below it, with the net worth line across; accounts are named one by one', async ({ page }) => {
    await loadDemo(page)
    await openTrends(page)
    await page.getByTestId('trend-amounts').getByRole('radio', { name: 'Breakdown' }).click()
    await expect(legend(page)).toHaveText(['Main account', 'Savings accounts', 'Investment accounts', 'Debts', 'Net worth'])
    await expect(parts(page).locator('[data-across] path')).toHaveCount(1)
    await parts(page).focus()
    await page.keyboard.press('ArrowRight')
    const tip = page.getByTestId('chart-tip')
    await expect(tip).toContainText('Net worth')
    // what is owed is a negative part
    await expect(tip).toContainText('-€1,635.00 Debts')
    await page.keyboard.press('Escape')
    await page.screenshot({ path: 'e2e/output/trends-breakdown-net-worth.png', fullPage: true })

    await only(page, 'Accounts')
    await expect(legend(page).first()).toHaveText('Main account')
    await expect(legend(page).filter({ hasText: /^Savings$/ })).toHaveCount(1)
    await expect(parts(page).locator('[data-across]')).toHaveCount(0)

    // a long range: a column per year
    await page.getByRole('radio', { name: '10 years' }).click()
    await expect(parts(page).locator('[data-column]')).toHaveCount(11)
    await parts(page).focus()
    await page.keyboard.press('End')
    await expect(tip).toContainText('2036 · plan')
    await expect(tip).toContainText('Accounts')
  })
})

test.describe('Trends: goals', () => {
  test.use({ viewport: { width: 1440, height: 900 } })
  const goals = (page: Page) => page.getByTestId('trend-goals')
  const said = (page: Page) => page.getByRole('list', { name: 'Goals on the chart' }).getByRole('listitem')

  /** A goal set on the Statement, on the line it watches. */
  async function setGoal(page: Page, region: string, line: string, name: string, target: string, due?: { month: string; year: string }) {
    await page.getByRole('navigation', { name: 'Screens' }).getByRole('link', { name: 'Statement' }).click()
    await page.getByRole('region', { name: region }).getByRole('button', { name: `Set a goal for ${line}` }).click()
    const dlg = page.getByRole('dialog')
    await dlg.getByLabel('Name').fill(name)
    await dlg.getByLabel(/^Target \(EUR\)/).fill(target)
    if (due) {
      await dlg.getByLabel('Target month: month').selectOption(due.month)
      await dlg.getByLabel('Target month: year').selectOption(due.year)
    }
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toBeHidden()
  }

  test('a net worth goal is drawn on the net worth line: its amount across, a flag where it is due, a dot where the plan gets there', async ({ page }) => {
    await loadDemo(page)
    await openTrends(page)
    // a household without goals has no row of them
    await expect(goals(page)).toHaveCount(0)

    // net worth is about 28,000 and grows by about 2,400 a month: 50,000 is reached after June 2027
    await setGoal(page, 'Debts and net worth', 'Net worth', 'House', '50000', { month: '6', year: '2027' })
    await openTrends(page)
    const chip = goals(page).getByRole('button', { name: /^House/ })
    await expect(chip).toHaveAttribute('aria-pressed', 'true')
    await expect(chip).toContainText(/House\s*5\d%/)
    const target = chart(page).locator('[data-target]')
    await expect(target).toHaveCount(1)
    await expect(target).toContainText('House: €50,000 by Jun 2027')
    await expect(target.locator('[data-due]')).toHaveCount(1)
    await expect(chart(page).locator('[data-reached]')).toHaveCount(1)
    // the flag stands before the dot: the plan gets there after the month it is due
    const due = (await target.locator('[data-due]').boundingBox())!
    const reached = (await chart(page).locator('[data-reached]').boundingBox())!
    expect(reached.x).toBeGreaterThan(due.x + due.width)
    // the Statement's own sentence
    await expect(said(page)).toHaveCount(1)
    await expect(said(page)).toContainText(/House: €26,330\.\d\d of €50,000\.00 · reached by \w+ 2027, after the target of Jun 2027/)
    await page.screenshot({ path: 'e2e/output/trends-goal.png', fullPage: true })

    // the chip is a switch, remembered on the device
    await chip.click()
    await expect(chip).toHaveAttribute('aria-pressed', 'false')
    await expect(target).toHaveCount(0)
    await expect(said(page)).toHaveCount(0)
    await page.reload()
    await expect(chip).toHaveAttribute('aria-pressed', 'false')
    await chip.click()
    await expect(target).toHaveCount(1)

    // it is drawn on the net worth line: without that line it is off, and turning it on brings the line back
    await tile(page, 'Net worth').click()
    await expect(chip).toHaveAttribute('aria-pressed', 'false')
    await tile(page, 'Income').click()
    await expect(chart(page).locator('[data-target]')).toHaveCount(0)
    await chip.click()
    await expect(tile(page, 'Net worth')).toHaveAttribute('aria-pressed', 'true')
    await expect(chart(page).locator('[data-target]')).toHaveCount(1)
    await expect(chart(page).locator('[data-line]')).toHaveCount(2)
    // the (i) of the row
    await goals(page).getByRole('button', { name: 'About Goals on the chart' }).click()
    await expect(page.getByText('the dashed gold line is its amount', { exact: false })).toBeVisible()
  })

  test('a goal the plan does not reach can be reached by looking further ahead', async ({ page }) => {
    await loadDemo(page)
    await setGoal(page, 'Debts and net worth', 'Net worth', 'Freedom', '200000')
    await openTrends(page)
    await expect(said(page)).toContainText('Freedom: €26,330')
    await expect(said(page)).toContainText('not reached in the next 13 months')
    await expect(chart(page).locator('[data-target]')).toContainText('Freedom: €200,000')
    await expect(chart(page).locator('[data-reached]')).toHaveCount(0)
    await page.getByRole('radio', { name: '10 years' }).click()
    await expect(said(page)).toContainText(/Freedom: .* · reached by \w+ 203\d/)
    await expect(chart(page).locator('[data-reached]')).toHaveCount(1)
    await page.screenshot({ path: 'e2e/output/trends-goal-10-years.png', fullPage: true })
  })

  test('a goal on a virtual account brings that balance as a line of its own, with its amount across', async ({ page }) => {
    await loadDemo(page)
    await setGoal(page, 'Assets', 'Travel', 'Travel fund', '1000', { month: '6', year: '2027' })
    await openTrends(page)
    const chip = goals(page).getByRole('button', { name: /^Travel fund/ })
    // only net worth goals are on by themselves
    await expect(chip).toHaveAttribute('aria-pressed', 'false')
    await expect(chart(page).locator('[data-line]')).toHaveCount(1)
    await expect(page.getByTestId('trend-amounts').getByRole('radiogroup')).toHaveCount(1)
    await chip.click()
    await expect(chip).toHaveAttribute('aria-pressed', 'true')
    await expect(chart(page).locator('[data-line]')).toHaveCount(2)
    await expect(chart(page).locator('[data-end]')).toHaveText(['Net worth', 'Travel'])
    await expect(chart(page).locator('[data-target]')).toContainText('Travel fund: €1,000 by Jun 2027')
    await expect(said(page)).toContainText('Travel fund:')
    // a line of its own is on: nothing to break down
    await expect(page.getByTestId('trend-amounts').getByRole('radiogroup')).toHaveCount(0)
    // the pointer reads the balance too
    await chart(page).focus()
    await page.keyboard.press('ArrowRight')
    await expect(page.getByTestId('chart-tip')).toContainText(/€\d[\d,]*\.\d\d Travel/)
    await page.keyboard.press('Escape')
    // alone on the chart, it has the chart's scale to itself
    await tile(page, 'Net worth').click()
    await expect(chart(page).locator('[data-line]')).toHaveCount(1)
    await page.screenshot({ path: 'e2e/output/trends-goal-balance.png', fullPage: true })
  })
})

test.describe('Trends: the figures as a table', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('folded away under the charts: a row per month and a column per line, with the change under each amount', async ({ page }) => {
    await loadDemo(page)
    await page.getByRole('button', { name: 'Expand all' }).click()
    const netWorth = (await page.locator('[data-line="net-worth"]').first().innerText()).match(/[+-]?€[\d,]+\.\d\d/g)!
    await openTrends(page)
    await tile(page, 'Expenses').click()
    const island = page.getByTestId('trend-table')
    const table = page.getByTestId('trend-figures')
    await expect(table).toHaveCount(0)
    await island.getByRole('button', { name: 'Figures as a table' }).click()
    await expect(table.getByRole('columnheader')).toHaveText(['Month', 'Net worth', 'Expenses'])
    await expect(table.getByRole('rowheader')).toHaveCount(16)
    // September has nothing before it; November is the current month and says what the Statement says
    const september = table.getByRole('row', { name: /^Sept 2026/ })
    await expect(september.getByRole('cell').first()).toContainText('–')
    const november = table.getByRole('row', { name: /^Nov 2026 · now/ })
    await expect(november.getByRole('cell').first()).toContainText(netWorth[netWorth.length - 1])
    await expect(november.getByRole('cell').first()).toContainText(netWorth[0])
    await expect(november.getByRole('cell').nth(1)).toContainText('€3,896.00')
    await expect(table.getByRole('row', { name: /^Dec 2026 · plan/ })).toHaveCount(1)
    await expect(table.getByRole('row', { name: /^Oct 2026/ })).not.toContainText('plan')
    await page.screenshot({ path: 'e2e/output/trends-table.png', fullPage: true })

    // one subject as its parts: its total, then a column per part
    await tile(page, 'Net worth').click()
    await page.getByTestId('trend-amounts').getByRole('radio', { name: 'Breakdown' }).click()
    await expect(table.getByRole('columnheader')).toHaveText(['Month', 'Expenses', 'Housing', 'Living', 'Transport', 'Family & pets', 'Fun', 'Personal'])
    await expect(table.getByRole('row', { name: /^November 2026 · now/ }).getByRole('cell')).toContainText(['€3,896.00', '€1,860.00', '€730.00', '€98.00', '€380.00', '€678.00', '€150.00'])
    // by year on a long range
    await page.getByRole('radio', { name: '10 years' }).click()
    await expect(table.getByRole('rowheader')).toHaveCount(11)
    await expect(table.getByRole('rowheader').first()).toHaveText('2026 · 4 months · now')
    // it folds away again
    await island.getByRole('button', { name: 'Figures as a table' }).click()
    await expect(table).toHaveCount(0)
  })
})

test.describe('Trends on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

  test('fits the screen: the tiles two abreast, the chart as wide as the page, a tap reads a month', async ({ page }) => {
    await loadDemo(page)
    await openTrends(page)
    const a = (await tile(page, 'Net worth').boundingBox())!
    const b = (await tile(page, 'Income').boundingBox())!
    expect(Math.abs(a.y - b.y)).toBeLessThan(2)
    expect(b.x).toBeGreaterThan(a.x + a.width)
    await tile(page, 'Income').tap()
    await expect(chart(page).locator('[data-line]')).toHaveCount(2)
    // too narrow to name the lines at their ends: the tiles are the legend
    await expect(chart(page).locator('[data-end]')).toHaveCount(0)
    const box = (await chart(page).boundingBox())!
    await page.touchscreen.tap(box.x + box.width / 2, box.y + 60)
    await expect(page.getByTestId('chart-tip')).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
    await page.screenshot({ path: 'e2e/output/trends-phone.png', fullPage: true })
  })
})
