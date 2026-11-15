import { test as base, type BrowserContext } from '@playwright/test'

/**
 * The day every browser test runs on. The app opens on the current month, and the tests name that month ("November
 * 2026", the demo household's current month), so with the real date they only pass during November 2026.
 * Noon on the 15th in the machine's own time zone: the same day wherever the tests run.
 */
export const TODAY = new Date('2026-11-15T12:00:00')

/** Start the clock of every page in the context at `TODAY`. Time runs on from there, so what is saved later is later. */
export async function fixDate(context: BrowserContext): Promise<void> {
  await context.clock.install({ time: TODAY })
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
