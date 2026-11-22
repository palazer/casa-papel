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
