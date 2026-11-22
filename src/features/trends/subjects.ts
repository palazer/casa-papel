import type { TrendSubject } from '@/engine'
import { readPref } from '@/app/prefs'
import { HORIZONS, type Horizon } from '@/store'

/**
 * The five subjects of the Trends page: their names and the colour each has in every chart (DESIGN.md §11). Net
 * worth, income and expenses wear the hue they have everywhere; accounts and debts have one each for the charts.
 */
export const SUBJECTS: Record<TrendSubject, { label: string; color: string }> = {
  netWorth: { label: 'Net worth', color: 'var(--worth)' },
  income: { label: 'Income', color: 'var(--income)' },
  expenses: { label: 'Expenses', color: 'var(--expense)' },
  accounts: { label: 'Accounts', color: 'var(--trend-accounts)' },
  debts: { label: 'Debts', color: 'var(--trend-debts)' },
}

/** The colours of a breakdown's parts, given out in order and never repeated; what is left over is "Other". */
export const PART_COLORS = ['var(--part-1)', 'var(--part-2)', 'var(--part-3)', 'var(--part-4)', 'var(--part-5)', 'var(--part-6)']
export const OTHER_COLOR = 'var(--part-other)'

export const HORIZON_LABEL: Record<string, string> = { plan: 'Plan', 3: '3 years', 5: '5 years', 10: '10 years' }

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
