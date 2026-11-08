import type { Section } from '@/model'

/**
 * One hue per kind of money (DESIGN.md §1 and §5). Class strings are written out so Tailwind can see them.
 * - text: titles and labels in the hue; since the design-system port this is the only place a section's colour lives
 * - tint: an opaque light fill for total rows (safe under sticky cells)
 * - band: a fainter opaque fill for a category group on the grid (alternating groups)
 * - fill: solid fill (dots, progress bars)
 * - bar: a 3 px left bar; no longer used on titles or cards, kept for an edge that names a state
 */
export interface Hue {
  text: string
  tint: string
  band: string
  fill: string
  bar: string
}

export const HUES = {
  income: { text: 'text-income', tint: 'bg-income-tint', band: 'bg-income-band', fill: 'bg-income', bar: 'border-l-[3px] border-l-income' },
  expense: { text: 'text-expense', tint: 'bg-expense-tint', band: 'bg-expense-band', fill: 'bg-expense', bar: 'border-l-[3px] border-l-expense' },
  transfer: { text: 'text-transfer', tint: 'bg-transfer-tint', band: 'bg-transfer-band', fill: 'bg-transfer', bar: 'border-l-[3px] border-l-transfer' },
  worth: { text: 'text-worth', tint: 'bg-worth-tint', band: 'bg-worth-band', fill: 'bg-worth', bar: 'border-l-[3px] border-l-worth' },
  pool: { text: 'text-pool', tint: 'bg-pool-tint', band: 'bg-pool-band', fill: 'bg-pool', bar: 'border-l-[3px] border-l-pool' },
  goal: { text: 'text-goal', tint: 'bg-goal-tint', band: 'bg-goal-band', fill: 'bg-goal', bar: 'border-l-[3px] border-l-goal' },
} satisfies Record<string, Hue>

export const SECTION_HUE: Record<Section, Hue> = { income: HUES.income, expense: HUES.expense, transfer: HUES.transfer }
