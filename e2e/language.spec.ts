import { expect, test, type Page } from './test'

/** The choice of language: each option in its own words, whatever the page speaks. */
const choice = (page: Page, name: 'English' | 'Türkçe') => page.getByRole('radio', { name, exact: true })

test('the language is chosen on the welcome screen and stays after a reload', async ({ page }) => {
  await page.goto('')
  await expect(page.getByText('Welcome to Casa Papel')).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await expect(choice(page, 'English')).toHaveAttribute('aria-checked', 'true')

  await choice(page, 'Türkçe').click()
  await expect(page.getByText('Casa Papel\'e hoş geldin')).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('lang', 'tr')
  await expect(choice(page, 'Türkçe')).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByRole('button', { name: 'Bu cihazda başla' })).toBeVisible()

  await page.reload()
  await expect(page.getByText('Casa Papel\'e hoş geldin')).toBeVisible()
  await page.getByRole('button', { name: 'Nasıl çalışır' }).click()
  await expect(page.getByRole('heading', { name: 'Kılavuz', level: 1 })).toBeVisible()
  await expect(page.locator('#guide-topics')).toContainText('Başlangıç ve Bilanço')
  await expect(page.getByRole('heading', { name: 'Casa Papel nedir' })).toBeVisible()
  await page.screenshot({ path: 'e2e/output/language-guide-tr.png' })

  await page.goto('')
  await choice(page, 'English').click()
  await expect(page.getByText('Welcome to Casa Papel')).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
})

test.describe('a browser that speaks Turkish', () => {
  test.use({ locale: 'tr-TR' })

  test('opens in Turkish; a household made there holds Turkish names, and an English device files its rows under them', async ({ page }) => {
    await page.goto('')
    await expect(page.getByText('Casa Papel\'e hoş geldin')).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('lang', 'tr')
    await expect(choice(page, 'Türkçe')).toHaveAttribute('aria-checked', 'true')
    await page.screenshot({ path: 'e2e/output/language-welcome-tr.png' })

    // setup starts with the Turkish format and the lira
    await page.getByRole('button', { name: 'Bu cihazda başla' }).click()
    await expect(page.locator('#s-locale')).toHaveValue('tr-TR')
    await expect(page.locator('#s-ccy')).toHaveValue('TRY')
    await page.getByLabel('1. yetişkinin adı').fill('Sam')
    await page.getByRole('button', { name: 'Ev ekle' }).click()
    await page.getByLabel('Ad (Ev)').fill('Daire')
    await page.screenshot({ path: 'e2e/output/language-setup-tr.png', fullPage: true })
    await page.getByRole('button', { name: 'Bilanço\'yu aç' }).click()

    // the Statement, in Turkish, with the month named in Turkish
    await expect(page.getByRole('heading', { name: 'Bilanço', level: 1 })).toBeVisible()
    await expect(page.getByText('Kasım 2026').first()).toBeVisible()
    await expect(page.locator('[data-suggestion]').filter({ hasText: 'Sam – Maaş' })).toBeVisible()

    // the expenses step: the rent is offered under the Turkish category, and is added there
    await page.getByRole('button', { name: 'Atla', exact: true }).click()
    const konut = page.getByRole('group', { name: 'Öneriler: Konut' })
    const rent = konut.locator('[data-suggestion]').filter({ hasText: 'Daire – Kira veya konut kredisi' })
    await expect(rent).toBeVisible()
    await rent.locator('input').fill('12000')
    await rent.locator('input').press('Enter')
    await expect(rent).toHaveCount(0)
    await expect(page.getByRole('region', { name: 'Çıkan para' })).toContainText('Daire – Kira veya konut kredisi')
    await expect(page.getByRole('region', { name: 'Çıkan para' })).toContainText('₺12.000,00')
    await page.screenshot({ path: 'e2e/output/language-statement-tr.png', fullPage: true })

    // the same household on a device that speaks English: the language is the device's, chosen under Data
    await page.getByRole('link', { name: 'Veriler' }).click()
    await expect(page.getByRole('heading', { name: 'Dil' })).toBeVisible()
    await page.screenshot({ path: 'e2e/output/language-data-tr.png', fullPage: true })
    await choice(page, 'English').click()
    await expect(page.getByRole('heading', { name: 'Data', level: 1 })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Language' })).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')

    await page.getByRole('link', { name: 'Statement' }).click()
    await expect(page.getByRole('heading', { name: 'Statement', level: 1 })).toBeVisible()
    // months are named in English now; digits and signs stay with the household's format
    await expect(page.getByText('November 2026').first()).toBeVisible()
    const moneyOut = page.getByRole('region', { name: 'Money out' })
    await expect(moneyOut).toContainText('Daire – Kira veya konut kredisi')
    await expect(moneyOut).toContainText('₺12.000,00')
    // the names it wrote stay Turkish; the rows this device offers are English and are filed under the Turkish category
    await page.getByRole('button', { name: 'Leave setup' }).click()
    await page.getByRole('button', { name: 'Suggestions', exact: true }).click()
    const housing = page.getByRole('group', { name: 'Suggestions for Konut' })
    await expect(housing.locator('[data-suggestion]').first()).toHaveText(/^Daire – Utilities/)
    await expect(page.locator('[data-suggestion]').filter({ hasText: 'Rent or mortgage' })).toHaveCount(0)
  })
})
