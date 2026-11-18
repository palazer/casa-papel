import { test as base, expect, type BrowserContext, type Page } from '@playwright/test'

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
