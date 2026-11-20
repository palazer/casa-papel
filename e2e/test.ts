import { test as base, expect, type BrowserContext, type Locator, type Page } from '@playwright/test'

/**
 * The day every browser test runs on. The app opens on the current month, and the tests name that month ("November
 * 2026", the demo household's current month), so with the real date they only pass during November 2026.
 * Noon on the 15th in the machine's own time zone: the same day wherever the tests run.
 */
export const TODAY = new Date('2026-11-15T12:00:00')

/** From the real clock to the tests' clock: fixed when the tests start, so every page and the fake server share one time. */
const SHIFT = TODAY.getTime() - Date.now()

/** The tests' "now": `TODAY` when the run began, and running on from there. For the Node side (the fake server). */
export const now = (): Date => new Date(Date.now() + SHIFT)

/**
 * Give every page of the context the tests' date. Only `Date` is moved, by a fixed amount: time still runs, two
 * devices of one test agree on it, and timers stay the browser's own. (Playwright's `clock.install` also replaces the
 * timers, which made the two-device sync test lose a race now and then.)
 */
export async function fixDate(context: BrowserContext): Promise<void> {
  await context.addInitScript(`(() => {
    const shift = ${SHIFT}
    const Real = Date
    function Shifted(...args) {
      if (!new.target) return new Real(Real.now() + shift).toString()
      return args.length === 0 ? new Real(Real.now() + shift) : new Real(...args)
    }
    Shifted.prototype = Real.prototype
    Shifted.now = () => Real.now() + shift
    Shifted.parse = Real.parse
    Shifted.UTC = Real.UTC
    globalThis.Date = Shifted
  })()`)
}

/** Playwright's `test` with the date fixed. Every spec imports `test` and `expect` from here, not from Playwright. */
export const test = base.extend({
  // Playwright calls the second argument `use`; named so here, the linter takes it for React's hook of that name
  context: async ({ context }, run) => {
    await fixDate(context)
    await run(context)
  },
})

export { expect } from '@playwright/test'
export type { Browser, BrowserContext, Locator, Page, Route } from '@playwright/test'

/**
 * Answer the question before a change alters a month that is over (rule T4) with "Save anyway": for a test whose
 * change reaches into September or October 2026 on purpose. `e2e/past.spec.ts` tests the question itself.
 */
export async function saveAnyway(page: Page): Promise<void> {
  const question = page.getByTestId('past-question')
  await expect(question).toBeVisible()
  await question.getByRole('button', { name: 'Save anyway' }).click()
  await expect(question).toBeHidden()
}

/**
 * The Statement's month is changed in its strip of months (there are no arrows beside the month's name). While a
 * household is being set up the guide holds the top of the page and there is no strip: the month keeps its arrows
 * there, and these helpers use them.
 */
async function monthStrip(page: Page): Promise<Locator | null> {
  // the month's name is on the page with the strip, or with the arrows
  await expect(page.getByRole('heading', { level: 2 }).first()).toBeVisible()
  const strip = page.getByRole('navigation', { name: 'Months' })
  return (await strip.count()) > 0 ? strip : null
}

/** Open a month by its name ("December 2026"): its chip in the strip. */
export async function openMonth(page: Page, name: string): Promise<void> {
  const heading = page.getByRole('heading', { level: 2, name })
  const strip = await monthStrip(page)
  if (strip) await strip.getByRole('button', { name: new RegExp(`^${name}[,:]`) }).click()
  else {
    const prev = page.getByRole('button', { name: 'Previous month' })
    while (!(await heading.isVisible()) && (await prev.isEnabled())) await prev.click()
    for (let i = 0; i < 48 && !(await heading.isVisible()); i++) await page.getByRole('button', { name: 'Next month' }).click()
  }
  await expect(heading).toBeVisible()
}

/** The month after (1) or before (-1) the one on screen: the chip beside the pressed one. */
export async function stepMonth(page: Page, by: 1 | -1): Promise<void> {
  const strip = await monthStrip(page)
  if (!strip) {
    await page.getByRole('button', { name: by > 0 ? 'Next month' : 'Previous month' }).click()
    return
  }
  const to = await strip.locator('[data-month][aria-pressed="true"]').evaluate(
    (el, step) => ((step > 0 ? el.nextElementSibling : el.previousElementSibling) as HTMLElement | null)?.dataset.month ?? null, by,
  )
  if (!to) throw new Error(`No month ${by > 0 ? 'after' : 'before'} the one on screen`)
  await strip.locator(`[data-month="${to}"]`).click()
  await expect(strip.locator(`[data-month="${to}"]`)).toHaveAttribute('aria-pressed', 'true')
}
