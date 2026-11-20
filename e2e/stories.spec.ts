import { expect, openMonth, stepMonth, test, type Locator, type Page } from './test'

/**
 * Whole stories through the screens, with the household and the numbers of the scenario catalogue
 * (`scenarios/*.feature`). The scenarios run on the calculation code and call what the dialogs call; these few check
 * that the dialogs do call it, and that the Statement shows the same figures.
 */

const WIDE = { width: 1400, height: 1000 }

interface Screen {
  moneyIn: Locator
  moneyOut: Locator
  assets: Locator
  dlg: Locator
}

/** Sam and Alex in November 2026, made on the first screen: a current account with 1,000.00, a salary of 3,000.00, rent of 1,200.00. */
async function household(page: Page): Promise<Screen> {
  await page.setViewportSize(WIDE)
  await page.goto('/')
  await page.getByRole('button', { name: 'Start on this device' }).click()
  await page.getByLabel('Household name').fill('Sam and Alex')
  await page.getByLabel('Adult 1 name').fill('Sam')
  await page.getByLabel('Adult 2 name').fill('Alex')
  await page.getByRole('button', { name: 'Open the Statement' }).click()
  await expect(page.getByRole('heading', { level: 2, name: 'November 2026' })).toBeVisible()
  // the scenarios start from a household without the guided setup
  await page.getByTestId('setup-guide').getByRole('button', { name: 'Leave setup' }).click()
  const s: Screen = {
    moneyIn: page.getByRole('region', { name: 'Money in' }),
    moneyOut: page.getByRole('region', { name: 'Money out' }),
    assets: page.getByRole('region', { name: 'Assets' }),
    dlg: page.getByRole('dialog'),
  }
  await addAccount(s, 'Current account', 'Main account', '1000')
  await addRow(s, 'income', 'Sam – Salary', '3000')
  await addRow(s, 'expense', 'Rent', '1200')
  return s
}

async function addAccount(s: Screen, name: string, type: string, holds: string): Promise<void> {
  await s.assets.getByRole('button', { name: 'Add account' }).click()
  await expect(s.dlg.getByRole('heading', { name: 'New account' })).toBeVisible()
  await s.dlg.getByLabel('Name', { exact: true }).fill(name)
  await s.dlg.getByLabel('Type').selectOption({ label: type })
  await s.dlg.getByLabel(/^Holds at the start of November 2026/).fill(holds)
  await s.dlg.getByRole('button', { name: 'Save' }).click()
}

/** "Add row", then the amount in the row's dialog, for this and the following months. */
async function addRow(s: Screen, section: 'income' | 'expense', name: string, amount: string): Promise<void> {
  const side = section === 'income' ? s.moneyIn : s.moneyOut
  await side.getByRole('button', { name: `Add ${section} row` }).click()
  await side.getByLabel(`New ${section} row name`).fill(name)
  await side.getByLabel(`New ${section} row name`).press('Enter')
  await expect(s.dlg.getByRole('heading', { name: new RegExp(name) })).toBeVisible()
  await s.dlg.getByLabel('Amount in EUR').fill(amount)
  await s.dlg.getByRole('button', { name: 'Save' }).click()
  await expect(s.dlg).toBeHidden()
}

async function toMonth(page: Page, name: string): Promise<void> {
  await openMonth(page, name)
}

const line = (side: Locator, text: string | RegExp) => side.locator('[data-line]').filter({ hasText: text }).first()

