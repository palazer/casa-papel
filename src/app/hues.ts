import type { Section } from '@/model'

/**
 * One hue per kind of money. Class strings are written out so Tailwind can see them.
 * - text: titles and labels in the hue
 * - bar: a 3 px left bar (section headers, card edges)
 * - tint: an opaque light fill for total rows (safe under sticky cells)
 * - edge: a faint left edge on row labels inside a section
 * - fill: solid fill (dots, progress bars)
 */
export interface Hue {
  text: string
  bar: string
  tint: string
  edge: string
  fill: string
}

export const HUES = {
  income: { text: 'text-income', bar: 'border-l-[3px] border-l-income', tint: 'bg-income-tint', edge: 'border-l-2 border-l-income/40', fill: 'bg-income' },
  expense: { text: 'text-expense', bar: 'border-l-[3px] border-l-expense', tint: 'bg-expense-tint', edge: 'border-l-2 border-l-expense/40', fill: 'bg-expense' },
  transfer: { text: 'text-transfer', bar: 'border-l-[3px] border-l-transfer', tint: 'bg-transfer-tint', edge: 'border-l-2 border-l-transfer/40', fill: 'bg-transfer' },
  worth: { text: 'text-worth', bar: 'border-l-[3px] border-l-worth', tint: 'bg-worth-tint', edge: 'border-l-2 border-l-worth/40', fill: 'bg-worth' },
  pool: { text: 'text-pool', bar: 'border-l-[3px] border-l-pool', tint: 'bg-pool-tint', edge: 'border-l-2 border-l-pool/40', fill: 'bg-pool' },
  goal: { text: 'text-goal', bar: 'border-l-[3px] border-l-goal', tint: 'bg-goal-tint', edge: 'border-l-2 border-l-goal/40', fill: 'bg-goal' },
} satisfies Record<string, Hue>

export const SECTION_HUE: Record<Section, Hue> = { income: HUES.income, expense: HUES.expense, transfer: HUES.transfer }

/** Card edge in a hue: for cards that are about one kind of money. */
export const cardBar = (h: Hue) => h.bar.replace('border-l-[3px]', 'border-l-4')
