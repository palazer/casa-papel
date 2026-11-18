import { expect, test, type Locator, type Page } from './test'

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
  await addAccount(s, 'Current account', 'Current account', '1000')
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

/** "Add row", then the amount in the row's dialog, repeating every month. */
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
  for (let i = 0; i < 24 && !(await page.getByRole('heading', { level: 2, name }).isVisible()); i++) await page.getByRole('button', { name: 'Next month' }).click()
  await expect(page.getByRole('heading', { level: 2, name })).toBeVisible()
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
    await page.getByRole('button', { name: 'Previous month' }).click()
    await expect(page.getByRole('heading', { level: 2, name: 'December 2026' })).toBeVisible()
    await expect(s.moneyOut.getByRole('button', { name: /^Rent: €1,200\.00/ })).toBeVisible()
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