test.describe('whole stories, as the scenarios tell them', () => {
  // scenarios/02: "What a month leaves stays in the current account"
  test('what a month leaves stays in the current account, and the next month starts with it', async ({ page }) => {
    const s = await household(page)
    await expect(s.moneyIn.getByRole('button', { name: /^Sam – Salary: €3,000\.00/ })).toBeVisible()
    await expect(s.moneyOut.getByRole('button', { name: /^Rent: €1,200\.00/ })).toBeVisible()
    await expect(line(s.moneyOut, 'Leftover')).toContainText('€1,800.00')
    await expect(s.assets.locator('[data-line="main"]')).toContainText('€2,800.00')

    await toMonth(page, 'December 2026')
    await expect(line(s.moneyOut, 'Leftover')).toContainText('€1,800.00')
    await expect(s.assets.locator('[data-line="main"]')).toContainText('€4,600.00')
  })

  // scenarios/01: ""Only this month" is an exception of one month", "Taking a change back gives the old amounts back"
  test('an exception lasts one month, and undo takes it back', async ({ page }) => {
    const s = await household(page)
    await toMonth(page, 'December 2026')
    await s.moneyOut.getByRole('button', { name: /^Rent: €1,200\.00/ }).click()
    await s.dlg.getByLabel('Amount in EUR').fill('1250')
    await s.dlg.getByRole('radio', { name: 'Only this month' }).click()
    await s.dlg.getByRole('button', { name: 'Save' }).click()
    await expect(s.dlg).toBeHidden()
    await expect(s.moneyOut.getByRole('button', { name: /^Rent: €1,250\.00/ })).toBeVisible()
    await expect(line(s.moneyOut, 'Leftover')).toContainText('€1,750.00')

    await toMonth(page, 'January 2027')
    await expect(s.moneyOut.getByRole('button', { name: /^Rent: €1,200\.00/ })).toBeVisible()
    // December left 50.00 less: 1,000 + 1,800 + 1,750 + 1,800
    await expect(s.assets.locator('[data-line="main"]')).toContainText('€6,350.00')

    await page.getByRole('button', { name: 'Undo' }).click()
    await expect(s.assets.locator('[data-line="main"]')).toContainText('€6,400.00')
    await stepMonth(page, -1)
    await expect(page.getByRole('heading', { level: 2, name: 'December 2026' })).toBeVisible()
    await expect(s.moneyOut.getByRole('button', { name: /^Rent: €1,200\.00/ })).toBeVisible()
  })

  // scenarios/01: ""This and following months" replaces what the following months had", "… leaves a month that is ticked
  // as done as it is", "Replacing what the following months had can be taken back in one step"
  test('a new amount for this and following months replaces a later one, says so first, leaves a ticked month, and undo takes it back', async ({ page }) => {
    const s = await household(page)
    const rent = (amount: string) => s.moneyOut.getByRole('button', { name: new RegExp(`^Rent: €${amount.replace('.', '\\.')}`) })
    const back = (name: string) => openMonth(page, name)
    // the rent rises to 1,300.00 in April 2027
    await toMonth(page, 'April 2027')
    await rent('1,200.00').click()
    await expect(s.dlg.getByRole('radiogroup', { name: 'Repeats' }).getByRole('radio')).toHaveText(['This and following months', 'On a schedule', 'Only this month'])
    await expect(s.dlg.getByRole('radio', { name: 'This and following months' })).toBeChecked()
    await s.dlg.getByLabel('Amount in EUR').fill('1300')
    await expect(s.dlg.getByTestId('scope-says')).toHaveText('The amount stays in every later month until you change it.')
    await s.dlg.getByRole('button', { name: 'Save' }).click()
    await expect(s.dlg).toBeHidden()
    // June's is paid
    await toMonth(page, 'June 2027')
    await rent('1,300.00').click()
    await s.dlg.getByRole('radio', { name: 'Done' }).click()
    await s.dlg.getByRole('button', { name: 'Save' }).click()
    await expect(s.dlg).toBeHidden()

    // 1,250.00 from January 2027 on: the dialog says what that does to April and to June before anything is saved
    await back('January 2027')
    await rent('1,200.00').click()
    await s.dlg.getByLabel('Amount in EUR').fill('1250')
    await expect(s.dlg.getByTestId('scope-says')).toHaveText('Counts from January 2027 on. Replaces what you typed for Apr 2027. Jun 2027 is ticked as done and keeps its amount.')
    // for January alone it would replace nothing, and February would go on as before
    await s.dlg.getByRole('radio', { name: 'Only this month' }).click()
    await expect(s.dlg.getByTestId('scope-says')).toHaveText('Only January 2027. February goes on with €1,200.00.')
    await s.dlg.getByRole('radio', { name: 'This and following months' }).click()
    await s.dlg.getByRole('button', { name: 'Save' }).click()
    await expect(s.dlg).toBeHidden()
    await expect(rent('1,250.00')).toBeVisible()
    await toMonth(page, 'April 2027')
    await expect(rent('1,250.00')).toBeVisible()
    await toMonth(page, 'June 2027')
    await expect(rent('1,300.00')).toBeVisible()
    await toMonth(page, 'July 2027')
    await expect(rent('1,250.00')).toBeVisible()

    // one step, one Undo: July follows April's 1,300.00 again
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect(rent('1,300.00')).toBeVisible()
    await back('January 2027')
    await expect(rent('1,200.00')).toBeVisible()
  })

  // scenarios/03: "A real balance replaces the calculated one, and the next month starts from it"
  test('a real balance replaces the calculated one, and the next month starts from it', async ({ page }) => {
    const s = await household(page)
    await addAccount(s, 'Savings', 'Savings', '5000')
    // a new savings account is asked how much goes to it
    await expect(s.dlg.getByRole('heading', { name: 'How much goes to Savings?' })).toBeVisible()
    await s.dlg.getByRole('radio', { name: 'A fixed amount' }).click()
    await s.dlg.getByLabel('Amount per month in EUR').fill('500')
    await s.dlg.getByRole('button', { name: 'Save' }).click()
    await expect(s.dlg).toBeHidden()
    const savings = s.assets.locator('[data-line^="acc:"]').filter({ hasText: 'Savings' })
    await expect(s.assets.getByRole('button', { name: 'Savings balance: €5,500.00' })).toBeVisible()

    await s.assets.getByRole('button', { name: 'Savings balance: €5,500.00' }).click()
    await expect(s.dlg.getByRole('heading', { name: 'Savings · November 2026' })).toBeVisible()
    await s.dlg.getByLabel(/at the end of November 2026/i).fill('5620')
    await s.dlg.getByRole('button', { name: 'Save' }).click()
    await expect(s.dlg).toBeHidden()
    await expect(s.assets.getByRole('button', { name: /^Savings balance: €5,620\.00, entered/ })).toBeVisible()
    await expect(savings).toContainText('+€120.00 against the plan')

    await toMonth(page, 'December 2026')
    await expect(s.assets.getByRole('button', { name: /^Savings balance: €6,120\.00/ })).toBeVisible()
  })

  // scenarios/02: "An account that takes the rest of the month gets what the month leaves"
  test('an account that takes the rest gets what the month leaves, and the current account keeps nothing', async ({ page }) => {
    const s = await household(page)
    await addAccount(s, 'Savings', 'Savings', '5000')
    await expect(s.dlg.getByRole('heading', { name: 'How much goes to Savings?' })).toBeVisible()
    await s.dlg.getByRole('radio', { name: 'The rest' }).click()
    await s.dlg.getByRole('button', { name: 'Save' }).click()
    await expect(s.dlg).toBeHidden()
    await expect(s.moneyOut.getByRole('button', { name: 'To Savings: €1,800.00' })).toBeVisible()
    await expect(s.assets.getByRole('button', { name: /^Savings balance: €6,800\.00/ })).toBeVisible()
    await expect(s.assets.locator('[data-line="main"]')).toContainText('€1,000.00')

    await toMonth(page, 'December 2026')
    await expect(s.assets.getByRole('button', { name: /^Savings balance: €8,600\.00/ })).toBeVisible()
    await expect(s.assets.locator('[data-line="main"]')).toContainText('€1,000.00')
  })

  // scenarios/08: "A percentage of what is left comes after spending and the percentages of income"
  test('a percentage of the income and a percentage of what is left, in that order', async ({ page }) => {
    const s = await household(page)
    await addAccount(s, 'Index fund', 'Investments', '0')
    await expect(s.dlg.getByRole('heading', { name: 'How much goes to Index fund?' })).toBeVisible()
    await s.dlg.getByRole('radio', { name: 'A percentage of income' }).click()
    await s.dlg.getByLabel('Percentage of income').fill('10')
    await s.dlg.getByRole('button', { name: 'Save' }).click()
    await expect(s.dlg).toBeHidden()
    await addAccount(s, 'Holiday fund', 'Savings', '0')
    await expect(s.dlg.getByRole('heading', { name: 'How much goes to Holiday fund?' })).toBeVisible()
    await s.dlg.getByRole('radio', { name: 'A percentage of what is left' }).click()
    await s.dlg.getByLabel('Percentage of what is left').fill('50')
    await s.dlg.getByRole('button', { name: 'Save' }).click()
    await expect(s.dlg).toBeHidden()

    // 10 % of 3,000.00; then half of 3,000.00 − 1,200.00 − 300.00; the other half stays in the current account
    await expect(s.moneyOut.getByRole('button', { name: /^To Index fund: €300\.00/ })).toBeVisible()
    await expect(s.moneyOut.getByRole('button', { name: /^To Holiday fund: €750\.00/ })).toBeVisible()
    // the account form starts a new investment account at 5 % growth a year, so the 300.00 has grown by the end of the month
    await expect(s.assets.locator('[data-line^="acc:"]').filter({ hasText: 'Index fund' })).toContainText('€301.22')
    await expect(s.assets.locator('[data-line^="acc:"]').filter({ hasText: 'Holiday fund' })).toContainText('€750.00')
    await expect(s.assets.locator('[data-line="main"]')).toContainText('€1,750.00')
  })

  // scenarios/09: "What is owed on a card that records only its payments stays until a real balance says otherwise"
  test('a card that records only its payments: the payment is spending, and what is owed stays', async ({ page }) => {
    const s = await household(page)
    const claims = page.getByRole('region', { name: 'Debts and net worth' })
    await claims.getByRole('button', { name: 'Add a card or loan' }).click()
    await s.dlg.getByLabel('Name', { exact: true }).fill('Amex')
    await s.dlg.getByRole('radio', { name: 'Only what I pay to it' }).click()
    await s.dlg.getByLabel(/^Owed at the start of November 2026/).fill('500')
    // the form says what a payment to such a card is
    await expect(s.dlg.getByTestId('acc-row')).toHaveText('"Amex – Payment". Each payment counts as that month\'s spending; what is owed changes only with a real balance.')
    await s.dlg.getByRole('button', { name: 'Save' }).click()
    await expect(s.dlg.getByRole('heading', { name: 'Amex – Payment · November 2026' })).toBeVisible()
    await s.dlg.getByLabel('Amount in EUR').fill('300')
    await s.dlg.getByRole('button', { name: 'Save' }).click()
    await expect(s.dlg).toBeHidden()

    // the payment is part of what the month costs, and its link does not say that it pays the card off
    await expect(s.moneyOut.getByRole('button', { name: /^Amex – Payment: €300\.00/ })).toBeVisible()
    await expect(line(s.moneyOut, 'Leftover')).toContainText('€1,500.00')
    await expect(s.moneyOut.getByRole('button', { name: 'Paid to Amex: go there' })).toBeVisible()
    const amex = claims.locator('[data-line^="acc:"]').filter({ hasText: 'Amex' })
    await expect(amex).toContainText('€500.00')
    await expect(amex).toContainText('changes with real balances only')
    await expect(claims.getByRole('button', { name: 'Payments: Amex – Payment: go there' })).toBeVisible()

    // a month and a payment later, the same is owed
    await toMonth(page, 'December 2026')
    await expect(s.moneyOut.getByRole('button', { name: /^Amex – Payment: €300\.00/ })).toBeVisible()
    await expect(amex).toContainText('€500.00')
  })

  // scenarios/02: "Money moved to another of the household's accounts leaves net worth as it is",
  // "A row that moves money and names no account takes it out of the plan"
  test('a row that moves money names the account that receives it; named none, the money leaves the plan', async ({ page }) => {
    const s = await household(page)
    const claims = page.getByRole('region', { name: 'Debts and net worth' })
    await addAccount(s, 'Wallet', 'Cash', '150')
    const what = s.moneyOut.getByLabel('What is it for?')
    const which = s.moneyOut.getByLabel('Which one')
    const text = s.moneyOut.getByTestId('add-row-text')
    const part = (id: string) => s.moneyOut.locator(`li:has(> [data-line="${id}"])`)

    // the form starts on "No account", and says what that means; picking the account changes the sentence and names the row
    await s.moneyOut.getByRole('button', { name: 'Add transfer row' }).click()
    await what.selectOption('plain')
    await expect(which.locator('option')).toHaveText(['No account: the money leaves the plan', 'Wallet'])
    await expect(text).toHaveText('An amount you type each month that no account of yours receives, like money sent to family. It is not counted as spending, and net worth falls by it.')
    await which.selectOption({ label: 'Wallet' })
    await expect(text).toHaveText('An amount you type each month goes from the main account into the account you pick. Its balance rises by it, and net worth stays as it is. It is not spending.')
    await expect(s.moneyOut.getByLabel('New transfer row name')).toHaveAttribute('placeholder', 'To Wallet')
    await s.moneyOut.getByRole('button', { name: 'Add', exact: true }).click()
    await expect(s.dlg.getByRole('heading', { name: 'To Wallet · November 2026' })).toBeVisible()
    await s.dlg.getByLabel('Amount in EUR').fill('300')
    await s.dlg.getByRole('button', { name: 'Save' }).click()
    await expect(s.dlg).toBeHidden()

    // it stands with what is shared out of the rest, linked to its account, which rises; net worth is what it was
    await expect(part('set-aside').getByRole('button', { name: /^To Wallet: €300\.00/ })).toBeVisible()
    await expect(s.moneyOut.getByRole('button', { name: 'Goes into Wallet: go there' })).toBeVisible()
    await expect(s.assets.locator('[data-line^="acc:"]').filter({ hasText: 'Wallet' })).toContainText('€450.00')
    await expect(line(s.moneyOut, 'Leftover')).toContainText('€1,500.00')
    await expect(s.assets.locator('[data-line="main"]')).toContainText('€2,500.00')
    await expect(claims.locator('[data-line="net-worth"]')).toContainText('€2,950.00')

    // the same kind of row without an account: under "Moved elsewhere", marked, and net worth falls by it
    await s.moneyOut.getByRole('button', { name: 'Add transfer row' }).click()
    await what.selectOption('plain')
    await s.moneyOut.getByLabel('New transfer row name').fill('To grandma')
    await s.moneyOut.getByRole('button', { name: 'Add', exact: true }).click()
    await expect(s.dlg.getByRole('heading', { name: 'To grandma · November 2026' })).toBeVisible()
    await s.dlg.getByLabel('Amount in EUR').fill('50')
    await s.dlg.getByRole('button', { name: 'Save' }).click()
    await expect(s.dlg).toBeHidden()
    const gift = part('moved').locator('[data-line]').filter({ hasText: 'To grandma' })
    await expect(gift).toContainText('leaves the plan')
    await expect(s.moneyOut.locator('[data-line="moved"]')).toContainText('€50.00')
    await expect(claims.locator('[data-line="net-worth"]')).toContainText('€2,900.00')
    await page.screenshot({ path: 'e2e/output/story-move-money.png', fullPage: true })
  })

  // scenarios/09: "The last payment to a loan is what is still owed, and after it the payment counts as nothing"
  test('a loan payment stops at what is owed: the last one is smaller, then the row is marked paid off', async ({ page }) => {
    const s = await household(page)
    const claims = page.getByRole('region', { name: 'Debts and net worth' })
    await claims.getByRole('button', { name: 'Add a card or loan' }).click()
    await s.dlg.getByLabel('Name', { exact: true }).fill('Car loan')
    await s.dlg.getByLabel('Type').selectOption('loan')
    // a payment stops at what is owed, so the form asks for it
    await s.dlg.getByRole('button', { name: 'Save' }).click()
    await expect(s.dlg.getByRole('alert')).toContainText('Type what is still owed on the loan')
    await s.dlg.getByLabel(/^Owed at the start of November 2026/).fill('600')
    await s.dlg.getByRole('button', { name: 'Save' }).click()
    await expect(s.dlg.getByRole('heading', { name: 'Car loan – Payment · November 2026' })).toBeVisible()
    await s.dlg.getByLabel('Amount in EUR').fill('250')
    await s.dlg.getByRole('button', { name: 'Save' }).click()
    await expect(s.dlg).toBeHidden()
    const loan = claims.locator('[data-line^="acc:"]').filter({ hasText: 'Car loan' })
    const payment = line(s.moneyOut, 'Car loan – Payment')
    await expect(loan).toContainText('€350.00')
    await expect(payment).not.toContainText('paid off')

    // December: 250 again, 100 is left. January: only those 100 count, and the month has 150 more left
    await toMonth(page, 'December 2026')
    await expect(loan).toContainText('€100.00')
    await toMonth(page, 'January 2027')
    await expect(s.moneyOut.getByRole('button', { name: /^Car loan – Payment: €100\.00/ })).toBeVisible()
    await expect(payment).toContainText('paid off')
    await expect(payment).toContainText('€250.00 planned')
    await page.screenshot({ path: 'e2e/output/story-loan-paid-off.png', fullPage: true })
    await expect(line(s.moneyOut, 'Leftover')).toContainText('€1,700.00')
    await expect(loan).toContainText('€0.00')
    // the row's dialog says why, and still holds what was planned
    await s.moneyOut.getByRole('button', { name: /^Car loan – Payment: €100\.00/ }).click()
    await expect(s.dlg.getByTestId('paid-off-note')).toHaveText('€250.00 is planned. €100.00 was still owed on "Car loan", so €100.00 counts this month. What is planned stays as it is, and counts again if a real balance raises what is owed.')
    await expect(s.dlg.getByLabel('Amount in EUR')).toHaveValue(/^250/)
    await s.dlg.getByRole('button', { name: 'Cancel' }).click()
    await expect(s.dlg).toBeHidden()

    // February: nothing is owed, so nothing counts, and the row says so
    await toMonth(page, 'February 2027')
    await expect(payment).toContainText('paid off')
    await expect(line(s.moneyOut, 'Leftover')).toContainText('€1,800.00')
    await payment.getByRole('button', { name: /^Car loan – Payment:/ }).click()
    await expect(s.dlg.getByTestId('paid-off-note')).toContainText('"Car loan" is paid off: nothing counts this month.')
  })
})

