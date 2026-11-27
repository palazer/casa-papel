import type { TrendSubject } from '@/engine'
import { readPref } from '@/app/prefs'
import { HORIZONS, type Horizon } from '@/store'
import { txt } from '@/i18n'

const T = txt.trends.subjects

/**
 * The five subjects of the Trends page: their names and the colour each has in every chart (DESIGN.md §11). Net
 * worth, income and expenses wear the hue they have everywhere; accounts and debts have one each for the charts.
 */
export const SUBJECTS: Record<TrendSubject, { label: string; color: string }> = {
  netWorth: { label: txt.common.netWorth, color: 'var(--worth)' },
  income: { label: txt.common.income, color: 'var(--income)' },
  expenses: { label: txt.common.expenses, color: 'var(--expense)' },
  accounts: { label: txt.common.accounts, color: 'var(--trend-accounts)' },
  debts: { label: T.debts, color: 'var(--trend-debts)' },
}

/** The colours of a breakdown's parts, given out in order and never repeated; what is left over is "Other". */
export const PART_COLORS = ['var(--part-1)', 'var(--part-2)', 'var(--part-3)', 'var(--part-4)', 'var(--part-5)', 'var(--part-6)']
export const OTHER_COLOR = 'var(--part-other)'

export const HORIZON_LABEL: Record<string, string> = { plan: T.plan, 3: T.n3Years, 5: T.n5Years, 10: T.n10Years }

/** What this device remembers of the page: which subjects are on the charts, and how far ahead they look. */
export function rememberedSubjects(): TrendSubject[] {
  const stored = readPref<unknown>('trends.subjects', null)
  const known = Object.keys(SUBJECTS) as TrendSubject[]
  return Array.isArray(stored) ? known.filter((s) => stored.includes(s)) : ['netWorth']
}
export function rememberedHorizon(): Horizon {
  const stored = readPref<unknown>('trends.horizon', 'plan')
  return HORIZONS.find((h) => h === stored) ?? 'plan'
}