test.describe('whole stories in another currency', () => {
  // service workers are blocked so page.route can stand in for the rate service
  test.use({ serviceWorkers: 'block' })

  // scenarios/05: "A recorded conversion keeps its rate when the month's rate changes"
  test('a salary in dollars recorded as converted keeps its euros when the month\'s rate changes', async ({ page }) => {
    await page.route('https://api.frankfurter.dev/**', (r) => r.fulfill({ json: { rates: { '2026-11-02': { USD: 1.1 } } } }))
    const s = await household(page)
    await s.moneyIn.getByRole('button', { name: 'Add income row' }).click()
    await s.moneyIn.getByLabel('New income row name').fill('Alex – Salary')
    await s.moneyIn.getByLabel('New income row name').press('Enter')
    await s.dlg.getByLabel('Currency of Alex – Salary').selectOption('USD')
    await s.dlg.getByLabel('Amount in USD').fill('3300')
    await s.dlg.getByRole('button', { name: 'Record the conversion…' }).click()
    // converted at 1.1000, the month's rate of the day: 3,000.00 euros
    await expect(s.dlg.getByLabel('In EUR')).toHaveValue('3000')
    await s.dlg.getByRole('button', { name: 'Done', exact: true }).click()
    await s.dlg.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(s.dlg).toBeHidden()
    const salary = line(s.moneyIn, 'Alex – Salary')
    await expect(salary).toContainText('€3,000.00')

    // the month's rate becomes 1.2000: the recorded salary stays at 3,000.00
    await salary.getByRole('button', { name: /^Alex – Salary:/ }).click()
    await s.dlg.getByRole('button', { name: "Change this month's rate…" }).click()
    await s.dlg.getByLabel('1 EUR =').fill('1.2')
    await s.dlg.getByRole('button', { name: 'Save rate' }).click()
    await expect(s.dlg.getByTestId('rate-line')).toContainText('1 EUR = 1.20 USD')
    // the recorded salary counts as recorded: the rate line says nothing of what it would be at the month's rate
    await expect(s.dlg.getByTestId('rate-line')).not.toContainText('≈')
    await expect(s.dlg.getByTestId('conversion')).toContainText('= €3,000.00')
    await s.dlg.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(page.getByTestId('month-rates')).toContainText('1 EUR = 1.20 USD')
    await expect(salary).toContainText('€3,000.00')
  })
})
